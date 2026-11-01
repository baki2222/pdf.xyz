/**
 * Per-tool handoff capability: given a tool slug, decide whether staged files
 * can be handed off to its in-browser runner and in what shape. Pure, and
 * derived twice over: the MODE from the live-runner registry, the FILES from
 * the tool's catalogue `accept` row read through the one recogniser — and the
 * second is held to each runner's own check (`capability.test.ts`).
 *
 * Modes:
 *  - `collect`: the runner takes many files and combines them (merge).
 *  - `batch`  : the runner takes many files and processes each one (compress).
 *  - `single` : the runner works on exactly one file at a time (rotate, split,
 *               organize, extract/delete pages, text conversion) — a handoff
 *               pre-loads the first eligible file.
 *  - `stage`  : a secure-worker or AI panel (every tool with no in-browser
 *               runner, which `tool-page-registry.test.ts` routes to a
 *               panel) that takes files. It STAGES the first eligible file:
 *               the file waits in the panel, in this browser, and is
 *               uploaded only when the reader presses Run (WP-10).
 *  - `none`   : nothing to carry into — an unknown slug, or a tool that
 *               takes no file at all (webpage-to-pdf takes a URL).
 */

import { formatOf, toolAcceptsFormat } from "@/lib/intent/formats";
import { getRunnerKind, type RunnerKind } from "@/lib/pdf/registry";
import { getToolEntry } from "@/lib/tools/directory";

export type HandoffMode = "collect" | "batch" | "single" | "stage" | "none";

/** A mode that takes exactly one file: a single runner, or a staged panel. */
export function takesOneFile(mode: HandoffMode): boolean {
  return mode === "single" || mode === "stage";
}

export interface HandoffCapability {
  mode: HandoffMode;
  /** True when the tool can receive a handoff at all (`mode !== "none"`). */
  supported: boolean;
  /** Minimum files that make the handoff useful (informational). */
  minFiles: number;
  /** Max files the runner will consume from a handoff, when bounded. */
  maxFiles?: number;
}

/** Runner kind → handoff mode. Every live runner maps to exactly one mode. */
const MODE_BY_KIND: Record<RunnerKind, HandoffMode> = {
  merge: "collect",
  compress: "batch",
  rotate: "single",
  organize: "single",
  split: "single",
  "delete-pages": "single",
  "extract-pages": "single",
  "pdf-to-text": "single",
  "pdf-to-markdown": "single",
  "text-to-pdf": "single",
  "markdown-to-pdf": "single",
  "image-to-pdf": "batch",
  "pdf-to-image": "single",
  "page-numbers": "single",
  watermark: "single",
  "header-footer": "single",
  crop: "single",
  sign: "single",
  flatten: "single",
  overlay: "single",
  grayscale: "single",
  redact: "single",
  "fill-forms": "single",
  "create-forms": "single",
  annotate: "single",
  edit: "single",
  "extract-images": "single",
  compare: "collect",
  scan: "batch",
  metadata: "single",
  resize: "single",
  "n-up": "single",
  "split-half": "single",
};

/** Resolve a tool slug to its handoff capability. */
export function handoffCapabilityFor(slug: string): HandoffCapability {
  const kind = getRunnerKind(slug);
  const mode = kind ? MODE_BY_KIND[kind] : stagedMode(slug);
  if (takesOneFile(mode)) {
    return { mode, supported: true, minFiles: 1, maxFiles: 1 };
  }
  if (mode === "collect" || mode === "batch") {
    return { mode, supported: true, minFiles: mode === "collect" ? 2 : 1 };
  }
  return { mode: "none", supported: false, minFiles: 0, maxFiles: 0 };
}

/**
 * A tool with no in-browser runner is a worker panel's; it stages a file
 * when its catalogue row takes files — every format but a lone `URL`.
 */
function stagedMode(slug: string): HandoffMode {
  const accept = getToolEntry(slug)?.accept;
  if (!accept || accept.length === 0) return "none";
  return accept.every((f) => f.toUpperCase() === "URL") ? "none" : "stage";
}

/** The minimal file shape the eligibility filter needs. */
interface FileMetaLike {
  name: string;
  type: string;
}

/**
 * Filter a list of files to those a tool's runner can actually open: the
 * files whose format — read by `formatOf`, the one recogniser — is in the
 * tool's catalogue `accept` row.
 *
 * WAS a branch per slug (a regex for Text to PDF, another for Markdown, a MIME
 * list for the two image tools, `isLikelyPdf` for the rest): a second
 * statement of what `accept` already said, which nothing held to it. It
 * carried a `.docx` declared as a PDF to every PDF runner, and a `.md` typed
 * `text/plain` to Text to PDF. `capability.test.ts` now holds this to the row
 * for every runner-backed tool, and to each runner's OWN check — a carried
 * file must be one the runner opens.
 */
export function eligibleFilesFor<T extends FileMetaLike>(
  slug: string,
  files: T[],
): T[] {
  if (!handoffCapabilityFor(slug).supported) return [];
  const accept = getToolEntry(slug)?.accept;
  if (!accept) return [];
  return files.filter((file) =>
    toolAcceptsFormat(accept, formatOf(file).format),
  );
}
