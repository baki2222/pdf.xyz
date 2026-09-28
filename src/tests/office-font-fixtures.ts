/**
 * The Word to PDF deployment proof: a document set in the fonts real Word
 * files use, and a verdict that reads which faces the converted PDF embeds.
 *
 * Why the proof needs this. Until 2026-09-27 `worker-prove-tools` sent a DOCX
 * with one unstyled English line and accepted anything starting `%PDF-`. That
 * passes on a worker with no fonts at all — which is what production ran: the
 * image had no Carlito, Caladea, Liberation or Noto, so Calibri and Cambria
 * came out in a face with other metrics and CJK, Bengali, Hindi and Thai came
 * out as boxes, and every conversion still "succeeded".
 *
 * The chain this file follows, end to end:
 *
 *   `office-conversion/fonts.ts` (the one list)
 *     -> a DOCX with a run in each Office font and each script (built from it)
 *     -> the live worker's LibreOffice
 *     -> the /BaseFont of every font the returned PDF embeds (read from bytes)
 *
 * WHAT IT IS NOT. A face name says a face was embedded, not which run it drew
 * or that every glyph came out; it cannot see Arabic (DejaVu, which fontconfig
 * always brings, also draws it) and it does not rasterise.
 */
import JSZip from "jszip";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  type PDFObject,
} from "pdf-lib";
import {
  OFFICE_METRIC_CLONES,
  SCRIPT_FONTS,
  type WorkerScript,
} from "@/lib/workers/office-conversion/fonts";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const ODOC_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The line the proof has always carried; kept so the proof reads as before. */
export const OFFICE_FONT_PROOF_TITLE = "Word to PDF — pdf.xyz deployment proof";

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function run(font: string, text: string, extra = ""): string {
  const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
  return `<w:r><w:rPr>${fonts}${extra}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

const paragraph = (runs: string) => `<w:p>${runs}</w:p>`;

/** The Office font the script runs ask for: Word's default body face. */
export const SCRIPT_RUN_FONT = OFFICE_METRIC_CLONES[0]!.office;

function langAttribute(script: WorkerScript): string {
  const { lang, slot } = SCRIPT_FONTS[script];
  const attr =
    slot === "eastAsia" ? "w:eastAsia" : slot === "cs" ? "w:bidi" : "w:val";
  return `<w:lang ${attr}="${lang}"/>`;
}

/**
 * A DOCX with one paragraph per Office font in {@link OFFICE_METRIC_CLONES}
 * and one per script in {@link SCRIPT_FONTS}, each script run set in Calibri
 * so the worker must substitute AND fall back, exactly as for a real file.
 */
export async function officeFontProofDocx(): Promise<Buffer> {
  const body = [
    paragraph(run(SCRIPT_RUN_FONT, OFFICE_FONT_PROOF_TITLE)),
    ...OFFICE_METRIC_CLONES.map((c) =>
      paragraph(
        run(
          c.office,
          `${c.office}: The quick brown fox jumps over the lazy dog.`,
        ),
      ),
    ),
    ...(Object.keys(SCRIPT_FONTS) as WorkerScript[]).map((script) =>
      paragraph(
        run(
          SCRIPT_RUN_FONT,
          SCRIPT_FONTS[script].sample,
          `${script === "Arabic" ? "<w:rtl/>" : ""}${langAttribute(script)}`,
        ),
      ),
    ),
  ].join("\n");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${ODOC_NS}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>
${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Lowercase, letters and digits only: "Liberation Sans" ≡ "LiberationSans". */
export const normalizeFaceName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The /BaseFont of every font dictionary in `pdf` (Type0 parents and their
 * descendants alike), with the six-letter subset tag (`BAAAAA+`) removed.
 * Walks every indirect object and the direct dictionaries inside it, so a font
 * written inline in a page's /Resources is found too.
 */
export async function pdfFontFaces(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const faces = new Set<string>();
  const seen = new Set<PDFObject>();
  const visit = (obj: PDFObject | undefined) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFDict) {
      const type = obj.get(PDFName.of("Type"));
      const base = obj.get(PDFName.of("BaseFont"));
      if (
        type instanceof PDFName &&
        type.decodeText() === "Font" &&
        base instanceof PDFName
      )
        faces.add(base.decodeText().replace(/^[A-Z]{6}\+/, ""));
      for (const [, value] of obj.entries()) visit(value);
    } else if (obj instanceof PDFArray) {
      for (const value of obj.asArray()) visit(value);
    } else if (obj instanceof PDFStream) {
      visit(obj.dict);
    }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj);
  return [...faces].sort();
}

/** What the proof requires to find, derived from the one list. */
export interface FaceRequirement {
  /** How the requirement reads in a verdict. */
  label: string;
  /** The package that should have provided it. */
  debianPackage: string;
  matches: (normalizedFace: string) => boolean;
}

export function officeFontRequirements(): FaceRequirement[] {
  const family = (face: string) => face.split(/-/)[0] ?? face;
  const clones = OFFICE_METRIC_CLONES.map((c) => ({
    label: `${c.clone} (for ${c.office})`,
    debianPackage: c.debianPackage,
    // The FAMILY, exactly: "LiberationSansNarrow" is not "LiberationSans".
    matches: (face: string) =>
      normalizeFaceName(family(face)) === normalizeFaceName(c.clone),
  }));
  const scripts = new Map<string, FaceRequirement>();
  for (const [script, font] of Object.entries(SCRIPT_FONTS)) {
    const token = font.faceToken;
    if (token === null) continue;
    const existing = scripts.get(token);
    if (existing) {
      existing.label = existing.label.replace(/\)$/, `, ${script})`);
      continue;
    }
    scripts.set(token, {
      label: `a "${token}" face (for ${script})`,
      debianPackage: font.debianPackage,
      matches: (face: string) => normalizeFaceName(face).includes(token),
    });
  }
  return [...clones, ...scripts.values()];
}

/** The deployment proof's verdict on the PDF the worker returned. */
export async function officeFontProofVerdict(
  pdf: Uint8Array,
): Promise<{ ok: boolean; detail: string }> {
  let faces: string[];
  try {
    faces = await pdfFontFaces(pdf);
  } catch (error) {
    return {
      ok: false,
      detail: `the PDF could not be read for its fonts: ${(error as Error).message}`,
    };
  }
  const requirements = officeFontRequirements();
  const missing = requirements.filter((r) => !faces.some((f) => r.matches(f)));
  const embedded = `embedded: ${faces.join(", ") || "none"}`;
  return missing.length === 0
    ? {
        ok: true,
        detail: `${requirements.length} required face(s) embedded (${faces.length} font(s)); ${embedded}`,
      }
    : {
        ok: false,
        detail: `no ${missing
          .map((r) => `${r.label} [${r.debianPackage}]`)
          .join(
            "; no ",
          )} — the worker image lacks the package or LibreOffice did not use it; ${embedded}`,
      };
}
