// @vitest-environment node
// @native-canvas
/**
 * Lane res1 of the hostile-input residuals, the scan half (the open half runs
 * in child processes, in src/tests/hostile/pdfjs-guard-bounds.test.ts):
 *
 *  - item 3: a leading ASCIIHex or ASCII85 stage hid the Flate behind it, so a
 *    content stream (or an object stream) inflating to a gigabyte passed;
 *  - item 4: the `q` counter counted bytes inside literal strings, hex
 *    strings, comments and inline-image data, so a text-heavy document whose
 *    sentences say "q" was refused as "nested too deeply".
 *
 * The property the counter keeps is pdf.js's: it may count MORE `q` than
 * pdf.js executes (a refusal of a strange file), never fewer (a page pdf.js
 * climbs for minutes). The differential block below asks pdf.js itself.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { deflatedZeros, rawPdf } from "@/tests/hostile/conversion-out.fixtures";
import {
  ascii85,
  asciiHex,
  objStmBehindFiltersPdf,
  oneContentPdf,
  textPagesPdf,
} from "@/tests/hostile/pdfjs-open.fixtures";
import {
  ContentOps,
  MAX_GRAPHICS_STATE_DEPTH,
  PDFJS_CONTENT_COMMANDS,
  preflightPdfjsBytes,
  scanPdfStreams,
} from "./pdfjs-guard";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");

/** One page whose /Contents is an array of `streams`. */
function pagePdf(streams: readonly string[]): Uint8Array {
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents [${streams.map((_, i) => `${i + 5} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...streams.map((stream) => ({ dict: "", stream })),
  ]);
}

/** How many `q` pdf.js executes drawing page 1 (its save operators). */
async function pdfjsSaves(bytes: Uint8Array): Promise<number> {
  const pdfjs = await legacy();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const ops = await (await doc.getPage(1)).getOperatorList();
    return ops.fnArray.filter((f) => f === pdfjs.OPS.save).length;
  } finally {
    await task.destroy();
  }
}

const LINE = "(Let q be the charge, and q the flux) Tj T*";

describe("item 4: q inside text is not a q", () => {
  it("274 pages of a sentence that says 'q' twice, 30 lines a page, pass (16,440 counted before)", async () => {
    const bytes = textPagesPdf(274, LINE, 30);
    const scan = await scanPdfStreams(bytes);
    expect(scan).toMatchObject({ unclosedQ: 0, maxQDepth: 0, exceeded: null });
    await expect(preflightPdfjsBytes(bytes)).resolves.toMatchObject({
      overBudgetImage: false,
    });
  });

  it("strings with nested parentheses and escapes, hex strings, comments and inline-image data hold no q", async () => {
    const q = "q ".repeat(50);
    const cases: Record<string, string> = {
      nested: `BT (a (q ${q}) \\) ${q} \\( ${q} (b) ${q}) Tj ET\n`,
      escapedBackslash: `BT (${q}\\\\) Tj ET\n`,
      hex: `BT <71 20 ${q}> Tj ET\n`,
      comment: `% ${q}\n0 0 m\n`,
      inlineImage: `q BI /W 4 /H 1 /BPC 8 /CS /G ID\n${q}EI\nQ\n`,
    };
    for (const [name, content] of Object.entries(cases)) {
      const scan = await scanPdfStreams(pagePdf([content]));
      expect(scan.unclosedQ, name).toBe(0);
      expect(scan.maxQDepth, name).toBeLessThanOrEqual(1);
      // pdf.js agrees: none of these executes more than the one real q.
      expect(await pdfjsSaves(pagePdf([content])), name).toBeLessThanOrEqual(1);
    }
  });

  it("positive control: a real operator stream 16,385 q deep is still refused", async () => {
    const scan = await scanPdfStreams(
      pagePdf([`${LINE}\n${"q\n".repeat(MAX_GRAPHICS_STATE_DEPTH + 1)}`]),
    );
    expect(scan).toMatchObject({
      unclosedQ: MAX_GRAPHICS_STATE_DEPTH + 1,
      exceeded: "q-depth",
    });
  });

  it("positive control: a q split across two fed chunks is still counted, and so is a string split across them", () => {
    const ops = new ContentOps();
    ops.feed(new TextEncoder().encode("1 0 0 1 0 0 cm\nq"));
    ops.feed(new TextEncoder().encode("\nq (a q"));
    ops.feed(new TextEncoder().encode(" q) Tj\n"));
    ops.end();
    expect({ depth: ops.depth, pushes: ops.pushes }).toEqual({
      depth: 2,
      pushes: 2,
    });
  });
});

describe("item 4: the counter never counts fewer q than pdf.js executes", () => {
  // Each is a page pdf.js draws; the scan's reach must be at least what
  // pdf.js executes. The first block are pdf.js lexer rules the old counter
  // missed (a q needs no space after a command or a number); the rest are
  // files that would hide q from a string-aware counter that trusted its own
  // reading of where a string, comment or image starts.
  const q20 = "q ".repeat(20);
  const cases: Record<string, string[]> = {
    "qqqq: one command per q": ["qqqq\n".repeat(5)],
    "a q glued to a number": ["1q 2q 3q 4q\n"],
    "a q glued to a command": ["1 0 0 1 0 0 cmq 0 0 m q\n"],
    // Each next stream, read from a fresh start, opens a string or a comment
    // that pdf.js (still inside the last stream's comment, string, hex string
    // or image) never sees, and that would hide the q after it.
    "a comment left open across /Contents streams": ["%", `(\n${q20}\n`],
    "a string left open across /Contents streams": ["(", `%) ${q20}\n`],
    "a hex string opened at a stream's last byte": ["<", `(> ${q20}\n`],
    "BI split across streams": [
      "B",
      `I /W 1 /H 1 /BPC 8 /CS /G ID\n(\xffEI ${q20}\n`,
    ],
    "an EI pdf.js rejects, then a string": [
      `BI /W 1 /H 1 /BPC 8 /CS /G ID\nEI \n(\xff\xfe\xfdEI ${q20}\n`,
    ],
    "the byte after EI is skipped (ASCIIHex image)": [
      `BI /W 1 /H 1 /BPC 8 /CS /G /F /AHx ID\n00>EIxq ${q20}\n`,
    ],
    "the byte after EI is skipped, in a second image (read loose)": [
      `BI /W 1 /H 1 /BPC 8 /CS /G ID\n\x00EI\n` +
        `BI /W 1 /H 1 /BPC 8 /CS /G /F /AHx ID\n00>EIxq ${q20}\n`,
    ],
    "ID inside an inline image's array value": [
      `BI /W 1 /H 1 /D [ID] /BPC 8 /CS /G ID\n\x00EI ${q20}(\n`,
    ],
  };
  for (const [name, streams] of Object.entries(cases)) {
    it(name, async () => {
      const bytes = pagePdf(streams);
      const executed = await pdfjsSaves(bytes);
      const scan = await scanPdfStreams(bytes);
      // Health: the case exercises something.
      expect(executed, "pdf.js executes some q").toBeGreaterThan(0);
      expect(scan.maxQReach).toBeGreaterThanOrEqual(executed);
    });
  }

  it("one unclean stream listed twice hands its state to itself", async () => {
    // Fresh, the stream is a comment, then an open string. Read again after
    // itself, its first `)` closes that string and the q run.
    const bytes = rawPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents [4 0 R 4 0 R] >>",
      { dict: "", stream: `%) ${"q ".repeat(20)}\n(` },
    ]);
    const executed = await pdfjsSaves(bytes);
    expect(executed).toBe(20);
    expect((await scanPdfStreams(bytes)).maxQReach).toBeGreaterThanOrEqual(
      executed,
    );
  });

  it("the command table is pdf.js's own (EvaluatorPreprocessor.opMap, read from the shipped worker)", () => {
    const worker = readFileSync(
      createRequire(import.meta.url).resolve(
        "pdfjs-dist/legacy/build/pdf.worker.mjs",
      ),
      "latin1",
    );
    const at = worker.indexOf("static get opMap()");
    expect(
      at,
      "the opMap getter is still where pdf.js keeps it",
    ).toBeGreaterThan(0);
    const body = worker.slice(at, worker.indexOf("}));", at));
    const keys = [
      ...body.matchAll(
        /^ {6}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9*]+)): (?:\{|null)/gm,
      ),
    ].map((m) => m[1] ?? m[2] ?? m[3]!);
    // Health: the extraction found the table, not a fragment of it.
    expect(keys.length).toBeGreaterThan(70);
    expect(keys).toContain("q");
    expect([...PDFJS_CONTENT_COMMANDS].sort()).toEqual([...keys].sort());
  });
});

describe("item 3: a Flate stage behind an ASCII stage is inflated and counted", () => {
  it("a content stream [/ASCIIHexDecode /FlateDecode] inflating to 1 GiB is refused (passed before)", async () => {
    const bytes = oneContentPdf(
      "/Filter [/ASCIIHexDecode /FlateDecode]",
      asciiHex(await deflatedZeros(2 ** 30)),
    );
    expect(bytes.length).toBeGreaterThan(1_500_000); // ~2 MB of hex
    expect((await scanPdfStreams(bytes)).exceeded).toBe("stream-bytes");
  }, 60_000);

  it("the same behind ASCII85 (abbreviated names too)", async () => {
    const bytes = oneContentPdf(
      "/Filter [/A85 /Fl]",
      ascii85(await deflatedZeros(2 ** 30)),
    );
    expect((await scanPdfStreams(bytes)).exceeded).toBe("stream-bytes");
  }, 60_000);

  it("an object stream [/ASCIIHexDecode /FlateDecode] inflating to 1 GiB is refused", async () => {
    const bytes = await objStmBehindFiltersPdf(
      "[/ASCIIHexDecode /FlateDecode]",
      asciiHex,
      2 ** 30,
    );
    expect((await scanPdfStreams(bytes)).exceeded).toBe("stream-bytes");
  }, 60_000);

  it("q behind an ASCII stage is counted: 100,000 unclosed q under [/AHx /Fl] are refused", async () => {
    const bytes = oneContentPdf(
      "/Filter [/AHx /Fl]",
      asciiHex(deflateSync(Buffer.from("q\n".repeat(100_000)))),
    );
    expect((await scanPdfStreams(bytes)).exceeded).toBe("q-depth");
  });

  it("a Flate stage behind one the scan cannot decode (LZW) is refused as unknown size", async () => {
    const bytes = oneContentPdf(
      "/Filter [/LZWDecode /FlateDecode]",
      new Uint8Array(64),
    );
    expect((await scanPdfStreams(bytes)).exceeded).toBe("stream-bytes");
  });

  it("a filter name pdf.js does not know is no filter to pdf.js, so the Flate behind it is inflated", async () => {
    const bytes = oneContentPdf(
      "/Filter [/NoSuchDecode /FlateDecode]",
      await deflatedZeros(2 ** 30),
    );
    expect((await scanPdfStreams(bytes)).exceeded).toBe("stream-bytes");
    // Read as no stage, not as one the scan cannot see through: the content
    // behind it is decoded and its q counted, as pdf.js executes them.
    const deep = oneContentPdf(
      "/Filter [/NoSuchDecode /FlateDecode]",
      deflateSync(Buffer.from("q\n".repeat(100_000))),
    );
    expect(await scanPdfStreams(deep)).toMatchObject({
      exceeded: "q-depth",
      unclosedQ: 100_000,
    });
    const shallow = oneContentPdf(
      "/Filter [/NoSuchDecode /FlateDecode]",
      deflateSync(Buffer.from("q q q 0 0 m\n")),
    );
    expect(await pdfjsSaves(shallow)).toBe(3);
  }, 60_000);

  it("positive control: a small AHx+Flate and A85+Flate page is decoded, counted and passes", async () => {
    const text = "BT /F1 12 Tf 10 10 Td (HELLO) Tj ET\nq Q\n";
    for (const [filters, encode] of [
      ["[/ASCIIHexDecode /FlateDecode]", asciiHex],
      ["[/ASCII85Decode /FlateDecode]", ascii85],
    ] as const) {
      const scan = await scanPdfStreams(
        oneContentPdf(`/Filter ${filters}`, encode(deflateSync(text))),
      );
      expect(scan, filters).toMatchObject({
        exceeded: null,
        maxQDepth: 1,
        maxStreamBytes: text.length,
      });
    }
  });
});
