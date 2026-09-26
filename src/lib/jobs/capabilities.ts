/**
 * Tool capability metadata: the bridge between the catalog's `ProcessingMode`
 * and the job/worker layer's {@link ToolCapability}. This is the single source
 * of truth for "where does this tool run, does it upload files, and what is the
 * secure-worker flow it will follow" — consumed by the API validators, the tool
 * pages, and the docs.
 */

import { getToolBySlug } from "@/lib/tools";
import type { ProcessingMode } from "@/lib/tools/types";
import type { ToolCapability, ToolInputKind } from "./types";

/** Catalog processing mode → job-layer capability (1:1). */
export const CAPABILITY_BY_MODE: Record<ProcessingMode, ToolCapability> = {
  client: "in-browser",
  server: "secure-worker",
  hybrid: "hybrid",
  ai: "ai",
};

export function capabilityForMode(mode: ProcessingMode): ToolCapability {
  return CAPABILITY_BY_MODE[mode];
}

/**
 * Whether a capability's server path uses the worker backend at all. `hybrid`
 * counts because a job submitted to the API is, by definition, taking the
 * server fallback path — the browser path never calls the API.
 */
export function usesWorkerBackend(capability: ToolCapability): boolean {
  return capability !== "in-browser";
}

/** Human-facing descriptor for a capability, used by UI and docs. */
export interface CapabilityDescriptor {
  id: ToolCapability;
  label: string;
  /** One-line summary of the execution model. */
  summary: string;
  /** True if files leave the device under this capability. */
  uploadsFiles: boolean;
}

export const CAPABILITY_DESCRIPTORS: Record<
  ToolCapability,
  CapabilityDescriptor
> = {
  "in-browser": {
    id: "in-browser",
    label: "In-browser",
    summary:
      "Runs entirely on your device, in your browser. Files are never uploaded.",
    uploadsFiles: false,
  },
  "secure-worker": {
    id: "secure-worker",
    label: "Secure worker",
    // Deliberately does NOT say "scans": this string is static, so it can only
    // assert what is true in every deployment, and malware scanning is optional and
    // off unless an operator configures it. What is always true is the isolation and
    // the deletion. Live scanning status is reported separately, from the worker's
    // own heartbeat — see `workerPipelineStages`.
    summary:
      "Runs on an encrypted, isolated worker that processes and then permanently deletes your files.",
    uploadsFiles: true,
  },
  hybrid: {
    id: "hybrid",
    label: "Hybrid",
    summary:
      "Runs in your browser when it can, with an encrypted secure-worker fallback for large or complex files.",
    uploadsFiles: true,
  },
  ai: {
    id: "ai",
    label: "AI",
    summary:
      "Runs on secure AI infrastructure. Your content is processed to answer your request and is never used to train models.",
    uploadsFiles: true,
  },
};

export function describeCapability(
  capability: ToolCapability,
): CapabilityDescriptor {
  return CAPABILITY_DESCRIPTORS[capability];
}

/** Resolve a tool slug to its capability, or `undefined` if the slug is unknown. */
export function getToolCapability(slug: string): ToolCapability | undefined {
  const tool = getToolBySlug(slug);
  return tool ? capabilityForMode(tool.processing) : undefined;
}

/**
 * Whether a tool takes uploaded files or a single URL. Only URL-input tools
 * (e.g. webpage-to-pdf) accept a `url` option instead of uploads; everything
 * else takes files. Derived from the catalog's `accept` list.
 */
export function getToolInputKind(slug: string): ToolInputKind | undefined {
  const tool = getToolBySlug(slug);
  if (!tool) return undefined;
  const formats = tool.accept.map((f) => f.toUpperCase());
  const onlyUrl = formats.length > 0 && formats.every((f) => f === "URL");
  return onlyUrl ? "url" : "file";
}

/**
 * The stages a secure-worker job moves through, shown as an honest "here's what
 * will happen to your file" flow on tool pages and documented in
 * docs/WORKER_ARCHITECTURE.md. Auto-delete is a real stage, not a footnote.
 */
export interface PipelineStage {
  id: string;
  title: string;
  description: string;
}

/**
 * The stages a job actually moves through, given what the worker can actually do.
 *
 * This is a function rather than a constant because one of the stages was a lie. The
 * list used to assert "Every file is scanned before any processor touches it. Unsafe
 * files are rejected." on all fourteen worker-backed tool pages, while the malware
 * scanner is optional, off by default, and not configured on production. The worker
 * layer knew — it publishes `active: false` and states that unscanned uploads "are
 * never reported as scanned" — but a static string in the web tier could not read a
 * live capability, so it overrode one and made a security claim the system is
 * explicitly designed never to make.
 *
 * Taking the capability as a parameter means the claim cannot outlive the fact. The
 * argument is a plain boolean, not a `ScanCapability`, to keep `lib/jobs` free of a
 * dependency on `lib/workers`.
 *
 * @param malwareScanActive whether a live worker heartbeat reports an ACTIVE scanner.
 * Callers that cannot observe one pass `false` — the safe direction for a security
 * control, since under-claiming misleads nobody.
 */
export function workerPipelineStages(
  malwareScanActive: boolean,
): readonly PipelineStage[] {
  return [
    {
      id: "upload",
      title: "Encrypted upload",
      description:
        "Your file is uploaded directly to short-lived, encrypted storage over a pre-signed URL.",
    },
    malwareScanActive
      ? {
          id: "scan",
          title: "Malware scan",
          description:
            "Every file is scanned for malware before any processor touches it. Unsafe files are rejected.",
        }
      : {
          // Not a malware scan, and it does not pretend to be. This preflight is real
          // and it does reject files — it checks that an input is structurally the
          // type it claims to be — but calling it a security scan would be the same
          // overclaim in a quieter voice.
          id: "preflight",
          title: "Structural preflight",
          description:
            "Each file is checked that it really is the type it claims to be, and malformed ones are rejected. Files are not scanned for malware here.",
        },
    ...WORKER_PIPELINE_TAIL,
  ];
}

const WORKER_PIPELINE_TAIL: readonly PipelineStage[] = [
  {
    id: "process",
    title: "Isolated processing",
    description:
      "A single-job sandbox with no network egress does the work, then is destroyed.",
  },
  {
    id: "download",
    title: "Download",
    description:
      "You get a signed, expiring link to the result — no account required.",
  },
  {
    id: "delete",
    title: "Auto-delete",
    description:
      "Inputs are wiped right after processing; outputs auto-delete within the retention window.",
  },
] as const;
