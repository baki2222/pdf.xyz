/**
 * Excel to PDF's orientation and fit-to-width (audit excel-to-pdf#1, review
 * 2026-11-08), done the way Excel itself stores them: by rewriting each
 * worksheet's `<pageSetup>` (orientation, `fitToWidth="1"`,
 * `fitToHeight="0"`) and `<sheetPr><pageSetUpPr fitToPage="1"/>` in the
 * .xlsx BEFORE LibreOffice opens it. WORKER-ONLY: jszip is loaded here, and
 * the engine imports this module lazily, only for a job that asked.
 *
 * Why a rewrite: LibreOffice's PDF export has no filter option for either
 * setting (`SinglePageSheets` is the only sheet-layout one, `./native`).
 * They are page-style settings, and LibreOffice reads them from the
 * workbook's own page setup. No macro runs and nothing else in the package
 * changes: every other entry keeps its original compressed bytes.
 *
 * Measured on the production worker image (LibreOffice 7.4, 2026-11-07,
 * `docker run --network none`, this module through the processor): a
 * 40-column, 400-row .xlsx with no page setup printed on 32 A4 portrait
 * pages, the last column on only 8 of them. Landscape alone: 33 A4
 * landscape pages, last column on 11. Fit columns: 2 A4 portrait pages;
 * fit + landscape: 4 A4 landscape pages; the last column on EVERY page and
 * the last cell present in both, so `fitToHeight="0"` is read as "as many
 * pages as it takes". The first run printed Letter, not A4, because a new
 * `<pageSetup>` without a paperSize means Letter; see A4_PAPER_SIZE.
 *
 * .xlsx only. An .xls, .ods or .csv keeps its own page setup; the panel
 * shows the controls only for an .xlsx, and the engine refuses the options
 * on anything else rather than ignore them.
 *
 * The package is opened with the BOUNDED reader EPUB to PDF uses
 * (`../epub/zip`): its directory is judged before anything is inflated, and
 * each worksheet is inflated within its declared size, so a ZIP bomb cannot
 * exhaust the worker's memory here.
 */
import JSZip from "jszip";
import { openBoundedZip } from "../epub/zip";
import type { SheetOrientation } from "./sheet-layout";

export interface XlsxPageSetup {
  /** null leaves each sheet's own orientation. */
  orientation: SheetOrientation | null;
  /** Shrink each sheet until its columns fit one page width. */
  fitColumnsToWidth: boolean;
}

const WORKSHEET = /^xl\/worksheets\/[^/]+\.xml$/;

/** OOXML's paperSize code for A4 (ECMA-376 18.3.1.63). */
export const A4_PAPER_SIZE = "9";

/**
 * CT_Worksheet's children that must come AFTER `<pageSetup>` (ECMA-376
 * 18.3.1.99), so a new one is inserted before the first of these present.
 */
const AFTER_PAGE_SETUP = [
  "headerFooter",
  "rowBreaks",
  "colBreaks",
  "customProperties",
  "cellWatches",
  "ignoredErrors",
  "smartTags",
  "drawing",
  "legacyDrawing",
  "legacyDrawingHF",
  "drawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst",
] as const;

