// @native-canvas
/**
 * Duplicate object ids (hostile class H19): an object defined more than once
 * resolves to the body the xref selects — the one pdf.js, our preview and
 * every raster tool, shows — and not the last body pdf-lib's linear parse met.
 *
 * Findings PS-08 (page tools), CO-02 (compress + redact sizes) and EDIT-08
 * (displayed-size readers). Until 2026-11-08 pdf-lib kept the LAST body
 * whatever the xref named; the matrix's verify tests pinned that (outputs
 * equal "SECOND") and are inverted here: outputs must equal what pdf.js shows
 * for the INPUT, so the expected value is read from pdf.js, not typed.
 *
 * Every hostile fixture has a twin whose xref names the last body (the shape
 * of an ordinary incremental update), and both must agree. Real files
 * (`legit-corpus.test.ts`, including an incremental update) are the other
 * positive control; the corpus is also checked here to bound the guard's cost.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { optimizeLossless } from "@/lib/pdf/analyze";
import { getEditPageSizes } from "@/lib/pdf/edit";
import {
  extractPages,
  loadPdf,
  mergePdfs,
  organizePages,
  rotatePages,
  setPageRotations,
  splitPdf,
} from "@/lib/pdf/engine";
import { mergeAlternating } from "@/lib/pdf/merge-alternate";
import { DEFAULT_N_UP_OPTIONS, nUpPdf } from "@/lib/pdf/n-up";
import { getRedactPageSizes } from "@/lib/pdf/redact";
import { splitPagesInHalf } from "@/lib/pdf/split-half";
import {
  honourXrefDuplicates,
  scanObjectHeaders,
} from "@/lib/pdf/xref-duplicates";
import { MARKER, duplicateObjectPdf } from "./conversion-out.fixtures";
import { editingFixtures, streamBody } from "./editing.fixtures";
import { PAGE_STRUCTURE_FIXTURES } from "./page-structure.fixtures";

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

const require = createRequire(import.meta.url);
type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

interface View {
  pages: number;
  width: number;
  height: number;
  text: string;
}

/** Page 1 as pdf.js (the preview) shows it. */
async function view(bytes: Uint8Array, pageNo = 1): Promise<View> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    return {
      pages: doc.numPages,
      width: Math.round(vp.width),
      height: Math.round(vp.height),
      text: tc.items
        .map((i) => ("str" in i ? i.str : ""))
        .join("")
        .trim(),
    };
  } finally {
    await task.destroy();
  }
}

const fixture = (id: string) => {
  const f = PAGE_STRUCTURE_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f.build() as Uint8Array;
};

/** Health: the xref row for `num` lands on the first / last of its headers. */
function xrefPicks(bytes: Uint8Array, num: number): "first" | "last" {
  const t = text(bytes);
  const first = t.indexOf(`\n${num} 0 obj`) + 1;
  const last = t.lastIndexOf(`\n${num} 0 obj`) + 1;
  expect(first).toBeGreaterThan(0);
  expect(first).not.toBe(last);
  const row = (o: number) => `${String(o).padStart(10, "0")} 00000 n`;
  const xref = t.slice(t.lastIndexOf("\nxref\n"));
  if (xref.includes(row(first)) && !xref.includes(row(last))) return "first";
  if (xref.includes(row(last)) && !xref.includes(row(first))) return "last";
  throw new Error("xref names neither or both bodies");
}

describe("fixtures (health)", () => {
  it("each hostile fixture's xref names the FIRST body, each twin the LAST", async () => {
    expect(xrefPicks(fixture("H19.dupFirst"), 3)).toBe("first");
    expect(xrefPicks(fixture("H19.dupLast"), 3)).toBe("last");
    expect(xrefPicks(duplicateObjectPdf("first"), 3)).toBe("first");
    expect(xrefPicks(duplicateObjectPdf("second"), 3)).toBe("last");
    const edit = await editingFixtures();
    const e = (id: string) => edit.find((f) => f.id === id)!.bytes;
    expect(xrefPicks(e("H19-duplicate-id-xref-first"), 3)).toBe("first");
    expect(xrefPicks(e("H19-duplicate-id-xref-second"), 3)).toBe("last");
  });

  it("pdf.js follows the xref on every one of them (the property's oracle)", async () => {
    expect((await view(fixture("H19.dupFirst"))).text).toBe("FIRST");
    expect((await view(fixture("H19.dupLast"))).text).toBe("SECOND");
    expect((await view(duplicateObjectPdf("first"))).text).toBe(MARKER);
    expect((await view(duplicateObjectPdf("second"))).text).toBe(
      "SECOND DEFINITION",
    );
  }, 30_000);
});

