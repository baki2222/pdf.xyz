/**
 * The deployment proof's input and verdict for PDF to PDF/A's level picker
 * (audit pdf-to-pdfa#1) and its carried title and author (pdf-to-pdfa#3),
 * read from the file a person downloads.
 *
 * Three properties change with the options, and each is read here:
 *
 *   1. The identification: the engine's own question (`inspectPdfAMarkers`)
 *      asked for the level the job named, `pdfaid:part` 1, 2 or 3 with
 *      conformance B and the PDF/A output intent. A worker older than the
 *      picker ignores `level` and always writes part 2.
 *   2. The header: PDF/A-1 is built on PDF 1.4, so a 1b file must start
 *      `%PDF-1.4` (`ghostscriptPdfAArgs` pins it). Other levels' headers are
 *      reported, not judged: nothing on this branch pins them.
 *   3. Title and Author, in the Info dictionary AND the XMP (`dc:title`,
 *      `dc:creator`), which is where archives index them. Before
 *      `./docinfo`, Ghostscript discarded the DOCINFO of essentially every
 *      PDF that carries producer text, so the copy came back without them.
 *      The input carries pdf-lib's own Producer and Creator, as real files
 *      carry their writer's.
 *
 * Health: an unreadable file, or one with no XMP, fails before anything is
 * compared. The fields are plain ASCII with no brackets or backslash, which
 * is exactly what `carriedValue` says the worker carries, so a failure here
 * is not the documented "not carried" case.
 *
 * Pure (pdf-lib only), so the unit tests and `scripts/worker-prove-tools.ts`
 * ask the same question of the same function.
 */
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { inspectPdfAMarkers } from "./pdfa-markers";
import { PDFA_LEVELS, type PdfALevelId } from "./levels";
import { carriedValue } from "./docinfo";

/** The fields the proof input carries; each must come through unchanged. */
export const PDFA_PROOF_DOCINFO = {
  title: "pdf.xyz PDF-A level proof",
  author: "pdf.xyz proof harness",
} as const;

/** One page, a filled shape, and the title and author above. Deterministic. */
export async function pdfaLevelProofPdf(): Promise<Uint8Array> {
  const stamp = new Date("2026-01-01T00:00:00Z");
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawRectangle({
    x: 40,
    y: 40,
    width: 220,
    height: 120,
    color: rgb(0.1, 0.5, 0.3),
  });
  doc.setTitle(PDFA_PROOF_DOCINFO.title);
  doc.setAuthor(PDFA_PROOF_DOCINFO.author);
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);
  return doc.save({ useObjectStreams: false });
}

/** The header's version (`1.4` from `%PDF-1.4`), or null. */
export function pdfHeaderVersion(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return /%PDF-(\d\.\d)/.exec(head)?.[1] ?? null;
}

const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The text inside a `dc:<name>` element (whatever the prefix), tags stripped. */
function dcText(xmp: string, name: string): string | undefined {
  const binding = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*(["'])${escapeRegExp(DC_NAMESPACE)}\\2`,
  ).exec(xmp);
  if (!binding) return undefined;
  const q = escapeRegExp(`${binding[1]}:${name}`);
  const inner = new RegExp(`<${q}(?:\\s[^>]*)?>([\\s\\S]*?)</${q}>`).exec(
    xmp,
  )?.[1];
  return inner
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataText(doc: PDFDocument): string | undefined {
  const stream = doc.catalog.lookup(PDFName.of("Metadata"));
  if (!(stream instanceof PDFRawStream)) return undefined;
  const bytes = stream.dict.has(PDFName.of("Filter"))
    ? decodePDFRawStream(stream).decode()
    : stream.contents;
  return new TextDecoder("utf-8").decode(bytes);
}

export async function pdfaLevelProofVerdict(
  bytes: Uint8Array,
  levelId: PdfALevelId,
  docInfo: { title: string; author: string } = PDFA_PROOF_DOCINFO,
): Promise<{ ok: boolean; detail: string }> {
  const fail = (detail: string) => ({ ok: false, detail });
  const level = PDFA_LEVELS.find((l) => l.id === levelId);
  if (!level) return fail(`"${levelId}" is not an offered level`);
  for (const value of [docInfo.title, docInfo.author])
    if (carriedValue(value) !== value)
      return fail(
        `"${value}" is a value the worker documents it does not carry, so its absence would prove nothing`,
      );
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    return fail("the download could not be parsed as a PDF");
  }
  let xmp: string | undefined;
  try {
    xmp = metadataText(doc);
  } catch {
    xmp = undefined;
  }
  if (xmp === undefined) return fail("the download has no readable XMP");
  const version = pdfHeaderVersion(bytes);
  const markers = await inspectPdfAMarkers(bytes, {
    part: level.part,
    conformance: level.conformance,
  });
  const info = { title: doc.getTitle(), author: doc.getAuthor() };
  const dc = { title: dcText(xmp, "title"), creator: dcText(xmp, "creator") };
  const seen = `header ${version ?? "(none)"}, XMP part ${markers.part ?? "(none)"} conformance ${markers.conformance ?? "(none)"}, Info title ${JSON.stringify(info.title ?? null)}`;
  const problems = [...markers.problems];
  if (level.part === "1" && version !== "1.4")
    problems.push(
      `${level.standard} is built on PDF 1.4, the header says ${version}`,
    );
  if (info.title !== docInfo.title)
    problems.push("the Info dictionary lost the title");
  if (info.author !== docInfo.author)
    problems.push("the Info dictionary lost the author");
  if (!dc.title?.includes(docInfo.title))
    problems.push("the XMP has no dc:title with the title");
  if (!dc.creator?.includes(docInfo.author))
    problems.push("the XMP has no dc:creator with the author");
  return problems.length === 0
    ? {
        ok: true,
        detail: `${level.standard} declared (${seen}); title and author in Info and XMP (declaration only — not validated)`,
      }
    : fail(`${seen}: ${problems.join("; ")}`);
}
