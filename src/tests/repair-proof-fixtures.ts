/**
 * Inputs and verdicts for the Repair PDF deployment proof
 * (`scripts/worker-prove-tools.ts`), kept here so they can be tested without a
 * deployment.
 *
 * Until 2026-09-27 the proof sent a HEALTHY PDF named `broken.pdf` and checked
 * only that `%PDF-` came back. It exercised qpdf's exit-0 path and nothing
 * else, so the chain a user with a damaged file depends on — truncated upload,
 * intake, the soundness gate, qpdf's exit 3, the sanitised warnings persisted
 * on the job, the panel — had never run end to end on the deployed worker.
 *
 * The damage recipe is not a guess. pdf-lib's default `save()` writes object
 * streams and an xref STREAM, with no classic `trailer`; qpdf's reconstructor
 * needs one, and refuses such a file with exit 2. Cutting a fixed share off the
 * tail removes the trailer too, and lands in the same refusal. Measured against
 * real qpdf 11.3.0 inside the production worker on 2026-08-11: a classic-xref
 * file cut at its `startxref` keyword — xref table and trailer intact, the
 * pointer to them gone, no `%%EOF` — is recovered with exit 3 ("file is
 * damaged", "Attempting to reconstruct cross-reference table"). That is the
 * recoverable fixture; the tail-less prefix is the unrecoverable one.
 *
 * Each maker checks its own output and throws if the damage is not what its
 * name says: without that, a change here could quietly hand the proof a
 * healthy file again, and it would pass for the wrong reason.
 */
import { PDFDocument } from "pdf-lib";
import type { JobResults } from "@/lib/jobs/results";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { looksLikePdf } from "@/lib/workers/compression/engine";

/** Pages in the damaged fixture — reported beside what came back. */
export const DAMAGED_SOURCE_PAGES = 4;

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** A classic-xref PDF (no object streams) whose pages carry real text. */
async function classicXrefPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const lines = Array.from(
    { length: DAMAGED_SOURCE_PAGES },
    (_, i) => `pdf.xyz repair proof - page ${i + 1}`,
  );
  const font = await embedDrawingFont(doc, lines);
  for (const line of lines) {
    doc.addPage([595, 842]).drawText(line, { x: 60, y: 770, font });
  }
  return doc.save({ useObjectStreams: false });
}

/** Everything wrong with `bytes` as "damaged the way its maker claims". */
export function damageProblems(
  bytes: Uint8Array,
  kind: "recoverable" | "unrecoverable",
): string[] {
  const text = latin1(bytes);
  const tail = latin1(bytes.subarray(Math.max(0, bytes.byteLength - 2048)));
  const problems: string[] = [];
  if (!text.startsWith("%PDF-")) problems.push("no %PDF- header");
  if (tail.includes("%%EOF")) problems.push("%%EOF in the last 2 KiB");
  if (text.includes("startxref")) problems.push("a startxref pointer survives");
  const hasTrailer = text.includes("trailer");
  if (kind === "recoverable" && !hasTrailer)
    problems.push("no trailer — qpdf cannot reconstruct without one");
  if (kind === "unrecoverable" && hasTrailer)
    problems.push("a trailer survives — qpdf may recover it");
  return problems;
}

function checked(bytes: Uint8Array, kind: "recoverable" | "unrecoverable") {
  const problems = damageProblems(bytes, kind);
  if (problems.length > 0)
    throw new Error(`the ${kind} fixture is wrong: ${problems.join("; ")}`);
  return bytes;
}

/** Cut at `startxref`: qpdf rebuilds it and exits 3 (see the module doc). */
export async function recoverablyDamagedPdf(): Promise<Uint8Array> {
  const whole = await classicXrefPdf();
  const cut = latin1(whole).lastIndexOf("startxref");
  return checked(whole.slice(0, cut), "recoverable");
}

/** The first 60%: no xref, no trailer — nothing qpdf can rebuild (exit 2). */
export async function unrecoverablePdf(): Promise<Uint8Array> {
  const whole = await classicXrefPdf();
  return checked(
    whole.slice(0, Math.floor(whole.byteLength * 0.6)),
    "unrecoverable",
  );
}

/**
 * Whether a finished repair job did what it says, read from what a client
 * receives: the artifact bytes, and the job record as GET /api/jobs/:id serves
 * it. `recovered` is the damaged fixture; `clean` the healthy one, where qpdf
 * must NOT report a repair — the panel's sentence is chosen from that flag.
 */
export async function repairProofVerdict(
  bytes: Uint8Array,
  job: { results?: JobResults },
  want: "recovered" | "clean",
): Promise<{ ok: boolean; detail: string }> {
  if (!looksLikePdf(bytes))
    return { ok: false, detail: "the output is not a whole PDF (%%EOF)" };
  let pages: number;
  try {
    pages = (await PDFDocument.load(bytes)).getPageCount();
  } catch (error) {
    return {
      ok: false,
      detail: `pdf-lib could not load the output: ${(error as Error).message}`,
    };
  }
  if (pages < 1) return { ok: false, detail: "the output has no pages" };

  const repair = job.results?.repair;
  if (!repair)
    return {
      ok: false,
      detail:
        "the job record carries no results.repair, so the panel cannot say what was repaired",
    };
  if (want === "recovered") {
    if (!repair.recoveredWithWarnings)
      return {
        ok: false,
        detail: "qpdf reported a clean run on a file with no xref pointer",
      };
    if (repair.warnings.length < 1)
      return { ok: false, detail: "a recovery was reported with no warnings" };
    return {
      ok: true,
      detail: `recovered ${pages} of ${DAMAGED_SOURCE_PAGES} page(s); ${repair.warnings.length} warning(s), first: "${repair.warnings[0]}"`,
    };
  }
  if (repair.recoveredWithWarnings)
    return {
      ok: false,
      detail: `qpdf reported a repair on a healthy file: ${repair.warnings.join(" | ")}`,
    };
  return { ok: true, detail: `${pages} page(s), reported clean` };
}
