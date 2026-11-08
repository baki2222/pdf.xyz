// @native-canvas
// Hostile lane l06 — STAMP-09 / EDIT-09: a page whose content leaves the
// graphics state unbalanced (a surplus Q, or two or more q left open after a
// cm) used to leak its leftover CTM into everything an engine drew after it:
// a page number 0.1x size in the corner, an edited box at (1,1) instead of
// (10,10), with the tool reporting success.
//
// Every engine-level assertion here compares what a VIEWER reads (pdf.js, via
// src/tests/pdf-viewer-read.ts) on the hostile page against the same engine on
// a balanced control page: the stamp must land in the same place at the same
// size. The 100,000-deep fixtures, which pdf.js needs minutes for, are run in a
// child process and measured by an independent interpreter (./ctm-probe).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, test } from "vitest";
import {
  ISOLATION_DECODE_BUDGET,
  isolatePageContent,
  scanContentBalance,
} from "@/lib/pdf/content-isolation";
import { annotatePdf } from "@/lib/pdf/annotate";
import { editPdf } from "@/lib/pdf/edit";
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import { addHeaderFooter } from "@/lib/pdf/header-footer";
import { overlayPdf } from "@/lib/pdf/overlay";
import { addPageNumbers, batesFormat } from "@/lib/pdf/page-numbers";
import { signPdf } from "@/lib/pdf/signature";
import { watermarkPdf } from "@/lib/pdf/watermark";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { runBounded } from "./bounded";
import { editingFixtures } from "./editing.fixtures";
import { scaleOf } from "./ctm-probe";

const enc = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

/* ------------------------------------------------------------------ *
 *  The scanner, on its own.
 * ------------------------------------------------------------------ */

describe("scanContentBalance: q/Q as a viewer executes them", () => {
  // [name, content, surplus Q count, q left open]
  const cases: Array<[string, string, number, number]> = [
    ["balanced", "q 1 0 0 1 5 5 cm Q", 0, 0],
    ["empty", "", 0, 0],
    ["one surplus Q", "Q 0.1 0 0 0.1 0 0 cm", 1, 0],
    ["two open q", "q 0.1 0 0 0.1 0 0 cm q", 0, 2],
    ["pops an empty stack mid-stream, then opens one", "q Q Q q", 1, 1],
    ["no whitespace around operators", "q[1 2]0 d(x)Tj Q", 0, 0],
    ["a Q inside a literal string is text", "q (a Q b) Tj", 0, 1],
    ["escaped paren keeps the string open", "q (a\\) Q \\( q) Tj", 0, 1],
    ["nested parens keep the string open", "q (a (Q) Q) Tj", 0, 1],
    ["a Q inside a hex string is not an operator", "q <51 20 51> Tj", 0, 1],
    ["dict delimiters are not hex strings", "q /P <</MCID 0>> BDC Q", 0, 0],
    ["a /Q name is a name", "q /Q gs /q Do", 0, 1],
    ["a % comment hides the rest of its line", "q % Q Q\nq", 0, 2],
    ["QQ and qQ are not q or Q", "q QQ qQ", 0, 1],
    [
      "inline image data is skipped up to EI",
      "q BI /W 3 /H 1 /CS /G /BPC 8 ID Q Q EI q",
      0,
      2,
    ],
    [
      "inline image dict keys are not operators",
      "BI /W 1 /H 1 /Q 1 ID \x00 EI Q",
      1,
      0,
    ],
  ];
  for (const [name, content, surplus, open] of cases) {
    test(name, () => {
      const got = scanContentBalance(enc(content));
      expect({ surplus: got.surplus.length, open: got.open }).toEqual({
        surplus,
        open,
      });
      // Every offset reported is a Q byte (what gets blanked).
      for (const at of got.surplus) expect(content[at]).toBe("Q");
    });
  }
});

/* ------------------------------------------------------------------ *
 *  Fixtures: one 612x792 page with /F1 and a raw (flate) content stream.
 * ------------------------------------------------------------------ */

const BASE_TEXT = "BT /F1 24 Tf 72 700 Td (Base) Tj ET";
const SCALE = "0.1 0 0 0.1 0 0 cm";

async function page(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  p.node.setFontDictionary(PDFName.of("F1"), font.ref);
  const stream = doc.context.flateStream(content);
  p.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save();
}

