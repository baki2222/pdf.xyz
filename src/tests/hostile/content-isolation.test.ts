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
import * as PdfLib from "pdf-lib";
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
import { expectRatioBelow, measureTime } from "../time-bound";
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
    // Inverted (review of l06): this case used to assert "QQ and qQ are not
    // q or Q" — 0 surplus, 1 open. pdf.js lexes a run of letters greedily
    // but stops where the next letter would leave its operator table, so
    // `QQ` is Q, Q and `qQ` is q, Q. The old reading meant `qq 2 0 0 2 0 0
    // cm Q Q` had two "surplus" Q blanked out from under a page that pdf.js
    // draws balanced (see the review-l06 tests below).
    ["QQ and qQ split the way pdf.js lexes them", "q QQ qQ", 1, 0],
    ["a number ends at a letter: 1Q is 1, Q", "q 1Q", 0, 0],
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
 *  Review of l06: the page's OWN bytes are rewritten only from a scan a
 *  viewer agrees with. Blanking a surplus Q is the one step that changes
 *  how the page's own content draws, so a misread there corrupts a page
 *  that renders correctly today.
 * ------------------------------------------------------------------ */

function bytesOf(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const part of parts)
    out.push(
      ...(typeof part === "string" ? Buffer.from(part, "latin1") : part),
    );
  return new Uint8Array(out);
}

/** 64 mid-gray pixel bytes with `inject` written at offset 10. */
function pixels(inject: string): number[] {
  const pix = new Array<number>(64).fill(0x80);
  Buffer.from(inject, "latin1").forEach((c, k) => (pix[10 + k] = c));
  return pix;
}

async function rawPage(
  content: Uint8Array,
  dict: Record<string, unknown> = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  p.node.setFontDictionary(PDFName.of("F1"), font.ref);
  const stream = doc.context.flateStream(content, dict as never);
  p.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save();
}

const IMAGE_HEAD = "q 100 0 0 100 50 50 cm BI /W 8 /H 8 /CS /G /BPC 8 ID ";

// The reviewer's probe: an uncompressed 8x8 gray inline image whose pixel
// bytes happen to contain " EI " and then " Q ". The page is balanced;
// pdf.js reads `Base` at (72,700) and the image at [50,50,150,150].
const FALSE_EI = bytesOf(
  IMAGE_HEAD,
  pixels(" EI Q "),
  `\nEI Q\nq 0.5 0 0 0.5 0 0 cm Q\n${BASE_TEXT}\n`,
);

// pdf.js lexes `qq` as q, q: balanced, Base at full size. Read as one unknown
// word, `qq` left both Q looking surplus, and blanking them shrank Base 10x.
const DOUBLED = enc(`qq ${SCALE} Q Q ${BASE_TEXT}`);

async function ownContent(bytes: Uint8Array) {
  const read = await readAsViewer(bytes);
  return {
    base: read.texts
      .filter((t) => /^Base/.test(t.str))
      .map((t) => [t.str, Math.round(t.x), Math.round(t.y), t.size]),
    images: read.images.map((b) => b.map((n) => Math.round(n)).join(",")),
  };
}

const OWN_CONTENT_ENGINES: Array<[string, Engine]> = [
  ...STAMP_ENGINES,
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
];

