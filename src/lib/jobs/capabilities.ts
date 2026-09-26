/**
 * Tool capability metadata: the bridge between the catalog's `ProcessingMode`
 * and the job/worker layer's {@link ToolCapability}. This is the single source
 * of truth for "where does this tool run, does it upload files, and what is the
 * secure-worker flow it will follow" — consumed by the API validators, the tool
 * pages, and the docs.
 */

import { getToolBySlug } from "@/lib/tools";
import { HYBRID_SUMMARY } from "@/lib/tools/processing";
import type { ProcessingMode, Tool } from "@/lib/tools/types";
import { acceptsDamagedPdf } from "./damaged-input";
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
 * counts because a job submitted to the API is, by definition, the optional
 * worker step the user started — the browser path never calls the API.
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
    // The mode line's own sentence, not a second one about the same mode: this
    // said "when it can, with an encrypted secure-worker fallback for large or
    // complex files" — a route to the server that does not exist.
    summary: HYBRID_SUMMARY,
    uploadsFiles: true,
  },
  ai: {
    id: "ai",
    label: "AI",
    // Names the third party. "Runs on secure AI infrastructure" described a
    // provider's API as if it were ours, on the pages whose text is sent to it.
    // The training clause is worded from section 3 of the privacy policy — the
    // provider's terms prohibit it — rather than as a promise about what a
    // company we do not run will never do.
    summary:
      "Sends your PDF's selectable text — not the file — to a third-party AI provider to answer your request, under terms that prohibit training on it.",
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
 * File input or a single URL, decided from a catalog `accept` list alone. Only a
 * tool whose every accepted format is `URL` (webpage-to-pdf) takes an address
 * instead of uploads. One definition, read by {@link getToolInputKind} and by
 * {@link workerPipelineStages}, so the job API and the page cannot disagree about
 * which tools upload.
 */
function inputKindForAccept(accept: readonly string[]): ToolInputKind {
  const formats = accept.map((f) => f.toUpperCase());
  const onlyUrl = formats.length > 0 && formats.every((f) => f === "URL");
  return onlyUrl ? "url" : "file";
}

/**
 * Whether a tool takes uploaded files or a single URL. Only URL-input tools
 * (e.g. webpage-to-pdf) accept a `url` option instead of uploads; everything
 * else takes files. Derived from the catalog's `accept` list.
 */
export function getToolInputKind(slug: string): ToolInputKind | undefined {
  const tool = getToolBySlug(slug);
  if (!tool) return undefined;
  return inputKindForAccept(tool.accept);
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

/** What {@link workerPipelineStages} needs to know about the tool it describes. */
export type PipelineTool = Pick<Tool, "slug" | "processing" | "accept">;

/**
 * The stages a job actually moves through, given what the worker can actually do
 * and what THIS tool does with its input.
 *
 * This is a function rather than a constant because the constant lied, three
 * separate ways, on every worker-backed tool page:
 *
 *  1. **The scan stage.** It asserted "Every file is scanned before any processor
 *     touches it" while the malware scanner was optional and off, so it became a
 *     function of the live capability. But the server-rendered page — the one every
 *     crawler reads — has no heartbeat, and it was rendered as `false`: production
 *     served "Files are not scanned for malware here" while `/api/worker/status`
 *     reported an active scanner. Under-claiming a security control is still a
 *     false claim, so "not observed" is now its own state, `null`, and makes
 *     neither claim.
 *
 *  2. **The processing stage** said "A single-job sandbox with no network egress
 *     does the work, then is destroyed." The worker is one long-running daemon
 *     (`Dockerfile` CMD `worker:daemon`, `restart: unless-stopped`) that has to
 *     reach object storage and the queue over the network; there is no per-job
 *     sandbox and no egress policy anywhere in the worker. On the four AI pages the
 *     sentence sat beside a tool that sends the document's text to a third-party
 *     AI provider, and on webpage-to-pdf beside a tool whose whole job is a network
 *     fetch. The stage now says only what is true of every tool that shares it, and
 *     the AI and URL variants say where the content goes.
 *
 *  3. **The preflight stage** said each file "really is the type it claims to be,
 *     and malformed ones are rejected". The soundness gate checks a PDF header and
 *     a declared-type agreement, nothing deeper — and on the one tool that exists
 *     to take broken PDFs ({@link acceptsDamagedPdf}), refusing malformed files is
 *     the opposite of what it is for. The copy now names the checks the gate runs
 *     by default, and that tool says it takes the damage.
 *
 * `pipeline-honesty.test.ts` renders every tool page as a reader receives it and
 * holds these stages to the code that makes them true, including a ban on the
 * isolation vocabulary whose exit condition is a PROPERTY, not a mechanism.
 *
 * @param malwareScanActive whether a live worker heartbeat reports an ACTIVE
 * scanner, or `null` when none has been observed (server render, loading, a failed
 * status fetch). Callers pass `status ? status.scan.active : null` — never
 * `?? false`, which is the defect described in (1).
 * @param tool the tool whose page this is. Required, so a new panel cannot forget
 * that an AI tool or a URL tool has a different story to tell.
 */
export function workerPipelineStages(
  malwareScanActive: boolean | null,
  tool: PipelineTool,
): readonly PipelineStage[] {
  if (inputKindForAccept(tool.accept) === "url") return URL_PIPELINE;

  return [
    {
      id: "upload",
      title: "Encrypted upload",
      description:
        "Your file is uploaded directly to short-lived, encrypted storage over a pre-signed URL.",
    },
    checksStage(malwareScanActive, tool),
    capabilityForMode(tool.processing) === "ai" ? AI_PROCESS : WORKER_PROCESS,
    DOWNLOAD_STAGE,
    {
      id: "delete",
      title: "Auto-delete",
      description:
        "Inputs are wiped right after processing; outputs auto-delete within the retention window.",
    },
  ];
}

/**
 * What the worker's soundness gate refuses, in the order it checks, as it ships
 * (`DEFAULT_SOUNDNESS_POLICY`: PDF header required, content-type consistency on,
 * the `%%EOF` check off). `pipeline-honesty.test.ts` runs the real gate against
 * each clause, so the policy and this sentence cannot part ways silently. The
 * PDF-header clause appears only where the tool takes PDFs.
 */
function preflightRefusals(tool: PipelineTool): string {
  const takesPdf = tool.accept.some((f) => f.toUpperCase() === "PDF");
  return takesPdf
    ? "an empty file, a file whose declared type contradicts its name or this tool, or a PDF with no PDF header is refused"
    : "an empty file, or a file whose declared type contradicts its name or this tool, is refused";
}

/** The damaged-input exemption, stated right where the refusals are. */
function damageClause(tool: PipelineTool): string {
  return acceptsDamagedPdf(tool.slug)
    ? " A damaged or truncated PDF is not refused for its damage — recovering it is what this tool does."
    : "";
}

function checksStage(
  malwareScanActive: boolean | null,
  tool: PipelineTool,
): PipelineStage {
  if (malwareScanActive === true) {
    return {
      id: "scan",
      title: "Malware scan",
      description:
        "Every file is scanned for malware before any processor touches it. Unsafe files are rejected.",
    };
  }
  if (malwareScanActive === false) {
    // Not a malware scan, and it does not pretend to be. The preflight is real and
    // it does refuse files, but calling it a security scan would be the same
    // overclaim in a quieter voice.
    return {
      id: "preflight",
      title: "Structural preflight",
      description: `Each file is checked before any processor sees it: ${preflightRefusals(tool)}.${damageClause(tool)} Files are not scanned for malware here.`,
    };
  }
  // No heartbeat observed. Say what holds in both worlds, and name where the rest
  // of the answer comes from, rather than guessing in either direction.
  return {
    id: "checks",
    title: "Safety checks",
    description: `Each file is checked before any processor sees it: ${preflightRefusals(tool)}.${damageClause(tool)} Whether a malware scan runs as well is reported by the live worker, and shows here once this page has heard from it.`,
  };
}

const WORKER_PROCESS: PipelineStage = {
  id: "process",
  title: "Processing",
  description:
    "A separate processing server — not this website — fetches your file from that storage and does the work.",
};

/**
 * The AI tools' processing step. The worker does not do the AI work; a
 * third-party provider does, from the text the worker extracts. Worded from
 * section 3 of the privacy policy, which is where the rest of that story lives.
 */
const AI_PROCESS: PipelineStage = {
  id: "process",
  title: "AI processing",
  description:
    "A separate processing server extracts the PDF's selectable text and sends that text to a third-party AI provider to produce the result. The PDF file itself is not sent to the provider — section 3 of our privacy policy has the details.",
};

const DOWNLOAD_STAGE: PipelineStage = {
  id: "download",
  title: "Download",
  description:
    "You get a signed, expiring link to the result — no account required.",
};

/**
 * A URL tool uploads nothing, so there is no file to scan or preflight. What it
 * does instead is reach out to the web on the reader's behalf, and it says so.
 */
const URL_PIPELINE: readonly PipelineStage[] = [
  {
    id: "address",
    title: "Address check",
    description:
      "Nothing is uploaded from your device. The address must be a public http(s) URL — localhost and private-network addresses are refused.",
  },
  {
    id: "process",
    title: "Fetch and render",
    description:
      "A browser on our processing server loads that page from the internet and prints it to PDF. The site sees the request come from our server, not from you.",
  },
  DOWNLOAD_STAGE,
  {
    id: "delete",
    title: "Auto-delete",
    description: "The rendered PDF auto-deletes within the retention window.",
  },
];