/** Each hostile content leaves a 0.1 scale in force for whatever follows. */
const HOSTILE: Array<[string, string]> = [
  ["one surplus Q, then a scale", `Q\n${SCALE}\n${BASE_TEXT}`],
  ["a scale with two q left open", `${BASE_TEXT}\nq ${SCALE}\nq\nq\n`],
  [
    "two q left open, with Q's hidden in a string, a comment, hex, a name and an inline image",
    `q ${SCALE} q % Q Q\n${BASE_TEXT.replace("(Base)", "(Base\\) Q \\(Q)")} <51> /Q BI /W 1 /H 1 /CS /G /BPC 8 ID Q EI\n`,
  ],
];
const CONTROL = `q ${SCALE} Q ${BASE_TEXT}`;

interface Seen {
  str: string;
  x: number;
  y: number;
  size: number;
}

/** The stamp's text runs as pdf.js reads them: everything but the base line. */
async function stampRuns(bytes: Uint8Array): Promise<Seen[]> {
  const read = await readAsViewer(bytes);
  return read.texts
    .filter((t) => !/^Base/.test(t.str))
    .map((t) => ({
      str: t.str,
      x: Math.round(t.x * 10) / 10,
      y: Math.round(t.y * 10) / 10,
      size: Math.round(t.size * 100) / 100,
    }));
}

/** New path boxes as pdf.js paints them, rounded (the base draws no paths). */
async function pathBoxes(bytes: Uint8Array): Promise<string[]> {
  const read = await readAsViewer(bytes);
  return read.paths.map((b) => b.map((n) => Math.round(n)).join(","));
}

async function overlaySource(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([612, 792])
    .drawText("OVERLAYMARK", { x: 200, y: 400, size: 30, font });
  return doc.save();
}

type Engine = (bytes: Uint8Array) => Promise<Uint8Array>;

const STAMP_ENGINES: Array<[string, Engine]> = [
  ["page numbers", (b) => addPageNumbers(b)],
  [
    "Bates numbers",
    (b) => addPageNumbers(b, { format: batesFormat("ACME-", 6) }),
  ],
  ["text watermark", async (b) => (await watermarkPdf(b, "DRAFT")).bytes],
  [
    "header and footer",
    (b) =>
      addHeaderFooter(b, {
        header: { center: "HEADERTEXT" },
        footer: { right: "FOOTERTEXT" },
      }),
  ],
  [
    "overlay (front)",
    async (b) => (await overlayPdf(b, await overlaySource())).bytes,
  ],
  [
    "typed signature",
    (b) =>
      signPdf(
        b,
        { kind: "typed", text: "Ada Lovelace", style: "print" },
        { pageIndex: 0, position: "bottom-right", width: 160 },
      ),
  ],
];