describe("PS-08: page tools write the page the preview shows", () => {
  const engines: Record<string, (b: Uint8Array) => Promise<Uint8Array>> = {
    merge: (b) => mergePdfs([b]),
    "merge-alternate": (b) => mergeAlternating([b]),
    extract: (b) => extractPages(b, [0]),
    rotate: (b) => rotatePages(b, [0], 0),
    "set-rotations": (b) => setPageRotations(b, [0]),
    split: async (b) =>
      (await splitPdf(b, [{ name: "a.pdf", indices: [0] }]))[0]!.bytes,
    organize: (b) => organizePages(b, [{ sourceIndex: 0, rotation: 0 }]),
    "n-up": async (b) =>
      (await nUpPdf(b, { ...DEFAULT_N_UP_OPTIONS, perSheet: 2 })).bytes,
    "split-half": async (b) =>
      (
        await splitPagesInHalf(b, {
          direction: "left-right",
          order: "left-first",
        })
      ).bytes,
  };

  for (const id of ["H19.dupFirst", "H19.dupLast"]) {
    it(`PS-08: ${id}: every engine's output reads as pdf.js reads the input`, async () => {
      const input = fixture(id);
      const want = await view(input);
      // pdf-lib's own view of the input, after load, is the preview's.
      expect((await loadPdf(input)).getPage(0).getWidth()).toBe(want.width);
      for (const [name, run] of Object.entries(engines)) {
        const got = await view(await run(input));
        expect({ name, text: got.text }).toEqual({ name, text: want.text });
        if (name !== "n-up" && name !== "split-half") {
          expect({ name, width: got.width }).toEqual({
            name,
            width: want.width,
          });
        }
      }
    }, 60_000);
  }
});

describe("CO-02: compress and redact sizes follow the xref", () => {
  for (const which of ["first", "second"] as const) {
    it(`CO-02: xref -> ${which}: compress output and redact sizes match pdf.js`, async () => {
      const input = duplicateObjectPdf(which);
      const want = await view(input);
      const out = await view((await optimizeLossless(input)).bytes);
      expect(out.text).toBe(want.text);
      expect([out.width, out.height]).toEqual([want.width, want.height]);
      const [size] = await getRedactPageSizes(input);
      expect([size!.width, size!.height]).toEqual([want.width, want.height]);
    }, 30_000);
  }
});

describe("EDIT-08: displayed sizes come from the xref-selected page", () => {
  for (const id of [
    "H19-duplicate-id-xref-first",
    "H19-duplicate-id-xref-second",
  ]) {
    it(`EDIT-08: ${id}: getEditPageSizes equals the pdf.js viewport`, async () => {
      const bytes = (await editingFixtures()).find((f) => f.id === id)!.bytes;
      const want = await view(bytes);
      const [size] = await getEditPageSizes(bytes);
      expect([size!.width, size!.height]).toEqual([want.width, want.height]);
    }, 30_000);
  }
});

/* ------------------------------------------------------------------ *
 *  The other xref shapes the reader must honour.
 * ------------------------------------------------------------------ */

