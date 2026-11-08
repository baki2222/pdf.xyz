// @native-canvas
/**
 * EDIT-08 adversarial verification: duplicate object ids with the xref
 * pointing at the FIRST definition. Does pdf-lib (behind getEditPageSizes)
 * pick a different object than pdf.js (the preview)?
 *
 * The fixture is rebuilt here independently of editing.fixtures.ts, with the
 * xref offset checked against the bytes, so a fixture-builder slip cannot
 * manufacture the finding. The matrix fixture is checked too, and the
 * "xref -> second" twin is the positive control (both engines must agree).
 */
import { describe, expect, it } from "vitest";
import { getEditPageSizes } from "@/lib/pdf/edit";
import { loadPdfjs } from "@/lib/pdf/pdfjs";
import { editingFixtures } from "./editing.fixtures";

function build(which: "first" | "second"): Uint8Array {
  const objs: Array<[number, string]> = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>",
    ],
    [
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << >> >>",
    ],
  ];
  let out = "%PDF-1.7\n";
  const offs: number[] = [];
  for (const [n, body] of objs) {
    offs.push(out.length);
    out += `${n} 0 obj\n${body}\nendobj\n`;
  }
  const obj3 = which === "first" ? offs[2]! : offs[3]!;
  const row = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;
  const xrefAt = out.length;
  out +=
    "xref\n0 4\n0000000000 65535 f \n" +
    row(offs[0]!) +
    row(offs[1]!) +
    row(obj3) +
    `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  // Health check: the xref row really lands on "3 0 obj" with the box we mean.
  const want = which === "first" ? "200 200" : "400 400";
  expect(out.slice(obj3, obj3 + 80)).toContain("3 0 obj");
  expect(out.slice(obj3, obj3 + 120)).toContain(`[0 0 ${want}]`);
  return Uint8Array.from(Buffer.from(out, "latin1"));
}

async function pdfjsSize(bytes: Uint8Array): Promise<[number, number]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    return [vp.width, vp.height];
  } finally {
    await task.destroy();
  }
}

async function libSize(bytes: Uint8Array): Promise<[number, number]> {
  const [s] = await getEditPageSizes(bytes.slice());
  return [s!.width, s!.height];
}

describe("EDIT-08 duplicate object ids", () => {
  it("independent fixture, xref -> first", { timeout: 20_000 }, async () => {
    const b = build("first");
    const lib = await libSize(b);
    const js = await pdfjsSize(b);
    console.log("EDIT-08 indep first: pdf-lib", lib, "pdf.js", js);
    expect(js).toEqual([200, 200]);
    expect(lib).toEqual([400, 400]); // the reported divergence
  });

  it(
    "positive control, xref -> second: engines agree",
    { timeout: 20_000 },
    async () => {
      const b = build("second");
      const lib = await libSize(b);
      const js = await pdfjsSize(b);
      console.log("EDIT-08 indep second: pdf-lib", lib, "pdf.js", js);
      expect(lib).toEqual([400, 400]);
      expect(js).toEqual([400, 400]);
    },
  );

  it(
    "matrix fixture H19-duplicate-id-xref-first",
    { timeout: 20_000 },
    async () => {
      const all = await editingFixtures();
      const f = all.find((x) => x.id === "H19-duplicate-id-xref-first");
      expect(f).toBeDefined();
      const lib = await libSize(f!.bytes);
      const js = await pdfjsSize(f!.bytes);
      console.log("EDIT-08 matrix first: pdf-lib", lib, "pdf.js", js);
      expect(js).toEqual([200, 200]);
      expect(lib).toEqual([400, 400]);
    },
  );
});
