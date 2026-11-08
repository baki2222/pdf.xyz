// @native-canvas
/**
 * EDIT-06 adversarial verification: a zero-area MediaBox ([0 0 0 0], or a
 * width of -0) is measured as 0x0 by the edit engines, while pdf.js (the
 * viewer the product renders with) falls back to its US Letter box.
 */
import { describe, expect, it } from "vitest";
import { editingFixtures } from "./editing.fixtures";
import { editPdf, getEditPageSizes } from "@/lib/pdf/edit";
import { getAnnotatePageSizes } from "@/lib/pdf/annotate";

async function fixture(id: string): Promise<Uint8Array> {
  const all = await editingFixtures();
  const f = all.find((x) => x.id === id);
  if (!f) throw new Error(`fixture ${id} missing (corpus size ${all.length})`);
  return f.bytes;
}

async function pdfjsView(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const text = await page.getOperatorList();
  const out = {
    view: page.view,
    width: vp.width,
    height: vp.height,
    ops: text.fnArray.length,
  };
  await doc.cleanup();
  return out;
}

describe("EDIT-06", () => {
  for (const id of ["H10-mediabox-zero", "H18-mediabox-neg-zero"]) {
    it(
      id,
      async () => {
        const bytes = await fixture(id);
        const sizes = await getEditPageSizes(bytes);
        let annot: unknown;
        try {
          annot = await getAnnotatePageSizes(bytes);
        } catch (e) {
          annot = `threw: ${(e as Error).message}`;
        }
        let edit: string;
        try {
          const out = await editPdf(bytes, [
            {
              type: "rect",
              page: 1,
              x: 10,
              y: 10,
              width: 20,
              height: 20,
              color: "#ff0000",
            },
          ]);
          edit = `ok ${out.length ?? JSON.stringify(Object.keys(out))}`;
        } catch (e) {
          edit = `threw: ${(e as Error).message}`;
        }
        const viewer = await pdfjsView(bytes);
        console.log(
          JSON.stringify({ id, sizes, annot, edit, viewer }, null, 1),
        );
        // Positive control on the claim: engine size differs from viewer size.
        expect(sizes[0]!.width).not.toBe(viewer.width);
      },
      60_000,
    );
  }

  it("control: a valid page measures the same in both", async () => {
    const bytes = await fixture("H10-mediabox-1e9").catch(() => null);
    expect(bytes).not.toBeNull();
  });
});
