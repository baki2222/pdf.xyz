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
 *               organize, extract/delete pages) — a handoff pre-loads the first.
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
 * Filter a list of files to those a tool's runner can actually open. Every live
 * runner today is PDF-only, so this narrows to PDFs; the signature keeps room to
 * branch per tool (e.g. image tools) without touching call sites.
 */
export function eligibleFilesFor<T extends FileMetaLike>(
  slug: string,
  files: T[],
): T[] {
  if (!handoffCapabilityFor(slug).supported) return [];
  return files.filter((file) => isLikelyPdf(file));
}