const page = (box: number, contents: number) =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${box} ${box}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contents} 0 R >>`;
const draw = (word: string) => `BT /F1 12 Tf 10 20 Td (${word}) Tj ET`;

/** One xref STREAM; object 3 twice, the stream names `pick`. */
function xrefStreamDuplicate(pick: "first" | "last"): Uint8Array {
  const bodies: [number, string | Uint8Array][] = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, page(100, 4)],
    [4, streamBody("", draw("FIRST"))],
    [5, streamBody("", draw("SECOND"))],
    [3, page(300, 5)],
  ];
  return withXrefStream(bodies, (n, offs) =>
    n === 3 ? (pick === "first" ? offs[0]! : offs[1]!) : offs.at(-1)!,
  );
}

function withXrefStream(
  bodies: [number, string | Uint8Array][],
  choose: (n: number, offsets: number[]) => number,
  objstm?: { num: number; members: number[] },
): Uint8Array {
  const parts: Uint8Array[] = [latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let at = parts[0]!.length;
  const offs = new Map<number, number[]>();
  for (const [n, body] of bodies) {
    offs.set(n, [...(offs.get(n) ?? []), at]);
    const chunk = Buffer.concat([
      Buffer.from(`${n} 0 obj\n`, "latin1"),
      typeof body === "string"
        ? Buffer.from(body, "latin1")
        : Buffer.from(body),
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(new Uint8Array(chunk));
    at += chunk.length;
  }
  const size = Math.max(...offs.keys()) + 2;
  const xrefNum = size - 1;
  const rows = new Uint8Array(size * 7);
  rows.set([0, 0, 0, 0, 0, 0xff, 0xff], 0);
  const put = (n: number, t: number, f2: number, f3: number) => {
    const o = n * 7;
    rows.set(
      [
        t,
        (f2 >>> 24) & 255,
        (f2 >>> 16) & 255,
        (f2 >>> 8) & 255,
        f2 & 255,
        (f3 >>> 8) & 255,
        f3 & 255,
      ],
      o,
    );
  };
  for (const [n, list] of offs) put(n, 1, choose(n, list), 0);
  objstm?.members.forEach((m, i) => put(m, 2, objstm.num, i));
  put(xrefNum, 1, at, 0);
  parts.push(
    latin1(`${xrefNum} 0 obj\n`),
    streamBody(`/Type /XRef /Size ${size} /W [1 4 2] /Root 1 0 R`, rows),
    latin1(`\nendobj\nstartxref\n${at}\n%%EOF\n`),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * Page 3 lives in an object stream (the xref says so); a top-level `3 0 obj`
 * twin sits AFTER the stream, so pdf-lib's linear parse used to keep the twin.
 */
function objStmWithLaterTwin(): Uint8Array {
  const member = page(100, 4);
  const head = `3 0 `;
  const objstm = streamBody(
    `/Type /ObjStm /N 1 /First ${head.length}`,
    head + member,
  );
  return withXrefStream(
    [
      [1, "<< /Type /Catalog /Pages 2 0 R >>"],
      [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
      [4, streamBody("", draw("FIRST"))],
      [5, streamBody("", draw("SECOND"))],
      [6, objstm],
      [3, page(300, 5)],
    ],
    (_n, list) => list.at(-1)!,
    { num: 6, members: [3] },
  );
}

/**
 * A classic file, then an incremental update whose own xref section names the
 * ORIGINAL body of object 3 again, after an intermediate update replaced it
 * (a "revert"): the newest section wins, and it names the earlier body.
 */
function revertingUpdate(): Uint8Array {
  const base =
    "%PDF-1.7\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  let s = base;
  const o3a = s.length;
  s += `3 0 obj\n${page(100, 4)}\nendobj\n`;
  const o4 = s.length;
  const c4 = draw("FIRST");
  s += `4 0 obj\n<< /Length ${c4.length} >>\nstream\n${c4}\nendstream\nendobj\n`;
  const row = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;
  const x1 = s.length;
  s += `xref\n0 5\n0000000000 65535 f \n${row(base.indexOf("1 0 obj"))}${row(base.indexOf("2 0 obj"))}${row(o3a)}${row(o4)}`;
  s += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${x1}\n%%EOF\n`;
  // Update 1: object 3 replaced by a 300 pt page drawing SECOND.
  const o5 = s.length;
  const c5 = draw("SECOND");
  s += `5 0 obj\n<< /Length ${c5.length} >>\nstream\n${c5}\nendstream\nendobj\n`;
  const o3b = s.length;
  s += `3 0 obj\n${page(300, 5)}\nendobj\n`;
  const x2 = s.length;
  s += `xref\n3 1\n${row(o3b)}5 1\n${row(o5)}trailer\n<< /Size 6 /Root 1 0 R /Prev ${x1} >>\nstartxref\n${x2}\n%%EOF\n`;
  // Update 2: object 3 pointed back at its first body.
  const x3 = s.length;
  s += `xref\n3 1\n${row(o3a)}trailer\n<< /Size 6 /Root 1 0 R /Prev ${x2} >>\nstartxref\n${x3}\n%%EOF\n`;
  return latin1(s);
}

/**
 * A hybrid-reference file: the classic table leaves object 3 out, and its
 * /XRefStm stream names object 3's FIRST body (as Word's hybrid files list
 * compressed objects only in the stream half).
 */
