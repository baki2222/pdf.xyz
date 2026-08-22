import { capabilityForMode, describeCapability } from "@/lib/jobs/capabilities";
import { tools } from "./catalog";
import type { ProcessingMode, Tool } from "./types";

/**
 * How many tools "run in your browser" — asked once, answered in one place.
 *
 * On 2026-08-22 three surfaces gave a reader two different answers. The
 * homepage said 30 (twice), `/status` and `/privacy` said 29, and `/privacy`
 * added "the remaining 21 send your file to a processing worker". Nothing was
 * a typo: 29 is `client`, 30 is `client + hybrid`, 21 is `server + ai +
 * hybrid`, and `compress-pdf` — the one `hybrid` tool — is the member that
 * moves. Both numbers were defensible and EACH WAS ALREADY DERIVED from the
 * catalogue at its own call site, which is exactly why the split survived
 * review: every surface could show its work.
 *
 * What a reader could not do was reconcile them. 29 + 21 = 50 and 30 + 20 = 50
 * are two complete partitions of the same catalogue, but the pages mixed them:
 * a visitor who read the homepage and then the policy was handed 30 in-browser
 * and 21 uploading — 51 tools out of 50, with nothing on either page saying
 * one tool is in both sets. Two true numbers, presented as one claim. Deriving
 * is necessary and not sufficient; it has to be the SAME derivation.
 *
 * So the fix is not a number. It is that "in-browser" is TWO questions, and a
 * count means nothing until the page says which one it answers:
 *
 *   - "can this tool ever send my file anywhere?" → {@link ProcessingSplit.neverUploads}
 *   - "does a local path exist at all?"           → {@link ProcessingSplit.hasBrowserPath}
 *
 * The primitive is the three-way PARTITION — every tool lands in exactly one of
 * `neverUploads`, `browserFirst`, `workerOnly` — and the two answers above are
 * named unions over it. Naming them is the point: a surface has to pick a
 * proposition, and the name it picks is the proposition it asserts.
 *
 * Which one to pick is a judgement, and this codebase has made it: **a sentence
 * framed around privacy takes the conservative union.** All three surfaces
 * frame it that way — the homepage sells "without giving up your privacy", the
 * spec strip sits beside "0 files stored after processing", `/privacy` is a
 * policy, `/status` heads the list with "your files never leave the browser".
 * Under that frame the only number a reader can act on is how many tools can
 * never send the file anywhere, and `hasBrowserPath` is not that number.
 */
export interface ProcessingSplit {
  /**
   * PARTITION MEMBER. No upload path exists at all. These are the tools a
   * "your files never leave your device" sentence may count.
   */
  neverUploads: Tool[];
  /**
   * PARTITION MEMBER. Tries the browser first and can fall back to the worker.
   * Real local capability AND a real upload path, which is why it belongs to
   * both unions below and to neither headline number cleanly.
   */
  browserFirst: Tool[];
  /** PARTITION MEMBER. No local path; the file is always uploaded. */
  workerOnly: Tool[];

  /**
   * UNION — the privacy answer's other half: `browserFirst + workerOnly`.
   * "May be uploaded", not "is uploaded", because for a browser-first tool the
   * upload is a fallback. A policy may overstate toward the upload, never away
   * from it.
   */
  mayUpload: Tool[];
  /**
   * UNION — the capability answer: `neverUploads + browserFirst`. Every tool
   * shipping an in-browser engine, which is the set the client-proof e2e run
   * drives end to end. NOT a privacy number: one of these can upload.
   */
  hasBrowserPath: Tool[];
}

/**
 * Does a file leave the device under this mode?
 *
 * DERIVED, not restated. `lib/jobs` already owns this meaning as a composed
 * chain the API validators and `/status`'s capability cards run on:
 * `ProcessingMode → CAPABILITY_BY_MODE → CAPABILITY_DESCRIPTORS[].uploadsFiles`.
 * Writing `mode !== "client"` here would have been a fourth copy of a rule that
 * already existed in three places, and the whole defect this module answers is
 * a rule held privately at each call site. Both maps in that chain are
 * `Record<>` over closed unions, so a new mode is a compile error there before
 * it can be a wrong number here.
 */
export function modeUploadsFiles(mode: ProcessingMode): boolean {
  return describeCapability(capabilityForMode(mode)).uploadsFiles;
}

/**
 * Does an in-browser engine exist for this mode?
 *
 * The one thing the capability chain does NOT already answer: nothing in
 * `lib/jobs` distinguishes "uploads because it must" from "uploads only as a
 * fallback", because to the job layer both are simply jobs. It is not derived
 * from the runner registry either, on purpose — `e2e/client-proof` exists to
 * cross-check the registry against the catalogue as two independently written
 * bounds, and deriving one from the other would turn that proof into a
 * tautology.
 *
 * So this is a genuinely new statement, and it is bound to the derived one
 * rather than left free: a mode that never uploads MUST have a browser path,
 * or the tool runs nowhere. `processing-split.test.ts` asserts that
 * implication across every mode, which is what stops these two records from
 * drifting into disagreement.
 */
export function modeHasBrowserPath(mode: ProcessingMode): boolean {
  return HAS_BROWSER_PATH[mode];
}

const HAS_BROWSER_PATH: Record<ProcessingMode, boolean> = {
  client: true,
  hybrid: true,
  server: false,
  ai: false,
};

/**
 * Partition a catalogue by what can leave the device.
 *
 * Takes the tool list as an argument, defaulting to the real catalogue, so the
 * guard can run it over a MUTATED copy and prove the groups move — without
 * mocking `./catalog`, which this suite runs `isolate: false` and cannot mock
 * safely (see `src/tests/mock-isolation.test.ts`).
 */
export function processingSplit(
  source: readonly Tool[] = tools,
): ProcessingSplit {
  const neverUploads: Tool[] = [];
  const browserFirst: Tool[] = [];
  const workerOnly: Tool[] = [];
  for (const tool of source) {
    if (!modeUploadsFiles(tool.processing)) neverUploads.push(tool);
    else if (modeHasBrowserPath(tool.processing)) browserFirst.push(tool);
    else workerOnly.push(tool);
  }
  return {
    neverUploads,
    browserFirst,
    workerOnly,
    mayUpload: [...browserFirst, ...workerOnly],
    hasBrowserPath: [...neverUploads, ...browserFirst],
  };
}
