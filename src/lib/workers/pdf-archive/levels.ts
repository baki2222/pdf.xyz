/**
 * The PDF/A levels PDF to PDF/A offers (audit pdf-to-pdfa#1, 2026-11-08):
 * PDF/A-1b, PDF/A-2b and PDF/A-3b, PDF/A-2b first as the default.
 *
 * A LEAF, no imports: the browser panel draws its picker from this list and
 * the worker reads the job's option with the same parser, so the two cannot
 * disagree about which levels exist. Only the PDF/A panel, the worker's
 * engine and the tool's page import it.
 *
 * Each level's `part` is the number Ghostscript is given (`-dPDFA=<part>`,
 * `ghostscriptPdfAArgs` in `./native`) AND the number the output's XMP must
 * declare before it ships (`inspectPdfAMarkers` in `./pdfa-markers`), so a
 * level cannot be offered without both the request and the check following
 * it. Conformance is "B" for all three: level b is about appearance, which
 * Ghostscript can deliver. The "a" (tagged structure) and "u" (Unicode text)
 * levels are NOT offered, because nothing here adds tags or guarantees a
 * Unicode mapping for every glyph.
 *
 * PDF/A-1 is built on PDF 1.4 and does not allow transparency, so its argv
 * also pins PDF 1.4. What Ghostscript then does to a transparent page has
 * not been checked on a real job, so the hint says only that such a page
 * may not come back exactly as it was.
 *
 * `{}` (no `level` key) is the job exactly as it ran before the picker:
 * PDF/A-2b.
 */

export interface PdfALevel {
  /** The value in the job's option bag. */
  id: "1b" | "2b" | "3b";
  /** The standard's name, as the page and the panel write it. */
  standard: "PDF/A-1b" | "PDF/A-2b" | "PDF/A-3b";
  /** ISO 19005 part: Ghostscript's `-dPDFA=` and the XMP `pdfaid:part`. */
  part: "1" | "2" | "3";
  /** The XMP `pdfaid:conformance`. */
  conformance: "B";
  /** One line under the picker: when to choose it. */
  hint: string;
}

export type PdfALevelId = PdfALevel["id"];
export type PdfAStandard = PdfALevel["standard"];

export const PDFA_LEVELS: readonly PdfALevel[] = [
  {
    id: "2b",
    standard: "PDF/A-2b",
    part: "2",
    conformance: "B",
    hint: "The usual choice when nobody names a level.",
  },
  {
    id: "1b",
    standard: "PDF/A-1b",
    part: "1",
    conformance: "B",
    hint: "For older archives and e-filing systems that ask for it. PDF/A-1 does not allow transparency, so a page that uses it may not come back exactly as it was.",
  },
  {
    id: "3b",
    standard: "PDF/A-3b",
    part: "3",
    conformance: "B",
    hint: "When a portal or e-invoicing system asks for PDF/A-3.",
  },
];

export const DEFAULT_PDFA_LEVEL: PdfALevel = PDFA_LEVELS[0]!;

/** The key in the job's `options` bag. */
export const PDFA_LEVEL_OPTION = "level";

/** The picker's visible name. */
export const PDFA_LEVEL_LABEL = "PDF/A level";

/** The level named by a standard string, as the runner receives it. */
export function pdfaLevelForStandard(standard: string): PdfALevel | undefined {
  return PDFA_LEVELS.find((level) => level.standard === standard);
}

export type PdfALevelParse =
  { ok: true; value: PdfALevel } | { ok: false; message: string };

/**
 * Read the level from a job's raw option bag. Absent is PDF/A-2b; anything
 * that is not one of the offered ids is refused, never mapped to a nearby
 * level: an archive that asked for 1b must not quietly receive 2b.
 */
export function parsePdfALevel(
  options: Record<string, unknown>,
): PdfALevelParse {
  const raw = options[PDFA_LEVEL_OPTION];
  if (raw === undefined) return { ok: true, value: DEFAULT_PDFA_LEVEL };
  const level = PDFA_LEVELS.find((l) => l.id === raw);
  if (!level)
    return {
      ok: false,
      message: `\`options.${PDFA_LEVEL_OPTION}\` must be one of ${PDFA_LEVELS.map((l) => `"${l.id}"`).join(", ")}.`,
    };
  return { ok: true, value: level };
}

/** "PDF/A-1b, PDF/A-2b or PDF/A-3b": every offered level, by part, for copy. */
export const PDFA_LEVEL_NAMES = (() => {
  const names = [...PDFA_LEVELS]
    .sort((a, b) => a.part.localeCompare(b.part))
    .map((level) => level.standard);
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
})();