describe("review-l06: a page that renders correctly today still does after the tool", () => {
  test("review-l06: false ' EI ' inside uncompressed inline image data is image data (length and pdf.js agree)", () => {
    expect(scanContentBalance(FALSE_EI)).toEqual({
      surplus: [],
      open: 0,
      uncertain: false,
    });
  });

  // pdf.js accepts a false EI only when an operator, with the right number
  // of operands, follows it. These two follow a false EI with printable
  // bytes that fail that test, so pdf.js (and the length) read on to the
  // real EI and the page stays certain.
  for (const [what, inject] of [
    ["an unknown operator ('[')", " EI [1 2 3 4 5 6 7 8] "],
    ["the wrong operand count (3 before cm)", " EI 1 2 3 cm 4 5 6 7 8 "],
  ] as const) {
    test(`review-l06: a false EI followed by ${what} is still image data`, () => {
      const content = bytesOf(
        IMAGE_HEAD,
        pixels(inject),
        `\nEI Q\n${BASE_TEXT}\n`,
      );
      expect(scanContentBalance(content)).toEqual({
        surplus: [],
        open: 0,
        uncertain: false,
      });
    });
  }

  test("review-l06: `qq … Q Q` is two saves and two restores, as pdf.js lexes it", () => {
    expect(scanContentBalance(DOUBLED)).toEqual({
      surplus: [],
      open: 0,
      uncertain: false,
    });
  });

  for (const [fixtureName, content] of [
    ["inline image data containing ' EI ' and ' Q '", FALSE_EI],
    ["`qq <scale> Q Q`", DOUBLED],
  ] as const) {
    for (const [engineName, run] of OWN_CONTENT_ENGINES) {
      test(`review-l06: ${engineName} — ${fixtureName}: the page's own text and image read where pdf.js read them before`, async () => {
        const original = await rawPage(content);
        const before = await ownContent(original);
        // Health: the base line was read, at full size, where it was drawn.
        expect(before.base).toEqual([["Base", 72, 700, 24]]);
        expect(await ownContent(await run(original))).toEqual(before);
      }, 60_000);
    }
  }

  test("review-l06: on every fixture in this file, the scanner's q/Q balance is pdf.js's own (read from its operator list)", async () => {
    // The scanner copies pdf.js's lexing rules; this is the independent
    // check that the copy agrees with the real thing. pdf.js's operator
    // list keeps every save and restore, so walking it gives the surplus Q
    // a viewer actually executes. pdf.js appends a restore for every save
    // left open at the end, so open q are read as the depth at a sentinel
    // operator (`7 w`, used nowhere else) appended to each fixture.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { PDFJS_DOCUMENT_DEFAULTS } = await import("@/lib/pdf/wasm-assets");
    const viewerBalance = async (bytes: Uint8Array) => {
      const task = pdfjs.getDocument({
        ...PDFJS_DOCUMENT_DEFAULTS,
        data: bytes.slice(),
        useWorkerFetch: false,
        disableFontFace: true,
      });
      const doc = await task.promise;
      try {
        const list = await (await doc.getPage(1)).getOperatorList();
        let depth = 0;
        let surplus = 0;
        let qQ = 0;
        let open = -1;
        for (const fn of list.fnArray) {
          if (fn === pdfjs.OPS.setLineWidth) open = depth;
          else if (fn === pdfjs.OPS.save) {
            qQ += 1;
            depth += 1;
          } else if (fn === pdfjs.OPS.restore) {
            qQ += 1;
            if (depth === 0) surplus += 1;
            else depth -= 1;
          }
        }
        return { surplus, open, qQ };
      } finally {
        await task.destroy();
      }
    };
    const fixtures: Array<[string, Uint8Array]> = [
      ["false EI", FALSE_EI],
      ["qq … Q Q", DOUBLED],
      ["q QQ qQ", enc("q QQ qQ")],
      ["q 1Q", enc("q 1Q")],
      [
        "false EI then '['",
        bytesOf(IMAGE_HEAD, pixels(" EI [1 2 3 4 5 6 7 8] "), "\nEI Q\n"),
      ],
      [
        "false EI then 3 operands for cm",
        bytesOf(IMAGE_HEAD, pixels(" EI 1 2 3 cm 4 5 6 7 8 "), "\nEI Q\n"),
      ],
      ...HOSTILE.map(([name, c]): [string, Uint8Array] => [name, enc(c)]),
    ];
    let compared = 0;
    for (const [name, fixture] of fixtures) {
      const content = bytesOf([...fixture], "\n7 w\n");
      const viewer = await viewerBalance(await rawPage(content));
      // Health: pdf.js read q/Q from the page at all.
      expect(viewer.qQ, name).toBeGreaterThan(0);
      expect(viewer.open, `${name}: sentinel read`).toBeGreaterThanOrEqual(0);
      const scan = scanContentBalance(content);
      expect({ surplus: scan.surplus.length, open: scan.open }, name).toEqual({
        surplus: viewer.surplus,
        open: viewer.open,
      });
      compared += 1;
    }
    expect(compared).toBe(9);
  }, 60_000);

  test("review-l06: where pdf.js and the image's own length disagree about its end, the page is left exactly as before", async () => {
    // pdf.js ends this image at the false EI (operators follow it);
    // /W /H /BPC say it runs 64 bytes. Two readings, so no rewrite.
    const content = bytesOf(
      IMAGE_HEAD,
      pixels(" EI Q 1 0 0 1 0 0 cm "),
      `\nEI Q Q ${SCALE} ${BASE_TEXT}\n`,
    );
    expect(scanContentBalance(content).uncertain).toBe(true);
    const doc = await PDFDocument.load(await rawPage(content));
    const p = doc.getPage(0);
    const before = String(p.node.get(PDFName.of("Contents")));
    expect(await isolatePageContent(p, PdfLib)).toEqual({
      kind: "skipped",
      reason: "ambiguous",
    });
    expect(String(p.node.get(PDFName.of("Contents")))).toBe(before);
  });

  test("review-l06 round 2: pdf.js's E/I state machine sees no EI in `EEI`, so an image whose last data byte is E is not 'certain'", async () => {
    // /W 1 /H 1 /BPC 8 gray: one byte, `E`, then EI. Counting bytes ends it
    // there; pdf.js's machine (E, then E resets without re-testing) misses
    // that EI and reads on. Two readings: the surplus Q must not be blanked.
    const head = "Q\nBI /W 1 /H 1 /CS /G /BPC 8 ID ";
    const got = scanContentBalance(enc(`${head}EEI\nQ\n`));
    expect(got.surplus[0]).toBe(0);
    expect(got.uncertain).toBe(true);
    // Positive control: one byte of whitespace between the data and EI, and
    // both readings agree.
    expect(scanContentBalance(enc(`${head}E EI\nQ\n`))).toEqual({
      surplus: [0, 37],
      open: 0,
      uncertain: false,
    });
  });

  test("review-l06: a filtered inline image with no /L has no second reading, so a surplus Q beside it is not blanked", async () => {
    const tail = `\nEI Q Q ${SCALE} ${BASE_TEXT}\n`;
    const filtered = bytesOf(
      "q BI /W 8 /H 8 /IM true /F /CCF ID ",
      pixels(" EI Q "),
      tail,
    );
    const doc = await PDFDocument.load(await rawPage(filtered));
    const p = doc.getPage(0);
    const before = String(p.node.get(PDFName.of("Contents")));
    expect(await isolatePageContent(p, PdfLib)).toEqual({
      kind: "skipped",
      reason: "ambiguous",
    });
    expect(String(p.node.get(PDFName.of("Contents")))).toBe(before);

    // Positive control: the same page with an /L the data agrees with
    // is read for certain, and its real surplus Q is blanked.
    const withLength = bytesOf(
      "q BI /W 8 /H 8 /IM true /F /CCF /L 64 ID ",
      pixels("\x80\x80\x80\x80\x80\x80"),
      tail,
    );
    const ok = await PDFDocument.load(await rawPage(withLength));
    expect(await isolatePageContent(ok.getPage(0), PdfLib)).toEqual({
      kind: "isolated",
      blanked: 1,
      closed: 0,
    });
  });

  test("review-l06: a content stream with a /Predictor (which pdf-lib does not undo) is not rewritten", async () => {
    const content = enc(`Q ${SCALE} ${BASE_TEXT}`);
    const doc = await PDFDocument.load(
      await rawPage(content, { DecodeParms: { Predictor: 12, Columns: 4 } }),
    );
    const p = doc.getPage(0);
    const before = String(p.node.get(PDFName.of("Contents")));
    expect(await isolatePageContent(p, PdfLib)).toEqual({
      kind: "skipped",
      reason: "unreadable",
    });
    expect(String(p.node.get(PDFName.of("Contents")))).toBe(before);
    // Positive control: without the predictor the same bytes are isolated.
    const plain = await PDFDocument.load(await rawPage(content));
    expect(await isolatePageContent(plain.getPage(0), PdfLib)).toMatchObject({
      kind: "isolated",
      blanked: 1,
    });
  });
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
        // At a 64 KB page budget and a 4 MiB document budget, not the
        // defaults: no page skipped here is the measurement behind the 512x
        // headroom of ISOLATION_DECODE_BUDGET and the 64x of the 256 MiB
        // document budget (pinned at 8 full pages in the child test below).
        const outcome = await isolatePageContent(
          p,
          PdfLib,
          64 * 1024,
          4 * 1024 * 1024,
        );
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
    expect(await isolatePageContent(p, PdfLib, 16)).toEqual({
      kind: "skipped",
      reason: "budget",
    });
    expect(String(p.node.get(PDFName.of("Contents")))).toBe(before);
  });

  test("positive control: the same page within budget is isolated", async () => {
    const doc = await PDFDocument.load(
      await page(`q ${SCALE} q q ${BASE_TEXT}`),
    );
    expect(await isolatePageContent(doc.getPage(0), PdfLib)).toEqual({
      kind: "isolated",
      blanked: 0,
      closed: 3,
    });
  });

  test("scanning a full budget of ordinary operators stays bounded (0.26 s measured, 5 s allowed)", () => {
    const unit = `q 1 0 0 1 5.5 5 cm 0 0 m 10 10 l S BT /F1 12 Tf (Hello \\) world) Tj ET Q\n`;
    const content = enc(
      unit.repeat(Math.floor(ISOLATION_DECODE_BUDGET / unit.length)),
    );
    const t0 = Date.now();
    const got = scanContentBalance(content);
    // Kept raw (review 2026-11-22): never flaky on CI, and the result
    // asserted here is the same however slow the scan was, so it cannot
    // stand in for this bound. The CI max is beside it.
    // Test CI max 854 ms (12 runs of 2026-11-18): 5 s is 5.9x.
    expect(Date.now() - t0).toBeLessThan(5_000);
    // Health: it read the whole thing as the balanced, certain page it is.
    expect(got).toEqual({ surplus: [], open: 0, uncertain: false });
  }, 30_000);

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
    expect(await isolatePageContent(loaded.getPage(0), PdfLib)).toEqual({
      kind: "skipped",
      reason: "budget",
    });
    // Kept raw (review 2026-11-22): never flaky on CI, and the result
    // asserted here is the same however slow the scan was, so it cannot
    // stand in for this bound. The CI max is beside it.
    // Test CI max 1,255 ms (12 runs of 2026-11-18): 10 s is 8x.
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 *  Review of l06, round 2: the WORK is bounded, not only the bytes.
 *  ISOLATION_DECODE_BUDGET bounds bytes per page. It said nothing about
 *  (a) a scan that re-searched the rest of the stream for every inline
 *  image with no EI (a 2.7 KB PDF took 49 s), or (b) a stream shared by
 *  many pages, decoded, scanned and rewritten once PER PAGE (a 60 KB file
 *  took 20 s and came out 50x larger). Both run in a child: a regression
 *  blocks the event loop, so only a kill makes it a red.
 * ------------------------------------------------------------------ */

