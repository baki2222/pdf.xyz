// @native-canvas
/**
 * PS-08 adversarial verify: object 3 (the page) defined twice; the xref
 * names the FIRST body (100 pt, draws FIRST). What does pdf.js (preview)
 * see, and what do the product engines write?
 *
 * The fixture is built here independently of page-structure.fixtures.ts.
 */
import { describe, expect, test } from "vitest";
import {
  extractPages,
  getPageCount,
  loadPdf,
  mergePdfs,
  rotatePages,
} from "@/lib/pdf/engine";
import { loadPdfjs } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function build(pick: "first" | "last"): Uint8Array {
  const s1 = "BT /F1 12 Tf 10 50 Td (FIRST) Tj ET";
  const s2 = "BT /F1 12 Tf 10 50 Td (SECOND) Tj ET";
  const font =
    "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>";
  const bodies: [number, string][] = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${font} /Contents 4 0 R >>`],
    [4, `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`],
    [5, `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] ${font} /Contents 5 0 R >>`],
  ];
  let out = "%PDF-1.7\n";
  const offsets = new Map<number, number[]>();
  for (const [n, b] of bodies) {
    offsets.set(n, [...(offsets.get(n) ?? []), out.length]);
    out += `${n} 0 obj\n${b}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n += 1) {
    const list = offsets.get(n)!;
    const off = pick === "first" ? list[0]! : list[list.length - 1]!;
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return enc(out);
}

async function pdfjsView(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    data: bytes.slice(),
  }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const textOut = tc.items.map((i) => ("str" in i ? i.str : "")).join("");
  await (doc as unknown as { cleanup?: () => Promise<void> }).cleanup?.();
  return { pages: doc.numPages, width: vp.width, text: textOut };
}

describe("PS-08 verify", () => {
  test("health: the fixture's xref really names the first body", () => {
    const t = new TextDecoder("latin1").decode(build("first"));
    const first = t.indexOf("3 0 obj");
    const last = t.lastIndexOf("3 0 obj");
    expect(first).not.toBe(last);
    expect(t).toContain(`${String(first).padStart(10, "0")} 00000 n `);
    expect(t).not.toContain(`${String(last).padStart(10, "0")} 00000 n `);
  });

  for (const pick of ["first", "last"] as const) {
    test(
      `pick=${pick}: pdf.js vs engines`,
      async () => {
        const input = build(pick);
        const inView = await pdfjsView(input);
        const lib = await loadPdf(input);
        const libW = lib.getPage(0).getWidth();
        const outs: Record<string, Uint8Array> = {
          merge: await mergePdfs([input]),
          rotate: await rotatePages(input, [0], 90),
          extract: await extractPages(input, [0]),
        };
        const report: Record<string, unknown> = {
          input_pdfjs: inView,
          input_pdflib_width: libW,
          input_pdflib_pages: await getPageCount(input),
        };
        for (const [k, b] of Object.entries(outs)) {
          report[k] = await pdfjsView(b);
        }
        console.log(pick, JSON.stringify(report));
        // Positive control: pdf.js follows the xref.
        expect(inView.text).toBe(pick === "first" ? "FIRST" : "SECOND");
        // PS-08 as it stands (2026-11-08): every engine writes the LAST body
        // whatever the xref names. Invert when fixed: outputs must match inView.
        for (const k of Object.keys(outs)) {
          expect((report[k] as { text: string }).text).toBe("SECOND");
        }
      },
      30_000,
    );
  }
});
