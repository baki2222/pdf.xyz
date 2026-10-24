import { loadPdf } from "../engine";
import { loadPdfLib } from "../pdf-lib";
import { describeRun, observedCodes } from "./content-edit";
import { analyzePage, type StreamAnalysis } from "./page-content";
import type { RunStyle } from "./runs";

/**
 * How each run on a page looks and what it can be rewritten in, read from
 * the content stream (pdf-lib) — the same reading the export removes glyphs
 * with, so what the editor says about a run ("font substituted: Times
 * Bold") is what the export will do.
 */
export interface RunStyleReader {
  style(
    page: number,
    run: { transform: readonly number[]; width: number },
  ): RunStyle;
}

const UNREADABLE: RunStyle = {
  color: null,
  font: "helvetica",
  bold: false,
  italic: false,
  ownChars: "",
  fontName: "an unknown font",
  refusal:
    "This page's content could not be read, so its text can't be edited.",
  invisible: false,
};

export async function openRunStyles(
  bytes: Uint8Array,
): Promise<RunStyleReader> {
  const lib = await loadPdfLib();
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  type Read = {
    page: StreamAnalysis;
    observed: ReturnType<typeof observedCodes>;
  } | null;
  const cache = new Map<number, Read>();
  const styles = new Map<string, RunStyle>();
  const analysis = (index: number): Read => {
    if (!cache.has(index)) {
      const page = pages[index];
      let read: Read = null;
      try {
        if (page) {
          const a = analyzePage(lib, page);
          read = { page: a, observed: observedCodes(a) };
        }
      } catch {
        read = null;
      }
      cache.set(index, read);
    }
    return cache.get(index)!;
  };
  return {
    style(page, run) {
      const key = `${page}:${run.transform.join(",")}:${run.width}`;
      const known = styles.get(key);
      if (known) return known;
      const a = analysis(page);
      if (!a) return UNREADABLE;
      const t = run.transform;
      const d = describeRun(
        a.page,
        {
          transform: [t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!],
          width: run.width,
        },
        a.observed,
      );
      const style: RunStyle = {
        color: d.color,
        font: d.substitute.font,
        bold: d.substitute.bold,
        italic: d.substitute.italic,
        ownChars: d.ownChars,
        fontName: d.fontName,
        refusal: d.refusal,
        invisible: d.invisible,
      };
      styles.set(key, style);
      return style;
    },
  };
}