describe("STAMP-09: a stamp lands where it does on a balanced page", () => {
  for (const [engineName, run] of STAMP_ENGINES) {
    for (const [hostileName, content] of HOSTILE) {
      test(`STAMP-09: ${engineName} — ${hostileName}`, async () => {
        const want = await stampRuns(await run(await page(CONTROL)));
        // Health: the control stamp was drawn and read.
        expect(want.length).toBeGreaterThan(0);
        const got = await stampRuns(await run(await page(content)));
        expect(got).toEqual(want);
      }, 60_000);
    }
  }

  for (const [hostileName, content] of HOSTILE) {
    test(`STAMP-09: the page's own content still reads where it did before the tool — ${hostileName}`, async () => {
      const baseRuns = async (bytes: Uint8Array) =>
        (await readAsViewer(bytes)).texts
          .filter((t) => /^Base/.test(t.str))
          .map((t) => [t.str, Math.round(t.x), Math.round(t.y), t.size]);
      const original = await page(content);
      const before = await baseRuns(original);
      expect(before.length).toBeGreaterThan(0);
      expect(await baseRuns(await addPageNumbers(original))).toEqual(before);
    }, 60_000);
  }

  test("STAMP-09: the finding's fixture (Q x 100,000, then a 0.1 scale) — page number at the control's place and size, read by pdf.js", async () => {
    const { STAMPING_INPUTS } = await import("./stamping.fixtures");
    const hostile = await STAMPING_INPUTS.find(
      (f) => f.id === "H24-pops-then-scale",
    )!.build();
    const control = await STAMPING_INPUTS.find(
      (f) => f.id === "CONTROL-valid",
    )!.build();
    const want = await stampRuns(await addPageNumbers(control));
    const got = await stampRuns(await addPageNumbers(hostile));
    expect(want.map((r) => r.str)).toContain("Page 1 of 1");
    expect(got.filter((r) => r.str === "Page 1 of 1")).toEqual(
      want.filter((r) => r.str === "Page 1 of 1"),
    );
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 *  EDIT-09: Edit PDF, Annotate, and the editor's export.
 * ------------------------------------------------------------------ */

const EDIT_ENGINES: Array<[string, Engine]> = [
  [
    "Edit PDF rectangle",
    async (b) =>
      (
        await editPdf(b, [
          {
            type: "rect",
            page: 1,
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            color: "#ff0000",
          },
        ])
      ).bytes,
  ],
  [
    "Annotate highlight",
    async (b) =>
      (
        await annotatePdf(b, [
          {
            type: "highlight",
            page: 1,
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            color: "#ffff00",
          },
        ])
      ).bytes,
  ],
  [
    "editor export rectangle",
    async (b) =>
      (
        await exportEditedPdf(b, [
          {
            id: "r",
            kind: "shape",
            shape: "rect",
            page: 0,
            x: 100,
            y: 100,
            width: 80,
            height: 30,
            stroke: null,
            strokeWidth: 1,
            fill: "#ff0000",
            opacity: 1,
          },
        ])
      ).bytes,
  ],
  [
    // Redact rewrites the page content (editor/content-edit.ts) after the
    // isolation step: the brackets must survive that rewrite.
    "editor export redaction, then a rectangle",
    async (b) =>
      (
        await exportEditedPdf(b, [
          {
            id: "x",
            kind: "redact",
            page: 0,
            x: 0,
            y: 0,
            width: 612,
            height: 792,
            fill: "black",
          },
          {
            id: "r",
            kind: "shape",
            shape: "rect",
            page: 0,
            x: 100,
            y: 100,
            width: 80,
            height: 30,
            stroke: null,
            strokeWidth: 1,
            fill: "#ff0000",
            opacity: 1,
          },
        ])
      ).bytes,
  ],
];

describe("EDIT-09: an edit lands where it was placed", () => {
  for (const [engineName, run] of EDIT_ENGINES) {
    for (const [hostileName, content] of HOSTILE) {
      // A redaction over an inline image is refused by design ("Use Redact
      // PDF, which flattens the page"), so that pairing has nothing to place.
      if (engineName.includes("redaction") && content.includes(" BI "))
        continue;
      test(`EDIT-09: ${engineName} — ${hostileName}`, async () => {
        const want = await pathBoxes(await run(await page(CONTROL)));
        expect(want.length).toBeGreaterThan(0);
        const got = await pathBoxes(await run(await page(content)));
        expect(got).toEqual(want);
      }, 60_000);
    }
  }

  // Inverted from the matrix (branch test/hostile-matrix, its editing matrix file,
  // describe "viewer proofs"): it was a test.fails beside "observed today:
  // that box lands at (1,1)-(3,3)". The box now lands where it was drawn.
  test("EDIT-09: a box drawn at (10,10) on a page that leaves 'q 0.1 0 0 0.1 0 0 cm q' open lands at (10,10)", async () => {
    const f = (await editingFixtures()).find(
      (x) => x.id === "H24-unclosed-q-cm-2",
    )!;
    const out = await EDIT_ENGINES[0]![1](f.bytes);
    const boxes = await pathBoxes(out);
    // Health: the read saw the page's own (scaled) box, so a red here is the
    // placement, not a blind reader.
    expect(boxes).toContain("50,50,130,130");
    expect(boxes).toContain("10,10,30,30");
    expect(boxes).not.toContain("1,1,3,3");
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  The 100,000-deep fixtures, bounded in a child.
 * ------------------------------------------------------------------ */

describe("STAMP-09 / EDIT-09 at depth 100,000 (child process, independent interpreter)", () => {
  const CHILD = "src/tests/hostile/content-isolation.child.ts";
  const cases: Array<[string, string]> = [
    ["H24-pops-then-scale", "page-numbers"],
    ["H24-unclosed-q-scale", "page-numbers"],
    ["H24-unclosed-q-scale", "watermark"],
    ["H24-pops-then-scale", "edit"],
  ];
  type Probe = { engineMs: number; at: { ctm: number[]; depth: number } };
  const settled = async (fixture: string, engine: string): Promise<Probe> => {
    const r = await runBounded(CHILD, [fixture, engine], 60_000);
    expect(r.kind, JSON.stringify(r)).toBe("settled");
    return (r as { value: Probe }).value;
  };
  const round = (m: number[]) => m.map((n) => Math.round(n * 1000) / 1000);
  for (const [fixture, engine] of cases) {
    test(`STAMP-09/EDIT-09: ${engine} on ${fixture} draws with the control's CTM and save depth`, async () => {
      const control = await settled("CONTROL-valid", engine);
      const got = await settled(fixture, engine);
      // Health: the probe found the drawing on the control, at scale 1.
      expect(control.at).not.toBeNull();
      expect(scaleOf(control.at.ctm as never)).toBeCloseTo(1, 6);
      expect(got.at).not.toBeNull();
      expect(round(got.at.ctm)).toEqual(round(control.at.ctm));
      expect(got.at.depth).toBe(control.at.depth);
    }, 140_000);
  }
});

/* ------------------------------------------------------------------ *
 *  What must NOT change.
 * ------------------------------------------------------------------ */

const CORPUS = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");

describe("balanced pages are left alone", () => {
  test("a balanced page gets exactly pdf-lib's own wrapping: [q, original, Q, stamp]", async () => {
    const out = await PDFDocument.load(
      await addPageNumbers(await page(CONTROL)),
    );
    const contents = out.getPage(0).node.Contents()!;
    expect(contents.toString().match(/\d+ 0 R/g)).toHaveLength(4);
  });

  test("every page of the legit corpus scans, none is skipped, and a balanced one is untouched", async () => {
    const files = readdirSync(CORPUS).filter((f) => f.endsWith(".pdf"));
    // Corpus health: a shrunken corpus would pass vacuously.
    expect(files.length).toBe(14);
    let pages = 0;
    let balanced = 0;
    for (const file of files) {
      const doc = await PDFDocument.load(
        readFileSync(path.join(CORPUS, file)),
        {
          ignoreEncryption: true,
        },
      );
      for (const p of doc.getPages()) {
        const before = String(p.node.get(PDFName.of("Contents")));
        // At a 64 KB budget, not the default: no page skipped here is the
        // measurement behind ISOLATION_DECODE_BUDGET's 500x headroom.
        const outcome = await isolatePageContent(p, 64 * 1024);
        pages += 1;
        expect(outcome.kind, `${file}`).not.toBe("skipped");
        if (outcome.kind === "balanced") {
          balanced += 1;
          expect(String(p.node.get(PDFName.of("Contents")))).toBe(before);
        }
      }
    }
    expect(pages).toBe(62);
    // Real producers write balanced content; measured: all 62.
    expect(balanced).toBe(62);
    expect(ISOLATION_DECODE_BUDGET / (64 * 1024)).toBe(512);
  }, 60_000);
});

describe("decoding is bounded", () => {
  test("a page over the budget is left exactly as it was (skipped, not refused)", async () => {
    const doc = await PDFDocument.load(
      await page(`q ${SCALE} q q ${BASE_TEXT}`),
    );
    const p = doc.getPage(0);
    const before = String(p.node.get(PDFName.of("Contents")));
    expect(await isolatePageContent(p, 16)).toEqual({
      kind: "skipped",
      reason: "budget",
    });
    expect(String(p.node.get(PDFName.of("Contents")))).toBe(before);
  });

  test("positive control: the same page within budget is isolated", async () => {
    const doc = await PDFDocument.load(
      await page(`q ${SCALE} q q ${BASE_TEXT}`),
    );
    expect(await isolatePageContent(doc.getPage(0))).toEqual({
      kind: "isolated",
      blanked: 0,
      closed: 3,
    });
  });

  test("a deflate bomb as page content stops at the budget instead of inflating", async () => {
    // 1.5x the budget of zeros: pdf-lib's flate compresses it ~1000:1.
    const doc = await PDFDocument.create();
    const p = doc.addPage([612, 792]);
    const zeros = new Uint8Array(ISOLATION_DECODE_BUDGET * 1.5);
    p.node.set(
      PDFName.of("Contents"),
      doc.context.register(doc.context.flateStream(zeros)),
    );
    const loaded = await PDFDocument.load(await doc.save());
    const t0 = Date.now();
    expect(await isolatePageContent(loaded.getPage(0))).toEqual({
      kind: "skipped",
      reason: "budget",
    });
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 60_000);
});
