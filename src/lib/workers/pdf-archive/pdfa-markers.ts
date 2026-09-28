/**
 * Does a PDF DECLARE PDF/A-2b the way an archive's intake reads it?
 *
 * This is the check that stood between "Ghostscript exited 0" and "we hand the
 * user a file that says PDF/A". Until it existed, nothing did: the engine's
 * only output check was `looksLikePdf` (a `%PDF-` header), and the production
 * proof asserted the same thing, so a file carrying a `pdfaid:part=2` claim
 * that every validator rejects would have passed both. The argv also ran
 * without the OutputIntent the Ghostscript PDF/A recipe requires for
 * device-dependent colour — the one piece of the declaration this module finds
 * missing first.
 *
 * WHAT IT CHECKS — two declarations, both read through a real parse:
 *
 *   1. Catalog `/OutputIntents` holds a dictionary with `/S /GTS_PDFA1` whose
 *      `/DestOutputProfile` resolves to a stream (the embedded ICC profile).
 *   2. Catalog `/Metadata` is an XMP stream that binds the PDF/A identification
 *      namespace and says `part = 2`, `conformance = B` — in either XMP spelling
 *      (attribute `pdfaid:part='2'`, which is what Ghostscript writes, or element
 *      `<pdfaid:part>2</pdfaid:part>`), and whatever prefix the namespace is
 *      bound to.
 *
 * WHY A PARSE AND NOT A BYTE SEARCH: a writer may put the catalog inside a
 * compressed object stream, where `/OutputIntents` does not exist as bytes, so a
 * grep fails a correct file; and any content stream can contain the text
 * `/GTS_PDFA1`, so a grep passes a wrong one. Both directions are pinned in
 * `pdfa-markers.test.ts`.
 *
 * WHAT IT DOES NOT CHECK — and why no copy may say otherwise: this is the
 * declaration, not conformance. PDF/A-2b has well over a hundred rules (fonts
 * embedded, no transparency groups without a blending colour space, no
 * encryption, …) that only a validator such as veraPDF evaluates. A file that
 * passes here claims PDF/A-2b and carries what the claim needs to be read; it is
 * not thereby valid. The panel keeps saying "not validated" for that reason.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  ParseSpeeds,
  decodePDFRawStream,
} from "pdf-lib";

/** The only PDF/A identification this tool claims to produce. */
export const PDFA_EXPECTED_PART = "2";
export const PDFA_EXPECTED_CONFORMANCE = "B";
/** The output-intent subtype PDF/A requires (PDF/A-2 reuses the PDF/A-1 name). */
export const PDFA_OUTPUT_INTENT_SUBTYPE = "GTS_PDFA1";
/** The XMP namespace for PDF/A identification (ISO 19005-1 §6.7.11). */
export const PDFA_ID_NAMESPACE = "http://www.aiim.org/pdfa/ns/id/";

export interface PdfAMarkerReport {
  /** True only when BOTH declarations are present and say PDF/A-2b. */
  ok: boolean;
  /** One line per missing or wrong declaration. Empty when `ok`. */
  problems: string[];
  /** What the XMP said, when it said anything. */
  part?: string;
  conformance?: string;
}

function outputIntentProblems(doc: PDFDocument): string[] {
  const intents = doc.catalog.lookupMaybe(
    PDFName.of("OutputIntents"),
    PDFArray,
  );
  if (!intents || intents.size() === 0)
    return ["the catalog has no /OutputIntents"];
  let sawPdfA = false;
  for (let i = 0; i < intents.size(); i++) {
    const intent = intents.lookupMaybe(i, PDFDict);
    if (!intent) continue;
    const subtype = intent.lookupMaybe(PDFName.of("S"), PDFName);
    if (subtype?.decodeText() !== PDFA_OUTPUT_INTENT_SUBTYPE) continue;
    sawPdfA = true;
    const profile = intent.lookup(PDFName.of("DestOutputProfile"));
    if (profile instanceof PDFStream) return [];
  }
  return [
    sawPdfA
      ? `the /${PDFA_OUTPUT_INTENT_SUBTYPE} output intent has no /DestOutputProfile stream`
      : `no output intent has /S /${PDFA_OUTPUT_INTENT_SUBTYPE}`,
  ];
}