function hybridDuplicate(): Uint8Array {
  const parts: Uint8Array[] = [latin1("%PDF-1.7\n")];
  let at = parts[0]!.length;
  const push = (b: Uint8Array) => {
    parts.push(b);
    at += b.length;
  };
  const obj = (n: number, body: string | Uint8Array) => {
    const o = at;
    push(latin1(`${n} 0 obj\n`));
    push(typeof body === "string" ? latin1(body) : body);
    push(latin1("\nendobj\n"));
    return o;
  };
  const o1 = obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const o2 = obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  const o3a = obj(3, page(100, 4));
  const o4 = obj(4, streamBody("", draw("FIRST")));
  const o5 = obj(5, streamBody("", draw("SECOND")));
  obj(3, page(300, 5));
  const row = [
    1,
    (o3a >>> 24) & 255,
    (o3a >>> 16) & 255,
    (o3a >>> 8) & 255,
    o3a & 255,
    0,
    0,
  ];
  const o6 = obj(
    6,
    streamBody(
      "/Type /XRef /Size 7 /Index [3 1] /W [1 4 2]",
      new Uint8Array(row),
    ),
  );
  const r = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;
  const x = at;
  push(
    latin1(
      `xref\n0 3\n0000000000 65535 f \n${r(o1)}${r(o2)}4 3\n${r(o4)}${r(o5)}${r(o6)}` +
        `trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${o6} >>\nstartxref\n${x}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

describe("xref shapes", () => {
  it("an xref STREAM naming the first body is honoured; its twin is untouched", async () => {
    for (const pick of ["first", "last"] as const) {
      const bytes = xrefStreamDuplicate(pick);
      const want = await view(bytes);
      expect(want.text).toBe(pick === "first" ? "FIRST" : "SECOND");
      const doc = await loadPdf(bytes);
      expect(doc.getPage(0).getWidth()).toBe(want.width);
      expect((await view(await mergePdfs([bytes]))).text).toBe(want.text);
    }
  }, 30_000);

  it("an object-stream member wins over a later top-level twin the xref does not name", async () => {
    const bytes = objStmWithLaterTwin();
    const want = await view(bytes);
    expect(want.text).toBe("FIRST");
    expect((await view(await mergePdfs([bytes]))).text).toBe("FIRST");
  }, 30_000);

  it("the NEWEST xref section wins along a /Prev chain, even naming an older body", async () => {
    const bytes = revertingUpdate();
    const want = await view(bytes);
    expect(want.text).toBe("FIRST");
    expect((await view(await extractPages(bytes, [0]))).text).toBe("FIRST");
  }, 30_000);

  it("a hybrid file's /XRefStm half is honoured where the table is silent", async () => {
    const bytes = hybridDuplicate();
    const want = await view(bytes);
    expect(want.text).toBe("FIRST");
    expect((await view(await mergePdfs([bytes]))).text).toBe("FIRST");
  }, 30_000);

  it("an xref row that misses its object changes nothing (pdf.js rebuilds, last body wins)", async () => {
    const t = text(fixture("H19.dupFirst"));
    const first = t.indexOf("3 0 obj");
    // Point the row 2 bytes INTO the first body: not a header of object 3.
    const broken = latin1(
      t.replace(
        `${String(first).padStart(10, "0")} 00000 n `,
        `${String(first + 2).padStart(10, "0")} 00000 n `,
      ),
    );
    const want = await view(broken);
    expect(want.text).toBe("SECOND");
    const lib = await import("pdf-lib");
    const doc = await lib.PDFDocument.load(broken);
    expect((await honourXrefDuplicates(doc, broken)).replaced).toBe(0);
    expect((await view(await mergePdfs([broken]))).text).toBe("SECOND");
  }, 30_000);

  it("a duplicated CATALOG and INFO are refreshed on the document, not only in its context", async () => {
    // Object 1 twice: the xref names the first (/Lang en-GB).
    const head = "%PDF-1.7\n";
    let b = head;
    const o1a = b.length;
    b += "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Lang (en-GB) >>\nendobj\n";
    const o2 = b.length;
    b += "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
    const o3 = b.length;
    b += `3 0 obj\n${page(100, 4)}\nendobj\n`;
    const o4 = b.length;
    const c = draw("FIRST");
    b += `4 0 obj\n<< /Length ${c.length} >>\nstream\n${c}\nendstream\nendobj\n`;
    // Object 5, the Info dictionary, twice too: the xref names the first.
    const o5a = b.length;
    b += "5 0 obj\n<< /Title (Right) >>\nendobj\n";
    b +=
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Lang (xx-WRONG) >>\nendobj\n";
    b += "5 0 obj\n<< /Title (Wrong) >>\nendobj\n";
    const row = (o: number) => `${String(o).padStart(10, "0")} 00000 n \n`;
    const x = b.length;
    b += `xref\n0 6\n0000000000 65535 f \n${row(o1a)}${row(o2)}${row(o3)}${row(o4)}${row(o5a)}trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${x}\n%%EOF\n`;
    const doc = await loadPdf(latin1(b));
    expect(doc.catalog.get(PDFName.of("Lang"))?.toString()).toBe("(en-GB)");
    expect(doc.catalog).toBe(doc.context.lookup(doc.context.trailerInfo.Root));
    // The xref's Info, with the Producer pdf-lib's load writes (into the
    // dictionary it held at the time, which was the wrong one).
    expect(doc.getTitle()).toBe("Right");
    expect(doc.getProducer()).toMatch(/pdf-lib/);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 *  Scanner health, positive controls, and cost.
 * ------------------------------------------------------------------ */

const CORPUS = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
const corpus = readdirSync(CORPUS).filter((f) => f.endsWith(".pdf"));

describe("scanner", () => {
  it("finds every header of a known file, and the repeat (positive control)", () => {
    const scan = scanObjectHeaders(fixture("H19.dupFirst"));
    expect(scan.repeated).toBe(true);
    // Objects 1..5, object 3 twice.
    expect([...scan.headers.values()].map((l) => l.length).sort()).toEqual([
      1, 1, 1, 1, 2,
    ]);
  });

  it("the legit corpus is plausible: 14 files, headers in each, no repeated header", () => {
    // Measured 2026-11-08: none of the 14 repeats an object (the incremental
    // update only ADDS object 34), so on them the xref is read only when they
    // carry object streams.
    expect(corpus.length).toBe(14);
    const repeats: string[] = [];
    const streams: string[] = [];
    for (const name of corpus) {
      const scan = scanObjectHeaders(readFileSync(path.join(CORPUS, name)));
      expect({ name, some: scan.headers.size > 2 }).toEqual({
        name,
        some: true,
      });
      if (scan.repeated) repeats.push(name);
      if (scan.objectStreams) streams.push(name);
    }
    expect(repeats).toEqual([]);
    // The object-stream flag, both ways: exactly the three files whose
    // producers wrote object streams (qpdf --object-streams, ocrmypdf).
    expect(streams.sort()).toEqual([
      "ocrmypdf-pdfa.pdf",
      "qpdf-objstm-linearized.pdf",
      "qpdf-objstm.pdf",
    ]);
  });

  it("an incremental update that REDEFINES an object keeps the newer body (signed + update)", async () => {
    const bytes = fixture("H17.signedUpdate");
    expect(scanObjectHeaders(bytes).repeated).toBe(true);
    const lib = await import("pdf-lib");
    const doc = await lib.PDFDocument.load(bytes);
    expect((await honourXrefDuplicates(doc, bytes)).replaced).toBe(0);
  });

  it("no real file has an object replaced (incremental update included)", async () => {
    const lib = await import("pdf-lib");
    for (const name of corpus) {
      const bytes = new Uint8Array(readFileSync(path.join(CORPUS, name)));
      const doc = await lib.PDFDocument.load(bytes);
      const { replaced } = await honourXrefDuplicates(doc, bytes);
      expect({ name, replaced }).toEqual({ name, replaced: 0 });
    }
  }, 60_000);

  it("costs little on a large file, and on a hostile one", () => {
    // 64 MB of pseudo-random bytes (as compressed streams are), a header every
    // 4 KB. Measured 2026-11-08 on a dev machine: 110-140 ms. Bound 1 s: ~7x
    // headroom for a loaded CI runner, and still far below what a scan that
    // went quadratic, or built a string per hit, would take.
    const big = new Uint8Array(64 * 1024 * 1024);
    let x = 0x9e3779b9;
    for (let i = 0; i < big.length; i += 1) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      big[i] = x & 0xff;
    }
    const header = latin1("\n7 0 obj\n");
    for (let i = 0; i + header.length < big.length; i += 4096)
      big.set(header, i);
    let t0 = performance.now();
    const scan = scanObjectHeaders(big);
    let ms = performance.now() - t0;
    expect(scan.headers.get(7 * 0x10000)!.length).toBe(big.length / 4096);
    expect(ms).toBeLessThan(1000);
    // Hostile: "0 0 obj " eight bytes at a time, so every eighth byte is a
    // header the loop must fully walk and record: 8.4 M headers. Measured
    // 380-440 ms; bound 3 s (~7x).
    const run = latin1("0 0 obj ");
    for (let i = 0; i + run.length <= big.length; i += run.length)
      big.set(run, i);
    t0 = performance.now();
    expect(scanObjectHeaders(big).headers.get(0)!.length).toBe(
      big.length / run.length,
    );
    ms = performance.now() - t0;
    expect(ms).toBeLessThan(3000);
  }, 30_000);
});
