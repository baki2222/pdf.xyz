/**
 * The deployment proof's verdict for a Target size job (2026-10-31): read the
 * DOWNLOAD and the job record as served, and agree with neither alone.
 *
 * `isPdf` passes a file that ignored the target, and so would a record that
 * says `met`. The question a reader has is about the file in their hand, so
 * the verdict measures the bytes, then holds the record to them: the record
 * must carry a target block (a worker image older than the feature runs the
 * job at the Quality setting and carries none), for the target that was
 * asked, describing THIS download's size, with a `met` that the size agrees
 * with — and the outcome the spec expected.
 */
import type { JobResults } from "@/lib/jobs/results";
import { looksLikePdf } from "./engine";

export function targetProofVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
  want: { targetBytes: number; met: boolean },
): { ok: boolean; detail: string } {
  const fail = (detail: string) => ({ ok: false, detail });
  if (!looksLikePdf(bytes)) return fail("the download is not a PDF");
  const block = results?.compression?.target;
  if (!block) {
    return fail(
      "the job record carries no target block: this worker did not apply the target",
    );
  }
  if (block.targetBytes !== want.targetBytes) {
    return fail(
      `the record's target is ${block.targetBytes} B, the job asked for ${want.targetBytes} B`,
    );
  }
  if (block.outputBytes !== bytes.byteLength) {
    return fail(
      `the record describes a ${block.outputBytes} B file, the download is ${bytes.byteLength} B`,
    );
  }
  const met = bytes.byteLength <= want.targetBytes;
  if (block.met !== met) {
    return fail(
      `the record says met ${block.met}, the download's ${bytes.byteLength} B says ${met}`,
    );
  }
  if (met !== want.met) {
    return fail(
      `expected met ${want.met}, got ${bytes.byteLength} B against ${want.targetBytes} B`,
    );
  }
  return {
    ok: true,
    detail: `${bytes.byteLength} B against a ${want.targetBytes} B target after ${block.attempts} engine runs, met ${met}`,
  };
}
