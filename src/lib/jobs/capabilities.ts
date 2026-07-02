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
      "Runs entirely on your device with WebAssembly and browser APIs. Files are never uploaded.",
    uploadsFiles: false,
  },
  "secure-worker": {
    id: "secure-worker",
    label: "Secure worker",
    summary:
      "Runs on an encrypted, isolated worker that scans, processes, and then permanently deletes your files.",
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

export const WORKER_PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: "upload",
    title: "Encrypted upload",
    description:
      "Your file is uploaded directly to short-lived, encrypted storage over a pre-signed URL.",
  },
  {
    id: "scan",
    title: "Malware scan",
    description:
      "Every file is scanned before any processor touches it. Unsafe files are rejected.",
  },
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