/** Set (or add) one attribute on a start tag such as `<pageSetup a="1"/>`. */
export function withAttribute(
  tag: string,
  name: string,
  value: string,
): string {
  const existing = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[^"']*\\2`);
  if (existing.test(tag)) return tag.replace(existing, `$1"${value}"`);
  return tag.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
}

/** Rewrite one worksheet's XML. Returns null when it is not a worksheet. */
export function rewriteWorksheetXml(
  xml: string,
  setup: XlsxPageSetup,
): string | null {
  const root = /<(?:([A-Za-z_][\w.-]*):)?worksheet\b[^>]*>/.exec(xml);
  if (!root) return null;
  const p = root[1] ? `${root[1]}:` : "";
  let out = xml;

  // <pageSetup>: orientation and/or the fit counts.
  const attrs: Array<[string, string]> = [];
  if (setup.orientation) attrs.push(["orientation", setup.orientation]);
  if (setup.fitColumnsToWidth)
    attrs.push(["fitToWidth", "1"], ["fitToHeight", "0"]);
  const pageSetup = new RegExp(`<${p}pageSetup\\b[^>]*?/?>`);
  const found = pageSetup.exec(out);
  if (found) {
    let tag = found[0];
    for (const [name, value] of attrs) tag = withAttribute(tag, name, value);
    out = out.replace(found[0], tag);
  } else {
    // paperSize first: a pageSetup with none means Letter (OOXML's default,
    // ECMA-376 18.3.1.63), while a sheet with NO pageSetup printed on A4 in
    // the production image (LibreOffice's default there). Measured
    // 2026-11-07: without this, adding orientation turned A4 pages into
    // Letter ones. "9" is A4, the paper the sheet had.
    const tag = `<${p}pageSetup ${[[`paperSize`, A4_PAPER_SIZE], ...attrs].map(([n, v]) => `${n}="${v}"`).join(" ")}/>`;
    const after = AFTER_PAGE_SETUP.map((name) =>
      out.search(new RegExp(`<${p}${name}\\b`)),
    ).filter((i) => i >= 0);
    const at =
      after.length > 0
        ? Math.min(...after)
        : out.lastIndexOf(`</${p}worksheet>`);
    if (at < 0) return null;
    out = out.slice(0, at) + tag + out.slice(at);
  }

  // <sheetPr><pageSetUpPr fitToPage="1"/>: without it, the counts are ignored.
  if (setup.fitColumnsToWidth) {
    const prOpen = new RegExp(`<${p}sheetPr\\b[^>]*?(/?)>`);
    const pr = prOpen.exec(out);
    const fit = `<${p}pageSetUpPr fitToPage="1"/>`;
    if (!pr) {
      const rootNow = /<(?:[A-Za-z_][\w.-]*:)?worksheet\b[^>]*>/.exec(out)!;
      const at = rootNow.index + rootNow[0].length;
      out = `${out.slice(0, at)}<${p}sheetPr>${fit}</${p}sheetPr>${out.slice(at)}`;
    } else if (pr[1] === "/") {
      out = out.replace(
        pr[0],
        `${pr[0].replace(/\s*\/>$/, ">")}${fit}</${p}sheetPr>`,
      );
    } else {
      const close = out.indexOf(`</${p}sheetPr>`, pr.index);
      if (close < 0) return null;
      const inner = out.slice(pr.index + pr[0].length, close);
      const existing = new RegExp(`<${p}pageSetUpPr\\b[^>]*?/?>`).exec(inner);
      const nextInner = existing
        ? inner.replace(
            existing[0],
            withAttribute(existing[0], "fitToPage", "1"),
          )
        : // pageSetUpPr is CT_SheetPr's LAST child, so it goes at the end.
          inner + fit;
      out =
        out.slice(0, pr.index + pr[0].length) + nextInner + out.slice(close);
    }
  }
  return out;
}

export type XlsxPageSetupResult =
  { ok: true; bytes: Uint8Array; sheets: number } | { ok: false; why: string };

/** Apply the page setup to every worksheet of an .xlsx package. */
export async function applyXlsxPageSetup(
  input: Uint8Array,
  setup: XlsxPageSetup,
): Promise<XlsxPageSetupResult> {
  const bounded = openBoundedZip(input);
  if (!bounded.ok) return { ok: false, why: bounded.refusal.why };
  const sheets = bounded.zip.names.filter((name) => WORKSHEET.test(name));
  if (!bounded.zip.has("xl/workbook.xml") || sheets.length === 0)
    return { ok: false, why: "not an .xlsx workbook" };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    return { ok: false, why: "unreadable package" };
  }
  const decoder = new TextDecoder("utf-8");
  for (const name of sheets) {
    let raw: Uint8Array | null;
    try {
      raw = bounded.zip.read(name);
    } catch {
      return { ok: false, why: `${name} could not be read` };
    }
    if (!raw) return { ok: false, why: `${name} is missing` };
    const next = rewriteWorksheetXml(decoder.decode(raw), setup);
    if (next === null) return { ok: false, why: `${name} is not a worksheet` };
    zip.file(name, next);
  }
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  return { ok: true, bytes, sheets: sheets.length };
}