function metadataText(doc: PDFDocument): string | undefined {
  const stream = doc.catalog.lookup(PDFName.of("Metadata"));
  if (!(stream instanceof PDFRawStream)) return undefined;
  const bytes = stream.dict.has(PDFName.of("Filter"))
    ? decodePDFRawStream(stream).decode()
    : stream.contents;
  return new TextDecoder("utf-8").decode(bytes);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Read one pdfaid property in either XMP spelling, under whatever prefix. */
function xmpProperty(
  xmp: string,
  prefix: string,
  name: string,
): string | undefined {
  const qualified = escapeRegExp(`${prefix}:${name}`);
  const attribute = new RegExp(
    `${qualified}\\s*=\\s*(["'])\\s*([^"']*?)\\s*\\1`,
  );
  const element = new RegExp(
    `<${qualified}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</${qualified}>`,
  );
  return xmp.match(attribute)?.[2] ?? xmp.match(element)?.[1];
}

function identificationProblems(doc: PDFDocument): {
  problems: string[];
  part?: string;
  conformance?: string;
} {
  const xmp = metadataText(doc);
  if (xmp === undefined)
    return { problems: ["the catalog has no /Metadata XMP stream"] };
  const binding = new RegExp(
    `xmlns:([A-Za-z_][\\w.-]*)\\s*=\\s*(["'])${escapeRegExp(PDFA_ID_NAMESPACE)}\\2`,
  ).exec(xmp);
  if (!binding)
    return {
      problems: ["the XMP does not bind the PDF/A identification schema"],
    };
  const prefix = binding[1]!;
  const part = xmpProperty(xmp, prefix, "part");
  const conformance = xmpProperty(xmp, prefix, "conformance");
  const problems: string[] = [];
  if (part !== PDFA_EXPECTED_PART)
    problems.push(
      `the XMP declares PDF/A part ${part ?? "(none)"}, not ${PDFA_EXPECTED_PART}`,
    );
  if (conformance !== PDFA_EXPECTED_CONFORMANCE)
    problems.push(
      `the XMP declares conformance ${conformance ?? "(none)"}, not ${PDFA_EXPECTED_CONFORMANCE}`,
    );
  return {
    problems,
    ...(part !== undefined ? { part } : {}),
    ...(conformance !== undefined ? { conformance } : {}),
  };
}

/** Parse `bytes` and report whether they declare PDF/A-2b. Never throws. */
export async function inspectPdfAMarkers(
  bytes: Uint8Array,
): Promise<PdfAMarkerReport> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
      parseSpeed: ParseSpeeds.Fastest,
    });
  } catch {
    return { ok: false, problems: ["the file could not be parsed as a PDF"] };
  }
  let intentProblems: string[];
  let id: ReturnType<typeof identificationProblems>;
  try {
    intentProblems = outputIntentProblems(doc);
    id = identificationProblems(doc);
  } catch {
    // A declaration present with the wrong object type (an /OutputIntents that
    // is not an array, a filter pdf-lib cannot decode) is not a declaration.
    return {
      ok: false,
      problems: ["the PDF/A declarations are present but malformed"],
    };
  }
  const problems = [...intentProblems, ...id.problems];
  return {
    ok: problems.length === 0,
    problems,
    ...(id.part !== undefined ? { part: id.part } : {}),
    ...(id.conformance !== undefined ? { conformance: id.conformance } : {}),
  };
}

/**
 * The same predicate, shaped for `scripts/worker-prove-tools.ts`'s `verify`
 * hook, so the production proof and the engine cannot drift apart: the proof
 * downloads the artifact a user would receive and asks it this exact question.
 */
export async function proveDeclaredPdfA(
  bytes: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  const report = await inspectPdfAMarkers(bytes);
  return report.ok
    ? {
        ok: true,
        detail: `declares PDF/A-${report.part}${report.conformance?.toLowerCase()} with a /${PDFA_OUTPUT_INTENT_SUBTYPE} output intent (declaration only — not validated)`,
      }
    : { ok: false, detail: report.problems.join("; ") };
}
