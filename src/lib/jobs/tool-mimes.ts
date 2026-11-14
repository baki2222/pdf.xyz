/**
 * Every MIME type a tool's job may carry as an input: the ONE definition the
 * job API's validator (`validation.ts`) and the worker's file-soundness gate
 * (`@/lib/workers/soundness/policy`) both read.
 *
 * It is the catalogue's `accept` formats through {@link MIME_BY_FORMAT}, plus
 * what a tool takes that is deliberately NOT a catalogue format: HTML to PDF
 * also takes a ZIP of a page and its files (competitor audit #26). The
 * catalogue's `accept` is what the site-wide file router offers a dropped
 * file to, and a ZIP dropped on the home page is almost never a web page, so
 * ZIP stays out of it. Whether the running worker can print one is decided
 * by `POST /api/uploads` and `POST /api/jobs`, from the heartbeat.
 *
 * WHY ONE FUNCTION (production, 2026-11-14). The ZIP rule was written into
 * `validation.ts` only. The worker's soundness gate derived a tool's accepted
 * input families from the catalogue alone, so it refused every ZIP as an
 * "unsupported family" BEFORE the processor ran — while the worker's own
 * start-up proof, which called the processor directly, published
 * `htmlZip: true`. The page offered ZIP, the APIs admitted it, and every real
 * ZIP job failed with "did not pass a basic soundness check". Two copies of
 * one rule, each tested on its own, and the path through both dropped
 * everything. `tool-mimes.test.ts` now sends every MIME this function admits
 * for every tool through the REAL soundness check.
 */
import { MIME_BY_FORMAT } from "./mime-by-format";
import { HTML_ZIP_MIMES } from "@/lib/workers/html-render/zip-config";

/** The tool slug that also takes a ZIP of a page (not a catalogue format). */
export const ZIP_PAGE_TOOL = "html-to-pdf";

export function acceptedMimesForTool(tool: {
  readonly slug: string;
  readonly accept: readonly string[];
}): Set<string> {
  const set = new Set<string>();
  for (const format of tool.accept) {
    const mimes = MIME_BY_FORMAT[format.toUpperCase()];
    if (mimes) for (const mime of mimes) set.add(mime);
  }
  if (tool.slug === ZIP_PAGE_TOOL)
    for (const mime of HTML_ZIP_MIMES) set.add(mime);
  return set;
}
