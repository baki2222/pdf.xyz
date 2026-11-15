/**
 * A `writeDocx` seam for PDF to Word tests (#28 slice 4, 2026-11-15): the
 * real writer, handed every word without its typeface. The size of what it
 * writes is "the same file without `w:rFonts`", which the size-fallback
 * tests measure their limits against — never a typed byte count.
 */
import type {
  DocxDocument,
  DocxStyledRun,
} from "@/lib/workers/pdf-office-export/docx-layout";
import { docxPackage } from "@/lib/workers/pdf-office-export/docx-package";

const strip = (runs: readonly DocxStyledRun[]): DocxStyledRun[] =>
  runs.map((r) => {
    if (!r.style?.typeface) return r;
    const { typeface: _dropped, ...style } = r.style;
    void _dropped;
    return { ...r, style };
  });

/** `doc` with no word naming a typeface; everything else as it was. */
export function withoutTypefaces(doc: DocxDocument): DocxDocument {
  return {
    ...doc,
    pages: doc.pages.map((blocks) =>
      blocks.map((b) => {
        if (b.kind === "text")
          return b.runs ? { ...b, runs: b.runs.map(strip) } : b;
        if (b.kind === "table")
          return {
            ...b,
            rows: b.rows.map((row) => ({
              slots: row.slots.map((s) => s?.map(strip) ?? null),
            })),
          };
        return b;
      }),
    ),
  };
}

/** The real writer over {@link withoutTypefaces}. */
export const writeWithoutTypefaces = (doc: DocxDocument) =>
  docxPackage(withoutTypefaces(doc));
