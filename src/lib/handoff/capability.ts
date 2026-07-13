/**
 * Per-tool handoff capability: given a tool slug, decide whether staged files
 * can be handed off to its in-browser runner and in what shape. This is pure
 * and derived from the live-runner registry, so it can't drift from what the
 * runners actually accept.
 *
 * Modes:
 *  - `collect`: the runner takes many files and combines them (merge).
 *  - `batch`  : the runner takes many files and processes each one (compress).
 *  - `single` : the runner works on exactly one file at a time (rotate, split,
 *               organize, extract/delete pages, text conversion) — a handoff
 *               pre-loads the first eligible file.
 *  - `none`   : no in-browser handoff (worker/AI tools, or client tools without
 *               a runner yet).
 */

import { isLikelyPdf } from "@/lib/pdf/files";
import { getRunnerKind, type RunnerKind } from "@/lib/pdf/registry";

export type HandoffMode = "collect" | "batch" | "single" | "none";

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
  "text-to-pdf": "single",
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
};

/** Resolve a tool slug to its handoff capability. */
export function handoffCapabilityFor(slug: string): HandoffCapability {
  const kind = getRunnerKind(slug);
  const mode = kind ? MODE_BY_KIND[kind] : "none";
  if (mode === "single") {
    return { mode, supported: true, minFiles: 1, maxFiles: 1 };
  }
  if (mode === "collect" || mode === "batch") {
    return { mode, supported: true, minFiles: mode === "collect" ? 2 : 1 };
  }
  return { mode: "none", supported: false, minFiles: 0, maxFiles: 0 };
}

/** The minimal file shape the eligibility filter needs. */
interface FileMetaLike {
  name: string;
  type: string;
}

/**
 * Filter a list of files to those a tool's runner can actually open.
 */
export function eligibleFilesFor<T extends FileMetaLike>(
  slug: string,
  files: T[],
): T[] {
  if (!handoffCapabilityFor(slug).supported) return [];
  if (getRunnerKind(slug) === "text-to-pdf") {
    return files.filter(
      (file) => file.type === "text/plain" || /\.(txt|text)$/i.test(file.name),
    );
  }
  if (slug === "jpg-to-pdf") {
    return files.filter(
      (file) =>
        file.type === "image/jpeg" ||
        file.type === "image/jpg" ||
        /\.(jpe?g)$/i.test(file.name),
    );
  }
  if (slug === "png-to-pdf") {
    return files.filter((file) => file.type === "image/png" || /\.png$/i.test(file.name));
  }
  return files.filter((file) => isLikelyPdf(file));
}
