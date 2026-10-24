// @native-canvas
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { drawRasterImage, embedRasterImage } from "../pdf-lib";
import { embedDrawingFont } from "../unicode-font";
import { exportEditedPdf, readExportFrames } from "../editor-export";
import type { EditorObject } from "./model";
import { openRunStyles } from "./run-styles";
import {
  findMatches,
  placeRuns,
  replaceAt,
  textEditFromRun,
  type PdfjsTextItem,
  type TextRun,
} from "./runs";

/**
 * Edit text and Redact, proved on the SAVED FILE as a reader receives it:
 * pdf.js re-extracts the text (old words absent, new words present, where
 * the run was), the decoded content stream shows the operators nobody
 * touched are still the very bytes they were, and a redacted image's pixels
 * are read back out of the image stream.
 *
 * Runs are found the way the editor finds them — pdf.js's own text items,
 * placed by `placeRuns`, styled by `openRunStyles` — so the chain under test
 * is the one a click in the browser walks.
 */

const TOL = 1;

async function pdfjsItems(
  bytes: Uint8Array,
  pageIndex = 0,
): Promise<PdfjsTextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(join(process.cwd(), "package.json"));
  const dir = dirname(require.resolve("pdfjs-dist/package.json"))
    .split("\\")
    .join("/");
  const task = pdfjs.getDocument({
    ...PDFJS_DOCUMENT_DEFAULTS,
    wasmUrl: `${dir}/wasm/`,
    cMapUrl: `${dir}/cmaps/`,
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
  });
  try {
    const doc = await awaitPdfjsDocument(task);
    const page = await doc.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const out: PdfjsTextItem[] = [];
    for (const i of content.items) {
      if (!("str" in i)) continue;
      out.push({
        str: i.str,
        transform: i.transform as number[],
        width: i.width,
      });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

async function runsOf(bytes: Uint8Array, pageIndex = 0): Promise<TextRun[]> {
  const frames = await readExportFrames(bytes);
  return placeRuns(
    pageIndex,
    await pdfjsItems(bytes, pageIndex),
    frames[pageIndex]!,
  );
}

async function editOf(
  bytes: Uint8Array,
  match: string,
  text: string,
  pageIndex = 0,
): Promise<EditorObject> {
  const runs = await runsOf(bytes, pageIndex);
  const run = runs.find((r) => r.str.includes(match));
  if (!run)
    throw new Error(
      `no run "${match}" in ${runs.map((r) => r.str).join(" | ")}`,
    );
  const styles = await openRunStyles(bytes);
  return textEditFromRun(`e-${match}`, run, styles.style(pageIndex, run), text);
}

/** The page's content, decoded and joined, as a string. */
async function contentOf(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const raw = page.node.get(PDFName.of("Contents"));
  const contents = doc.context.lookup(raw);
  const refs = contents instanceof PDFArray ? contents.asArray() : [raw];
  return refs
    .map((r) => {
      const s = doc.context.lookup(r);
      if (!(s instanceof PDFRawStream)) return "";
      return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
    })
    .join("\n");
}

async function helvetica(opts: { rotate?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello World", { x: 72, y: 700, size: 12, font });
  page.drawText("Keep this line", { x: 72, y: 650, size: 12, font });
  page.drawText("Total due 120", {
    x: 72,
    y: 600,
    size: 14,
    font,
    color: rgb(0.8, 0, 0),
  });
  if (opts.rotate) page.setRotation(degrees(opts.rotate));
  return doc.save();
}

/** A page whose content stream is written by hand (TJ arrays, two runs in one operator). */
async function rawPage(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const key = page.node.newFontDictionary("F1", font.ref);
  const stream = doc.context.stream(content.replaceAll("/F1", key.toString()));
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save();
}

const textsOf = async (bytes: Uint8Array, pageIndex = 1) =>
  (await readAsViewer(bytes, pageIndex)).texts;
const joined = async (bytes: Uint8Array, pageIndex = 1) =>
  (await textsOf(bytes, pageIndex)).map((t) => t.str).join(" ");

describe("Edit text removes the original glyphs from the content stream", () => {
  it("Helvetica: old words gone, new words at the run's baseline, other runs byte-identical", async () => {
    const base = await helvetica();
    const before = await contentOf(base);
    const keep = /<4B6565702074686973206C696E65> Tj/i.exec(before)?.[0];
    expect(keep, "positive control: the untouched run's operator").toBeTruthy();

    const out = await exportEditedPdf(base, [
      await editOf(base, "Hello", "Goodbye World"),
    ]);
    const texts = await textsOf(out.bytes);
    const all = texts.map((t) => t.str).join(" ");
    expect(all).not.toContain("Hello");
    expect(all).toContain("Keep this line");
    const placed = texts.find((t) => t.str.includes("Goodbye World"));
    expect(placed).toBeDefined();
    expect(Math.abs(placed!.x - 72)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(placed!.y - 700)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(placed!.size - 12)).toBeLessThanOrEqual(0.01);

    const after = await contentOf(out.bytes);
    expect(after).toContain(keep!);
    // The other untouched run too, with its colour operator.
    expect(after).toContain("<546F74616C2064756520313230> Tj");
    // The removed run's operator is gone, not merely covered.
    expect(after).not.toMatch(/<48656C6C6F20576F726C64> Tj/i);
  });

  it("control: the same reading SEES text that is only covered (Whiteout)", async () => {
    // If removal were skipped and the run merely painted over, this is what
    // the extraction would report: the old words, still in the file.
    const base = await helvetica();
    const runs = await runsOf(base);
    const run = runs.find((r) => r.str.includes("Hello"))!;
    const out = await exportEditedPdf(base, [
      { id: "w", kind: "whiteout", page: 0, ...run.rect },
    ]);
    expect(await joined(out.bytes)).toContain("Hello World");
  });

  it("reuses the run's own font when it has every glyph, and substitutes when not", async () => {
    const base = await helvetica();
    // Helvetica (not embedded, WinAnsi) can write any Latin text.
    const own = await editOf(base, "Hello", "Hello there");
    expect(own.kind === "textedit" && own.ownChars.includes("t")).toBe(true);
    const out = await exportEditedPdf(base, [own]);
    const all = await joined(out.bytes);
    expect(all).toContain("Hello there");
    expect(all).not.toContain("Hello World");
    const doc = await PDFDocument.load(out.bytes);
    const fonts = doc
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("Font"), PDFDict);
    // Same font object under a second key, no new font embedded.
    const refs = new Set(fonts.entries().map(([, v]) => v.toString()));
    expect(refs.size).toBe(1);
  });

  it("Bengali replacement text is drawn in the Noto face and extracts", async () => {
    const base = await helvetica();
    const edit = await editOf(base, "Hello", "আমার সোনার");
    const out = await exportEditedPdf(base, [edit]);
    const all = await joined(out.bytes);
    expect(all).not.toContain("Hello");
    for (const ch of ["আ", "ম", "স", "ন"]) expect(all).toContain(ch);
  });

  it("a TJ array run: removed, its replacement drawn", async () => {
    const base = await rawPage(
      "BT /F1 12 Tf 72 600 Td [(Ke) 20 (rned) -250 (Words)] TJ ET\nBT /F1 12 Tf 72 560 Td (Other line) Tj ET",
    );
    const items = (await runsOf(base)).map((r) => r.str);
    expect(items.join("|")).toContain("Kerned");
    const out = await exportEditedPdf(base, [
      await editOf(base, "Kerned", "Changed"),
    ]);
    const all = await joined(out.bytes);
    expect(all).not.toContain("Kerned");
    expect(all).not.toContain("Words");
    expect(all).toContain("Changed");
    expect(await contentOf(out.bytes)).toContain("(Other line) Tj");
  });

  it("two runs in one operator: only the edited run's glyphs go, the other stays put", async () => {
    // One TJ paints two runs pdf.js reports apart (a wide gap between them).
    const base = await rawPage(
      "BT /F1 12 Tf 72 500 Td [(Alpha) -12000 (Beta)] TJ ET",
    );
    const runs = await runsOf(base);
    const beta = runs.find((r) => r.str.includes("Beta"));
    const alpha = runs.find((r) => r.str.includes("Alpha"));
    expect(
      beta && alpha && beta !== alpha,
      runs.map((r) => r.str).join("|"),
    ).toBe(true);
    const betaX = (await textsOf(base)).find((t) => t.str.includes("Beta"))!.x;

    const out = await exportEditedPdf(base, [
      await editOf(base, "Alpha", "Omega"),
    ]);
    const texts = await textsOf(out.bytes);
    const all = texts.map((t) => t.str).join(" ");
    expect(all).not.toContain("Alpha");
    expect(all).toContain("Omega");
    const after = texts.find((t) => t.str.includes("Beta"));
    expect(after, all).toBeDefined();
    // Beta did not move: the removed glyphs' advance was kept as a TJ number.
    expect(Math.abs(after!.x - betaX)).toBeLessThanOrEqual(0.05);
  });

  it("a rotated page: the replacement lands where the run was, as the viewer shows it", async () => {
    const base = await helvetica({ rotate: 90 });
    const before = (await textsOf(base)).find((t) => t.str.includes("Hello"))!;
    const out = await exportEditedPdf(base, [
      await editOf(base, "Hello", "Rotated edit"),
    ]);
    const texts = await textsOf(out.bytes);
    expect(texts.map((t) => t.str).join(" ")).not.toContain("Hello");
    const placed = texts.find((t) => t.str.includes("Rotated edit"))!;
    expect(Math.abs(placed.x - before.x)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(placed.y - before.y)).toBeLessThanOrEqual(TOL);
  });

  it("an empty replacement deletes the run", async () => {
    const base = await helvetica();
    const out = await exportEditedPdf(base, [await editOf(base, "Total", "")]);
    const all = await joined(out.bytes);
    expect(all).not.toContain("Total");
    expect(all).toContain("Hello World");
  });

  it("the old content stream is not left in the file as an orphan", async () => {
    const base = await helvetica();
    const out = await exportEditedPdf(base, [
      await editOf(base, "Hello", "Changed"),
    ]);
    const doc = await PDFDocument.load(out.bytes);
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const text = Buffer.from(decodePDFRawStream(obj).decode()).toString(
        "latin1",
      );
      expect(text).not.toMatch(/48656C6C6F20576F726C64/i);
    }
  });
});

describe("fonts: the run's own font when it has the glyphs, a named substitute when not", () => {
  /** A line drawn in an EMBEDDED SUBSET (Noto, via the site's own chooser). */
  async function subsetPage(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    // "ő" is outside WinAnsi, so the chooser embeds a Noto subset.
    const words = "Hello Wörld ő";
    const font = await embedDrawingFont(doc, [words], "sans");
    page.drawText(words, { x: 72, y: 700, size: 14, font });
    return doc.save();
  }

  it("a subset that has every letter typed: drawn in the run's own font", async () => {
    const base = await subsetPage();
    const edit = await editOf(base, "Hello", "Wörld Hello");
    expect(edit.kind === "textedit" && edit.ownChars.length).toBeGreaterThan(0);
    const out = await exportEditedPdf(base, [edit]);
    expect(out.retext.map((r) => r.font)).toEqual(["own"]);
    const all = await joined(out.bytes);
    expect(all).toContain("Wörld Hello");
    expect(all).not.toContain("Hello Wörld");
  });

  it("a subset missing a letter typed: substituted, and the export names the face", async () => {
    const base = await subsetPage();
    // "p" and "z" were never drawn, so the subset has no glyph for them.
    const out = await exportEditedPdf(base, [
      await editOf(base, "Hello", "Puzzle"),
    ]);
    expect(out.retext.map((r) => r.font)).toEqual(["Helvetica"]);
    const all = await joined(out.bytes);
    expect(all).toContain("Puzzle");
    expect(all).not.toContain("Hello");
  });
});

describe("text inside a Form XObject (one level)", () => {
  async function formPage(): Promise<Uint8Array> {
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    src
      .addPage([612, 792])
      .drawText("Inside the form", { x: 72, y: 700, size: 12, font });
    const doc = await PDFDocument.create();
    const [embedded] = await doc.embedPdf(await src.save());
    doc.addPage([612, 792]).drawPage(embedded!);
    return doc.save();
  }

  it("is edited: old words gone, new words drawn", async () => {
    const base = await formPage();
    const out = await exportEditedPdf(base, [
      await editOf(base, "Inside", "Rewritten line"),
    ]);
    const all = await joined(out.bytes);
    expect(all).not.toContain("Inside the form");
    expect(all).toContain("Rewritten line");
  });

  it("is redacted", async () => {
    const base = await formPage();
    const run = (await runsOf(base)).find((r) => r.str.includes("Inside"))!;
    const out = await exportEditedPdf(base, [
      { id: "r", kind: "redact", page: 0, ...run.rect, fill: "white" },
    ]);
    expect(await joined(out.bytes)).not.toContain("Inside");
  });
});

describe("what Edit text refuses", () => {
  it("an invisible OCR layer is not offered, and says why", async () => {
    const base = await rawPage(
      "BT 3 Tr /F1 12 Tf 72 600 Td (Scanned words) Tj ET",
    );
    const run = (await runsOf(base)).find((r) => r.str.includes("Scanned"))!;
    const style = (await openRunStyles(base)).style(0, run);
    expect(style.invisible).toBe(true);
    expect(style.refusal).toMatch(/invisible layer/);
  });

  it("control: the same line painted visibly is offered", async () => {
    const base = await rawPage("BT /F1 12 Tf 72 600 Td (Scanned words) Tj ET");
    const run = (await runsOf(base)).find((r) => r.str.includes("Scanned"))!;
    const style = (await openRunStyles(base)).style(0, run);
    expect(style.invisible).toBe(false);
    expect(style.refusal).toBeNull();
  });
});

describe("Find & replace", () => {
  it("counts and replaces matches, with and without match case", () => {
    const runs = [
      { key: "a", page: 0, text: "Invoice total: total" },
      { key: "b", page: 1, text: "TOTAL due" },
    ];
    expect(findMatches(runs, "total", false)).toHaveLength(3);
    expect(findMatches(runs, "total", true)).toHaveLength(2);
    expect(findMatches(runs, "", false)).toHaveLength(0);
    expect(replaceAt("Invoice total: total", [8, 15], 5, "sum")).toBe(
      "Invoice sum: sum",
    );
  });

  it("replace all, exported: every occurrence gone from the file", async () => {
    const base = await helvetica();
    const runs = await runsOf(base);
    const styles = await openRunStyles(base);
    const matches = findMatches(
      runs.map((r) => ({ key: r.key, page: r.page, text: r.str })),
      "l",
      true,
    );
    expect(matches.length).toBe(5); // Hello(2) World(1) line(1) Total(1)
    const byRun = new Map<string, number[]>();
    for (const m of matches)
      byRun.set(m.run, [...(byRun.get(m.run) ?? []), m.start]);
    const edits = [...byRun].map(([key, starts]) => {
      const run = runs.find((r) => r.key === key)!;
      return textEditFromRun(
        key,
        run,
        styles.style(0, run),
        replaceAt(run.str, starts, 1, "L"),
      );
    });
    const out = await exportEditedPdf(base, edits);
    const all = await joined(out.bytes);
    expect(all).not.toContain("Hello");
    expect(all).not.toContain("Total due");
    expect(all).toContain("HeLLo WorLd");
    expect(all).toContain("Keep this Line");
    expect(all).toContain("TotaL due 120");
  });
});

describe("Redact removes what is under the box", () => {
  async function withImage(): Promise<{ bytes: Uint8Array }> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Secret account 4242", { x: 72, y: 700, size: 12, font });
    page.drawText("Public line", { x: 72, y: 650, size: 12, font });
    // A 20 x 20 red PNG, drawn 100 pt square at (300, 300).
    const png = await solidPng(20, 20, [255, 0, 0]);
    const img = await embedRasterImage(doc, png, "png");
    await drawRasterImage(page, img, {
      x: 300,
      y: 300,
      width: 100,
      height: 100,
    });
    return { bytes: await doc.save() };
  }

  it("text under the box is gone from extraction; text beside it is kept", async () => {
    const { bytes } = await withImage();
    const runs = await runsOf(bytes);
    const secret = runs.find((r) => r.str.includes("Secret"))!;
    const out = await exportEditedPdf(bytes, [
      { id: "r", kind: "redact", page: 0, ...secret.rect, fill: "black" },
    ]);
    const all = await joined(out.bytes);
    expect(all).not.toContain("Secret");
    expect(all).not.toContain("4242");
    expect(all).toContain("Public line");
  });

  it("a box over PART of a run removes only the glyphs it covers", async () => {
    const { bytes } = await withImage();
    const runs = await runsOf(bytes);
    const secret = runs.find((r) => r.str.includes("Secret"))!;
    // Cover the right ~third ("4242").
    const third = secret.rect.width / 3;
    const out = await exportEditedPdf(bytes, [
      {
        id: "r",
        kind: "redact",
        page: 0,
        x: secret.rect.x + secret.rect.width - third + 2,
        y: secret.rect.y,
        width: third,
        height: secret.rect.height,
        fill: "black",
      },
    ]);
    const all = await joined(out.bytes);
    expect(all).toContain("Secret");
    expect(all).not.toContain("4242");
  });

  it("an image's covered pixels are changed and its uncovered pixels are not", async () => {
    const { bytes } = await withImage();
    // Box over the image's left half: content x 300..350, y 300..400.
    const frames = await readExportFrames(bytes);
    const h = frames[0]!.height;
    const out = await exportEditedPdf(bytes, [
      {
        id: "r",
        kind: "redact",
        page: 0,
        x: 300,
        y: h - 400,
        width: 50,
        height: 100,
        fill: "black",
      },
    ]);
    const doc = await PDFDocument.load(out.bytes);
    const xo = doc
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("XObject"), PDFDict);
    const images = xo
      .entries()
      .map(([k, v]) => [k.decodeText(), doc.context.lookup(v)] as const)
      .filter(([, v]) => v instanceof PDFStream);
    const redacted = images.find(([k]) => k.startsWith("Redacted"));
    expect(redacted, images.map(([k]) => k).join(",")).toBeDefined();
    const stream = redacted![1] as PDFRawStream;
    const px = inflateSync(Buffer.from(stream.getContents()));
    const at = (x: number, y: number) =>
      Array.from(px.subarray((y * 20 + x) * 3, (y * 20 + x) * 3 + 3));
    expect(at(2, 10)).toEqual([0, 0, 0]); // covered
    expect(at(17, 10)).toEqual([255, 0, 0]); // not covered
    // And the original red image is not left in the file.
    let reds = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const sub = obj.dict.get(PDFName.of("Subtype"));
      if (sub?.toString() !== "/Image") continue;
      const data = inflateSync(Buffer.from(obj.getContents()));
      if (data.length === 1200 && data[6] === 255 && data[7] === 0) reds++;
    }
    expect(reds).toBe(0);
  });
});

/** A solid-colour RGB PNG, built by hand (no image library). */
async function solidPng(
  w: number,
  h: number,
  [r, g, b]: number[],
): Promise<Uint8Array> {
  const { deflateSync } = await import("node:zlib");
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r!;
      raw[o + 1] = g!;
      raw[o + 2] = b!;
    }
  }
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