describe("review-l06 round 2: isolation work is bounded per stream and per document", () => {
  const WORK = "src/tests/hostile/content-isolation-work.child.ts";
  type Stamped = {
    ms: number;
    inBytes: number;
    outBytes: number;
    /** contentScanSteps across the stamp alone (the child's `stamp`). */
    steps: number;
  };
  const settle = async <T>(args: string[], bound: number): Promise<T> => {
    const r = await runBounded(WORK, args, bound, { maxOldSpaceMb: 2048 });
    expect(r.kind, JSON.stringify(r)).toBe("settled");
    return (r as { value: T }).value;
  };

  /** A scan's size ratio (`ratio` in the child): one shape at two sizes, best of 3 each. */
  type Ratio = {
    smallBytes: number;
    bigBytes: number;
    smallMs: number;
    bigMs: number;
    /** The bytes each scan stepped over (contentScanSteps): no clock in it. */
    smallSteps: number;
    bigSteps: number;
  };

  /**
   * The scan's work as counts (review 2026-11-22): the bytes it stepped
   * over per byte scanned, against `perByte`, and the step count's own size
   * ratio, which a linear scan holds at the byte ratio (8 here) and a
   * quadratic one at its square. Six extra lexer passes ran 1.52x slower
   * with every outcome unchanged, inside the old time ratio; as steps they
   * are red. What only time sees: a step that got costlier per byte.
   */
  const stepShape = (
    steps: number,
    bytes: number,
    perByte: number,
    ratio: Ratio,
  ) => ({
    overSteps: Math.max(0, steps - perByte * bytes),
    stepRatio: Math.round((ratio.bigSteps / ratio.smallSteps) * 10) / 10,
  });

  test("a full budget of inline images that no EI ends scans in linear time", async () => {
    const got = await settle<{
      ms: number;
      bytes: number;
      surplus: number;
      uncertain: boolean;
      steps: number;
      ratio: Ratio;
    }>(
      [
        "scan-ei-less",
        String(ISOLATION_DECODE_BUDGET),
        `${512 * 1024}:${4 * 2 ** 20}`,
      ],
      60_000,
    );
    // Health: it built and read the whole budget, and found the leading Q
    // without trusting the guessed image ends. A quadratic re-search (the
    // round-2 defect, the knownNone shortcut lost) never finishes 32 MiB:
    // the 60 s kill reds it on any runner.
    expect(got.bytes).toBeGreaterThan(ISOLATION_DECODE_BUDGET - 16);
    const found = [got.surplus, got.uncertain];
    expect(found).toEqual([1, true]);
    // Linear is the claim, so it is a size ratio (CI-flake audit lane 2):
    // 4 MiB against 512 KiB of the same shape, in the same child, best of 3
    // each. Linear reads about 8, quadratic about 64. It WAS `ms < 10_000`
    // on the full budget: CI's test reached 8,353 ms (43998624497), 1.2x.
    // Measure mode until harvested.
    const { ratio } = got;
    expect(ratio.bigBytes / ratio.smallBytes).toBeCloseTo(8, 1);
    // Honest: 1.85 steps per byte (61,946,631 for 32 MiB), step ratio 8.0.
    // One extra pass over the content is 2.85: red at 2.
    const work = stepShape(got.steps, got.bytes, 2, ratio);
    expect(work, `${got.steps} steps for ${got.bytes} bytes`).toEqual({
      overSteps: 0,
      stepRatio: 8,
    });
    expectRatioBelow(
      "content-isolation-ei-less-linear",
      ratio.bigMs,
      ratio.smallMs,
      24,
      {
        detail: `full budget ${got.ms} ms; 4 MiB ${ratio.bigMs.toFixed(1)} ms, 512 KiB ${ratio.smallMs.toFixed(1)} ms`,
        mode: "measure",
        witness: "work",
      },
    );
  }, 90_000);

  test("the costliest inline-image shape, EI candidates pdf.js tests one by one, scans in linear time (as steps per byte and a size ratio)", async () => {
    // Every `EI ` passes pdf.js's printable test and costs a 75-byte lex, the
    // same work pdf.js does to display the page. The bare scan is unmetered;
    // isolatePageContent meters it (round 3, below), so here only linearity
    // is the claim. Round 2 ran a full 32 MiB and said "8.6 s measured, 30 s
    // allowed"; the round-3 reviewer measured 18.7 s under load, too close to
    // flake. An eighth of the budget makes the same claim with a 10x margin.
    //
    // 2026-11-22 (CI-flake audit lane 2): "a 10x margin" was a Windows
    // figure; CI's test reached 5,239 ms (43998624497) against the 10 s
    // bound, 1.9x. Linearity is now a size ratio in the same child: 2 MiB
    // against 256 KiB of the same shape, best of 3 each (linear about 8,
    // quadratic about 64). A per-candidate test that ran to the end of the
    // stream (the printable test's `stop = n`) is O(n^2) and the 60 s kill
    // reds it on any runner, before any ratio.
    const size = ISOLATION_DECODE_BUDGET / 8;
    const got = await settle<{
      ms: number;
      bytes: number;
      uncertain: boolean;
      steps: number;
      ratio: Ratio;
    }>(["scan-dense-ei", String(size), `${256 * 1024}:${2 * 2 ** 20}`], 60_000);
    expect(got.bytes).toBeGreaterThan(size - 16);
    expect(got.uncertain).toBe(true);
    const { ratio } = got;
    expect(ratio.bigBytes / ratio.smallBytes).toBeCloseTo(8, 1);
    // Honest: 31.0 steps per byte (130,022,012 for 4 MiB: each 3-byte `EI `
    // is a 75-byte printable test and its lex), step ratio 8.0. One extra
    // lexer pass over the content is 32: red at 31.5.
    const work = stepShape(got.steps, got.bytes, 31.5, ratio);
    expect(work, `${got.steps} steps for ${got.bytes} bytes`).toEqual({
      overSteps: 0,
      stepRatio: 8,
    });
    expectRatioBelow(
      "content-isolation-dense-ei-linear",
      ratio.bigMs,
      ratio.smallMs,
      24,
      {
        detail: `4 MiB ${got.ms} ms; 2 MiB ${ratio.bigMs.toFixed(1)} ms, 256 KiB ${ratio.smallMs.toFixed(1)} ms`,
        mode: "measure",
        witness: "work",
      },
    );
  }, 90_000);

  test("past the document budget, pages are left as before: 12 distinct ~30 MB pages, 8 isolated, the rest refused at their first chunk", async () => {
    const got = await settle<{
      ms: number;
      kinds: string[];
      pageMs: number[];
      pageBytes: number[];
    }>(["isolate-distinct", "12"], 120_000);
    // Ignoring the document budget isolates all 12: red here on any runner.
    const kinds = got.kinds;
    expect(kinds).toEqual([
      ...Array(8).fill("isolated"),
      ...Array(4).fill("skipped:budget"),
    ]);
    // Past the budget a page costs almost nothing: it is refused at its
    // first 64 KiB chunk (DECODE_CHUNK, content-isolation.ts), not decoded
    // and then refused. As BYTES, counted at the decoder the child hands
    // isolation: no runner's speed moves them (review 2026-11-22: `kinds`
    // is the same for decode-then-refuse, and its time ratio read 0.13,
    // inside the 0.2 below, so nothing could fail on that defect). Pages
    // 10-12 only; page 9 legitimately decodes the budget's last ~28 MB.
    // Positive control: each isolated page decoded its whole ~30 MB.
    expect(got.pageBytes).toHaveLength(12);
    for (const [i, bytes] of got.pageBytes.slice(0, 8).entries())
      expect(bytes, `page ${i + 1} decoded`).toBeGreaterThan(29_000_000);
    const pastBudgetOverChunk = Math.max(
      0,
      ...got.pageBytes.slice(9).map((b) => b - 64 * 1024),
    );
    expect(
      pastBudgetOverChunk,
      `pages 10-12 decoded ${got.pageBytes.slice(9).join(", ")} bytes`,
    ).toBe(0);
    // And the time, per page in the same child (CI-flake audit lane 2),
    // where it WAS an absolute `ms < 15_000` on the whole loop, which CI's
    // test reached at 14,737 ms (43629904891). Medians, so one major GC on
    // one page cannot decide it. Decode-then-refuse measured 0.13 on
    // Windows (honest 0.01), so 0.2 would not catch it either: the bytes
    // above are the detector, this is printed until CI is harvested.
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)]!;
    };
    expect(got.pageMs).toHaveLength(12);
    const isolatedMs = median(got.pageMs.slice(0, 8));
    const pastBudgetMs = median(got.pageMs.slice(9));
    expectRatioBelow(
      "content-isolation-past-budget-page",
      pastBudgetMs,
      isolatedMs,
      0.2,
      {
        detail: `loop ${got.ms} ms; pages ${got.pageMs.map((m) => Math.round(m)).join(" ")} ms`,
        mode: "measure",
        witness: "pastBudgetOverChunk",
      },
    );
  }, 150_000);

  /*
   * Review of l06, round 3: the budgets above counted BYTES, but the costliest
   * shapes cost far more per byte than ordinary operators (an `EI ` candidate
   * ~0.75 us, an inline image ~0.9 us, an ordinary byte ~8 ns). 8 full pages
   * of the dense shape froze addPageNumbers for 104 s on a 318 KB file (base:
   * under 1 s). The budget now meters WORK: each candidate test and each
   * inline image is charged as the bytes it costs, so no shape buys more
   * than ordinary content does. Ten distinct pages of each shape, the
   * reviewer's multi-page repro, through the engine.
   */
  for (const shape of ["dense", "eiless"] as const) {
    test(`ten distinct ~31 MiB pages of the ${shape} shape stamp in bounded time (review-l06 round 3)`, async () => {
      const got = await settle<Stamped & { kinds: string[] }>(
        ["stamp-costly", shape, "10"],
        60_000,
      );
      // Health: it is the reviewer's small file, not a 300 MB one.
      expect(got.inBytes).toBeLessThan(1_000_000);
      // The work meter, as outcomes (CI-flake audit lane 2): every page
      // costs more scan work than its budget, so isolation leaves each one
      // as it was. A meter that stopped charging images or EI candidates
      // (IMAGE_WORK or CANDIDATE_WORK at 0) scans them in full and
      // isolates them: red on any runner, where the 10 s bound below saw it
      // only while CI stayed fast (IMAGE_WORK=0: about 18 s on Windows,
      // 40-55 s on CI, under the 60 s kill).
      const kinds = got.kinds;
      expect(kinds).toEqual(Array(10).fill("skipped:budget"));
      // `kinds` cannot see a page scanned to the END and only then refused
      // (witness audit, 2026-11-22: with every early exit removed the
      // verdicts stayed the same and eiless took 25 s against 10). The scan
      // steps across the stamp can: an over-budget page may read its bytes
      // once (the first EI search runs to the end), no more, and the
      // document budget lets at most 8 of the 10 pages be scanned. Honest:
      // eiless 260,767,616 steps (0.80 of the bound), dense 6,094,392. No
      // early exit: eiless 480,086,136, dense 8,321,482,024 (102 s). A count,
      // so it is the same on any runner.
      const pageBytes = 31 * 2 ** 20;
      const overScan = Math.max(0, got.steps - 1.25 * 8 * pageBytes);
      expect(overScan, `${got.steps} steps across the stamp`).toBe(0);
      // Positive control: the stamp's own isolation was counted.
      expect(got.steps).toBeGreaterThan(1_000_000);
      // Measure mode until harvested: CI's test reached 5,566 ms (eiless,
      // 44321190257) and 4,688 ms (dense, 43629904891), fixture build and
      // spawn included; the stamp alone was never printed.
      measureTime("content-isolation-stamp-costly", got.ms, 10_000, {
        instance: shape,
        witness: "overScan",
      });
    }, 90_000);
  }

  test("the worst DOCUMENT for the work meter: 20 dense pages each scanned in full under the page budget, until the document budget", async () => {
    // 512 KiB of `EI ` candidates costs ~23 MiB of work: under the page
    // budget, so each page is scanned to the end and charged in full, and
    // the document budget stops it after ~11 pages. Over the page budget
    // (the tests above) a page stops early; this is the shape that spends
    // the whole document budget on scanning.
    const got = await settle<{
      ms: number;
      kinds: string[];
      ctrlMs: number;
      steps: number;
    }>(["isolate-costly", "dense", "20", "512"], 60_000);
    // Health: the early pages really were scanned to the end (ambiguous is
    // decided only from a complete scan), and the budget then stopped it.
    const kinds = got.kinds;
    const full = kinds.filter((k) => k === "skipped:ambiguous").length;
    expect(full).toBeGreaterThanOrEqual(8);
    // 20 x 512 KiB is 10 MiB of BYTES, 1/25 of the document budget: pages
    // are skipped only because the scan work is charged to the document.
    // A meter charged nothing fits every page (full = 20): red on any runner.
    expect(full).toBeLessThan(20);
    expect(kinds).toEqual([
      ...Array(full).fill("skipped:ambiguous"),
      ...Array(20 - full).fill("skipped:budget"),
    ]);
    // The work DONE against the work charged (review 2026-11-22: `kinds`
    // cannot see a metered unit doing more than it is charged for). The
    // bytes the scan stepped over (contentScanSteps), against the document
    // budget, 256 MiB of charged work: honest 196,219,104 steps, 0.73 of
    // it. A unit that reads more bytes than it is charged for, or an extra
    // pass the meter never hears of, passes 0.8: six extra lexer passes
    // read 0.87. Positive control: `full` pages above were scanned.
    const documentBudget = 8 * ISOLATION_DECODE_BUDGET;
    const overSteps = Math.max(0, got.steps - 0.8 * documentBudget);
    expect(overSteps, `${got.steps} steps`).toBe(0);
    expect(got.steps).toBeGreaterThan(full * 512 * 1024);
    // What only time sees: one metered unit costing far more TIME than the
    // ordinary byte it is charged as, its bytes unchanged. Read against the
    // same child's scan of 4 MiB of ordinary operators (best of 3): the
    // whole document budget is 64 of them. Both are measure mode until
    // harvested (CI-flake audit lane 2). It WAS `ms < 10_000`; CI's test
    // reached 8,929 ms (44007721339), 1.12x. 20 s is 2.24x over that; the
    // ratio's CI spread is estimated at 1.5-2.2 from same-run durations,
    // never measured. The ratio is the one check of that per-unit cost, so
    // it is pending (wall-clock-pending.ts), not witnessed.
    const said = `${got.ms} ms; 4 MiB ordinary ${got.ctrlMs.toFixed(1)} ms; ${got.steps} steps`;
    measureTime("content-isolation-costly-document", got.ms, 20_000, {
      detail: said,
      witness: "overSteps",
    });
    expectRatioBelow(
      "content-isolation-costly-document-vs-budget",
      got.ms,
      64 * got.ctrlMs,
      4.5,
      { detail: said, mode: "measure" },
    );
  }, 90_000);

  test("a page whose scan would cost more than its budget is left as it was (skipped:budget), not scanned in full", async () => {
    const got = await settle<{ ms: number; kinds: string[] }>(
      ["isolate-costly", "dense", "2"],
      60_000,
    );
    expect(got.kinds).toEqual(["skipped:budget", "skipped:budget"]);
  }, 90_000);

  test("positive control for the work meter: a page of 10,000 inline images (a bitmap-glyph page) and a surplus Q is still isolated", async () => {
    // 10,000 certain images (each /W /H /BPC states its 1 data byte) is far
    // past any real page in the legit corpus (none has an inline image) and
    // costs 1/26 of the per-page budget.
    const glyph = "BI /W 8 /H 1 /CS /G /BPC 1 ID U EI\n";
    const doc = await PDFDocument.load(
      await page(`Q ${glyph.repeat(10_000)}${SCALE} ${BASE_TEXT}`),
    );
    expect(await isolatePageContent(doc.getPage(0), PdfLib)).toEqual({
      kind: "isolated",
      blanked: 1,
      closed: 0,
    });
  }, 60_000);

  test("the reviewer's 2.7 KB PDF (80,000 EI-less images) stamps in bounded time", async () => {
    const got = await settle<Stamped>(["stamp-ei-less", "80000"], 30_000);
    expect(got.inBytes).toBeLessThan(10_000);
    expect(got.ms).toBeLessThan(5_000);
  }, 60_000);

  test("one ~30 MB content stream shared by 50 pages is rewritten once, not 50 times", async () => {
    const got = await settle<Stamped>(["stamp-shared", "50"], 60_000);
    // One rewritten copy (~the input's own size) plus 50 small stamps; 50
    // copies came out at 50x the input.
    const overThreeCopies = Math.max(0, got.outBytes - got.inBytes * 3);
    expect(overThreeCopies, `${got.outBytes} of ${got.inBytes}`).toBe(0);
    // The size check sees 50 rewrites that are KEPT, not 50 scans thrown
    // away (witness audit, 2026-11-22: a cache that was read but still
    // decoded and scanned every page's stream passed it, at 13 s against
    // 10). The scan steps across the stamp see both: one scan of the
    // 30,000,002-byte stream is 30,000,003 steps; the mutant read
    // 1,500,000,101. Two scans' worth is the bound, and a count is the
    // same on any runner.
    const sharedBytes = 30_000_002;
    const overOneScan = Math.max(0, got.steps - 2 * sharedBytes);
    expect(overOneScan, `${got.steps} steps across the stamp`).toBe(0);
    // Positive control: the stamp's scan of the shared stream was counted.
    expect(got.steps).toBeGreaterThanOrEqual(sharedBytes);
    // Measure mode (CI-flake audit lane 2): the test took up to 2,511 ms
    // on CI (12 runs of 2026-11-18), so 10 s is 4x.
    measureTime("content-isolation-stamp-shared", got.ms, 10_000, {
      witness: "overOneScan",
    });
  }, 90_000);

  test("pages that share a stream share its one rewritten copy, and each is isolated", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ref = doc.context.register(
      doc.context.flateStream(`Q ${SCALE} ${BASE_TEXT}`),
    );
    for (let i = 0; i < 3; i += 1) {
      const p = doc.addPage([612, 792]);
      p.node.setFontDictionary(PDFName.of("F1"), font.ref);
      p.node.set(PDFName.of("Contents"), ref);
    }
    const loaded = await PDFDocument.load(await doc.save());
    const before = loaded.context.enumerateIndirectObjects().length;
    const outcomes = [];
    for (const p of loaded.getPages())
      outcomes.push(await isolatePageContent(p, PdfLib));
    expect(outcomes).toEqual(
      Array(3).fill({ kind: "isolated", blanked: 1, closed: 0 }),
    );
    const contents = loaded
      .getPages()
      .map((p) => String(p.node.get(PDFName.of("Contents"))));
    // Health: the page really was rewritten (it no longer names the original).
    expect(contents[0]).not.toBe(String(ref));
    expect(new Set(contents).size).toBe(1);
    // One rewritten stream registered for the document, not one per page.
    expect(loaded.context.enumerateIndirectObjects().length).toBe(before + 1);
    // And a stamp on every page lands at the control's place and size.
    const want = await stampRuns(await addPageNumbers(await page(CONTROL)));
    const stamped = await addPageNumbers(await loaded.save());
    for (let n = 1; n <= 3; n += 1) {
      const runs = (await readAsViewer(stamped, n)).texts.filter(
        (t) => !/^Base/.test(t.str),
      );
      expect(runs.map((t) => t.str)).toEqual([`Page ${n} of 3`]);
      expect(Math.round(runs[0]!.size * 100) / 100).toBe(want[0]!.size);
      expect(Math.round(runs[0]!.y * 10) / 10).toBe(want[0]!.y);
    }
  }, 60_000);

  test("a document-wide decode budget: past it, further pages are left as they were", async () => {
    const doc = await PDFDocument.create();
    const content = `Q ${SCALE} ${BASE_TEXT}`;
    for (let i = 0; i < 3; i += 1)
      doc
        .addPage([612, 792])
        .node.set(
          PDFName.of("Contents"),
          doc.context.register(doc.context.flateStream(`%${i}\n${content}`)),
        );
    const loaded = await PDFDocument.load(await doc.save());
    const per = content.length + 4; // "%i\n" + content + the joining newline
    const outcomes = [];
    for (const p of loaded.getPages())
      outcomes.push(await isolatePageContent(p, PdfLib, 1024, per * 2));
    expect(outcomes).toEqual([
      { kind: "isolated", blanked: 1, closed: 0 },
      { kind: "isolated", blanked: 1, closed: 0 },
      { kind: "skipped", reason: "budget" },
    ]);
  });
});
