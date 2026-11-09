// The decode budget (lane l01), checked where it is cheap to check in-process.
// The hostile cases themselves (hangs and GiB bombs) run in child processes in
// src/tests/hostile/decode-budget.test.ts.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
  PDFContext,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECODE_BUDGET_BYTES,
  PdfDecodeBudgetError,
  asDecodeBudgetRefusal,
  decodeBudgetMessage,
  isDecodeBudgetError,
  withDecodeBudget,
} from "./decode-budget";
import { EMBED_TOTAL_BYTES } from "./embed-budget";
import { PdfEngineError } from "./engine-errors";
import { writePdfMetadata } from "./metadata";
import { DEFAULT_N_UP_OPTIONS, nUpPdf } from "./n-up";

const require = createRequire(import.meta.url);
const MiB = 1024 * 1024;

/** A Flate stream of `n` zero bytes, as pdf-lib holds it after a load. */
async function flateZeros(n: number): Promise<PDFRawStream> {
  const doc = await PDFDocument.create();
  return doc.context.stream(deflateSync(new Uint8Array(n)), {
    Filter: "FlateDecode",
  });
}

describe("the patch is in every pdf-lib build a consumer loads", () => {
  // Derived from pdf-lib's own manifest, not typed: vitest/Node load `main`
  // (cjs), webpack loads `module` (es: no `browser` field, no `exports` map).
  // A build a manifest field points at and the patch missed is a hole; the
  // `dist/` bundles are named by `unpkg` only, which nothing here resolves.
  const pkgPath = require.resolve("pdf-lib/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
    string,
    unknown
  >;
  const root = path.dirname(pkgPath);
  const builds = (["main", "module", "browser"] as const)
    .map((field) => pkg[field])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => path.dirname(path.join(root, entry)));
  const FILES = [
    "core/streams/DecodeStream.js",
    "core/parser/PDFParser.js",
    "core/parser/PDFXRefStreamParser.js",
    "core/streams/decode.js",
    "core/embedders/PDFPageEmbedder.js",
  ];

  it("health: two builds, and no resolution path the guard cannot see", () => {
    expect(builds).toHaveLength(2);
    expect(pkg.exports).toBeUndefined();
    expect(pkg.browser).toBeUndefined();
  });

  it.each(FILES)("%s carries the patch in each build", (file) => {
    for (const build of builds) {
      const text = readFileSync(path.join(build, file), "utf8");
      expect(text, `${build}/${file}`).toContain("pdf.xyz patch");
    }
  });

  it("no code imports a pdf-lib build file directly (dist/ is unpatched)", () => {
    // The guard above covers what the manifest resolves; a deep import such as
    // `pdf-lib/dist/pdf-lib.esm.js` would bypass it, and the budget with it.
    // The set is git's own list of tracked code files, not a typed directory.
    const files = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(?:[cm]?[jt]sx?)$/.test(f));
    const DEEP = new RegExp(
      String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']pdf-lib/(?!package\.json["'])`,
    );
    // Health: the set is the repository, and the pattern sees a deep import.
    expect(files.length).toBeGreaterThan(1000);
    // (Built from pieces, so this file does not match its own pattern.)
    const deepImport = ["import x from ", '"pdf-lib', '/dist/x.js";'].join("");
    expect(DEEP.test(deepImport)).toBe(true);
    expect(DEEP.test(`import { PDFDocument } from "pdf-lib";`)).toBe(false);
    const offenders = files.filter((f) => DEEP.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("each build's default budget is the one our copy states", () => {
    for (const build of builds) {
      const text = readFileSync(
        path.join(build, "core/streams/DecodeStream.js"),
        "utf8",
      );
      const match = text.match(/var DEFAULT_DECODE_BUDGET = (\d+);/);
      expect(match, build).not.toBeNull();
      expect(Number(match![1])).toBe(DEFAULT_DECODE_BUDGET_BYTES);
    }
  });

  it("each build's embed total is the one embed-budget.ts states", () => {
    for (const build of builds) {
      const text = readFileSync(
        path.join(build, "core/embedders/PDFPageEmbedder.js"),
        "utf8",
      );
      const match = text.match(/var DEFAULT_EMBED_TOTAL = (\d+);/);
      expect(match, build).not.toBeNull();
      expect(Number(match![1])).toBe(EMBED_TOTAL_BYTES);
      // The ledger lives on the destination context, not on one page.
      expect(text, build).toMatch(/this\.decodeContents\(Contents, context\)/);
    }
  });
});

describe("decode budget: behaviour", () => {
  it("a scoped budget refuses growth past it with the recognisable error", async () => {
    const stream = await flateZeros(64 * 1024);
    let caught: unknown;
    try {
      withDecodeBudget(16 * 1024, () => decodePDFRawStream(stream).decode());
    } catch (err) {
      caught = err;
    }
    expect(isDecodeBudgetError(caught)).toBe(true);
    // Positive control: the same stream under the default decodes in full.
    expect(decodePDFRawStream(stream).decode()).toHaveLength(64 * 1024);
  });

  it("the scope is put back, also when the decode throws", async () => {
    const stream = await flateZeros(64 * 1024);
    expect(() =>
      withDecodeBudget(1024, () => decodePDFRawStream(stream).decode()),
    ).toThrow();
    expect(decodePDFRawStream(stream).decode()).toHaveLength(64 * 1024);
    const nested = withDecodeBudget(1024, () =>
      withDecodeBudget(128 * 1024, () => decodePDFRawStream(stream).decode()),
    );
    expect(nested).toHaveLength(64 * 1024);
  });

  it("asking for more bytes than a stream has neither throws nor pre-allocates past the budget", async () => {
    const stream = await flateZeros(1000);
    const bytes = decodePDFRawStream(stream).getBytes(1e12);
    expect(bytes).toHaveLength(1000);
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(
      DEFAULT_DECODE_BUDGET_BYTES,
    );
  });

  it("the refusal is typed, and found through a cause chain", () => {
    const raw = Object.assign(new Error("x"), { code: "PDF_DECODE_BUDGET" });
    expect(isDecodeBudgetError(new Error("outer", { cause: raw }))).toBe(true);
    expect(isDecodeBudgetError(new Error("plain"))).toBe(false);
    const typed = asDecodeBudgetRefusal(raw, "Overlay page 3");
    expect(typed).toBeInstanceOf(PdfDecodeBudgetError);
    expect(typed).toBeInstanceOf(PdfEngineError);
    expect(typed!.message).toMatch(/^Overlay page 3 holds/);
    expect(asDecodeBudgetRefusal(new Error("plain"))).toBeUndefined();
  });

  // l01#20 / l01#13: the destination document's ledger (EMBED_TOTAL_BYTES)
  // is a total over every page embedded, and the copy used to blame the one
  // page that happened to cross it, at the per-stream figure ("Overlay page
  // 5 ... more than 256 MB") although that page alone was under budget.
  // The patched error carries the limit that fired; the copy follows it.
  const raw = (limit: number) =>
    Object.assign(new Error("x"), { code: "PDF_DECODE_BUDGET", limit });
  /** The figure a message states, in bytes as the site counts MB (1e6). */
  const statedBytes = (message: string) =>
    Number(/more than ([\d,]+) MB/.exec(message)![1]!.replaceAll(",", "")) *
    1e6;

  it("a destination-total trip names the pages together, at the total", () => {
    const total = asDecodeBudgetRefusal(
      raw(EMBED_TOTAL_BYTES),
      "Overlay page 5",
      "The overlay pages",
    )!;
    expect(total).toBeInstanceOf(PdfDecodeBudgetError);
    expect(total.message).toBe(
      "The overlay pages together unpack to more than 1,024 MB, which is too large to process safely in your browser.",
    );
    // n-up passes no total subject: the default names this PDF's pages.
    expect(asDecodeBudgetRefusal(raw(EMBED_TOTAL_BYTES))!.message).toBe(
      "The pages of this PDF together unpack to more than 1,024 MB, which is too large to process safely in your browser.",
    );
    // Never more than is true: the stated figure is at most the limit.
    expect(statedBytes(total.message)).toBeLessThanOrEqual(EMBED_TOTAL_BYTES);
    // Through a cause chain, as pdf-lib's embed error arrives.
    const wrapped = new Error("embed failed", {
      cause: raw(EMBED_TOTAL_BYTES),
    });
    expect(
      asDecodeBudgetRefusal(wrapped, "x", "The overlay pages")!.message,
    ).toBe(total.message);
  });

  it("a single-stream or single-page trip keeps the per-page wording", () => {
    for (const err of [
      raw(DEFAULT_DECODE_BUDGET_BYTES),
      Object.assign(new Error("x"), { code: "PDF_DECODE_BUDGET" }),
    ]) {
      const one = asDecodeBudgetRefusal(
        err,
        "Overlay page 5",
        "The overlay pages",
      )!;
      expect(one.message).toBe(decodeBudgetMessage("Overlay page 5"));
      expect(one.message).toBe(
        "Overlay page 5 holds compressed data that unpacks to more than 256 MB, which is too large to process safely in your browser.",
      );
      expect(statedBytes(one.message)).toBeLessThanOrEqual(
        DEFAULT_DECODE_BUDGET_BYTES,
      );
    }
  });
});

describe("decode budget: one ledger per operation", () => {
  const LEDGER = Symbol.for("pdf-lib.decodeLedger");

  /** Every ledger a load creates, captured as the parser installs it. */
  async function loadLedgers(files: Uint8Array[]) {
    const seen: { spent: number }[] = [];
    const proto = PDFContext.prototype as unknown as Record<symbol, unknown>;
    Object.defineProperty(proto, LEDGER, {
      configurable: true,
      get: () => undefined,
      set(this: object, value: { spent: number }) {
        seen.push(value);
        Object.defineProperty(this, LEDGER, {
          value,
          configurable: true,
          writable: true,
        });
      },
    });
    const contexts: PDFContext[] = [];
    try {
      for (const bytes of files) {
        contexts.push((await PDFDocument.load(bytes)).context);
      }
    } finally {
      delete proto[LEDGER];
    }
    return { seen, contexts };
  }

  it("the load's ledger ends with the load: later decodes are their own operations", async () => {
    // Two streams of 0.75 MiB each under a 1 MiB budget: each fits alone, the
    // two together do not. Charged to a ledger left behind by the load, the
    // second would be refused, and so would extract-images on any real file
    // whose images add up past the budget.
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const a = doc.context.register(await flateZeros(0.75 * MiB));
    const b = doc.context.register(await flateZeros(0.75 * MiB));
    const loaded = await PDFDocument.load(await doc.save());
    for (const ref of [a, b]) {
      const stream = loaded.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw new Error("not a stream");
      const bytes = withDecodeBudget(MiB, () =>
        decodePDFRawStream(stream).decode(),
      );
      expect(bytes).toHaveLength(0.75 * MiB);
    }
    const { contexts } = await loadLedgers([await doc.save()]);
    expect(Object.getOwnPropertySymbols(contexts[0]!)).not.toContain(LEDGER);
  });

  it("a load's ledger counts every stream it inflates, across object streams", async () => {
    // Positive control for the hostile STAMP-12 case, in-process: the same
    // ledger object sees both object streams of one load.
    const doc = await PDFDocument.create();
    for (let i = 0; i < 40; i += 1) doc.addPage([100, 100]);
    const { seen } = await loadLedgers([
      await doc.save({ useObjectStreams: true, objectsPerTick: Infinity }),
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.spent).toBeGreaterThan(1000);
  });

  it("real producers' loads spend far under the budget (the legit corpus)", async () => {
    // Second, independent bound on the per-load total: what loading each
    // legit-corpus file actually inflates (object streams, xref streams).
    const dir = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
    const names = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
    expect(names.length).toBeGreaterThanOrEqual(14);
    const { seen } = await loadLedgers(
      names.map((f) => new Uint8Array(readFileSync(path.join(dir, f)))),
    );
    // Health: one ledger per load, and the object-stream files charged it.
    expect(seen).toHaveLength(names.length);
    const largest = Math.max(...seen.map((l) => l.spent));
    expect(largest).toBeGreaterThan(1000);
    expect(DEFAULT_DECODE_BUDGET_BYTES).toBeGreaterThanOrEqual(1000 * largest);
  });
});

describe("decode budget: the number", () => {
  it("the copy's figure is true of every refused file", () => {
    // "more than N MB": anything refused decoded past the budget in bytes,
    // so the decimal N MB must not exceed it.
    const stated = Number(
      decodeBudgetMessage().match(/more than (\d+) MB/)![1],
    );
    expect(stated * 1_000_000).toBeLessThanOrEqual(DEFAULT_DECODE_BUDGET_BYTES);
    expect(stated).toBe(DEFAULT_DECODE_BUDGET_BYTES / MiB);
  });

  it("sits far above every stream real producers wrote, and well under the bombs", async () => {
    // Second, independent bounds on a constant that has no relationships of
    // its own: the legit corpus from below, the smallest hostile bomb (1 GiB)
    // from above.
    const dir = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
    const files = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
    expect(files.length).toBeGreaterThanOrEqual(14);
    let largest = 0;
    let streams = 0;
    for (const file of files) {
      const doc = await PDFDocument.load(readFileSync(path.join(dir, file)));
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        try {
          largest = Math.max(largest, decodePDFRawStream(obj).decode().length);
          streams += 1;
        } catch {
          // DCT and other image codecs pdf-lib does not decode.
        }
      }
    }
    // Health: the walk saw real streams, and real sizes.
    expect(streams).toBeGreaterThan(100);
    expect(largest).toBeGreaterThan(10_000);
    expect(DEFAULT_DECODE_BUDGET_BYTES).toBeGreaterThanOrEqual(100 * largest);
    expect(DEFAULT_DECODE_BUDGET_BYTES * 4).toBeLessThanOrEqual(1024 * MiB);
  });
});

describe("embed total: one ledger per destination document", () => {
  const EMBED_LEDGER = Symbol.for("pdf-lib.embedLedger");

  /** A source document of `pages` pages, each with its own content stream. */
  async function sourceOf(pages: number, bytesEach: number) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) {
      const page = doc.addPage([100, 100]);
      const content = doc.context.register(
        doc.context.stream(deflateSync(new Uint8Array(bytesEach).fill(32)), {
          Filter: "FlateDecode",
        }),
      );
      page.node.set(PDFName.of("Contents"), content);
    }
    return PDFDocument.load(await doc.save());
  }

  it("charges every page embedded into one destination to one total", async () => {
    // Three pages of 0.4 MiB each, under a 1 MiB total seeded on the
    // destination: two fit, the third is refused. A ledger per page would
    // embed all three.
    const source = await sourceOf(3, 0.4 * MiB);
    const dest = await PDFDocument.create();
    (dest.context as unknown as Record<symbol, unknown>)[EMBED_LEDGER] = {
      spent: 0,
      limit: MiB,
    };
    const embedded = await dest.embedPages(source.getPages());
    await embedded[0]!.embed();
    await embedded[1]!.embed();
    let caught: unknown;
    try {
      await embedded[2]!.embed();
    } catch (err) {
      caught = err;
    }
    expect(isDecodeBudgetError(caught)).toBe(true);
    // Positive control: each page into its own destination fits alone.
    for (const page of source.getPages()) {
      const own = await PDFDocument.create();
      (own.context as unknown as Record<symbol, unknown>)[EMBED_LEDGER] = {
        spent: 0,
        limit: MiB,
      };
      const [one] = await own.embedPages([page]);
      await one!.embed();
    }
  });

  it("a destination with no seeded ledger gets the embed total", async () => {
    const source = await sourceOf(1, 1000);
    const dest = await PDFDocument.create();
    const [one] = await dest.embedPages(source.getPages());
    await one!.embed();
    const ledger = (dest.context as unknown as Record<symbol, unknown>)[
      EMBED_LEDGER
    ] as { spent: number; limit: number };
    expect(ledger.limit).toBe(EMBED_TOTAL_BYTES);
    expect(ledger.spent).toBeGreaterThanOrEqual(1000);
  });

  it("sits far above the page content real producers wrote, and n-up keeps every legit file", async () => {
    // Second, independent bound on the total: the decoded page content of
    // each legit-corpus file, summed over its pages, and n-up run on it.
    const dir = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
    const files = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
    expect(files.length).toBeGreaterThanOrEqual(14);
    let largest = 0;
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
      const doc = await PDFDocument.load(bytes);
      let total = 0;
      for (const page of doc.getPages()) {
        const contents = page.node.normalizedEntries().Contents;
        for (let i = 0; i < (contents?.size() ?? 0); i += 1) {
          const stream = contents!.lookup(i);
          if (stream instanceof PDFRawStream) {
            total += decodePDFRawStream(stream).decode().length;
          }
        }
      }
      largest = Math.max(largest, total);
      const r = await nUpPdf(bytes, { ...DEFAULT_N_UP_OPTIONS, perSheet: 4 });
      expect(r.sheets, file).toBeGreaterThan(0);
    }
    // Health: the walk saw real content.
    expect(largest).toBeGreaterThan(10_000);
    expect(EMBED_TOTAL_BYTES).toBeGreaterThanOrEqual(100 * largest);
    expect(EMBED_TOTAL_BYTES).toBeGreaterThan(DEFAULT_DECODE_BUDGET_BYTES);
  }, 60_000);
});

describe("EDIT-11: the XMP cap keeps real packets", () => {
  it("EDIT-11: a 4 MiB packet (padding and history) still carries its PDF/A identification", async () => {
    const packet = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
</rdf:RDF></x:xmpmeta>
${" ".repeat(4 * MiB)}
<?xpacket end="w"?>`;
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const stream = doc.context.stream(
      deflateSync(new TextEncoder().encode(packet)),
      { Type: "Metadata", Subtype: "XML", Filter: "FlateDecode" },
    );
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
    const source = await doc.save({ useObjectStreams: false });
    const result = await writePdfMetadata(source, {
      kind: "edit",
      values: {
        title: "New",
        author: "",
        subject: "",
        keywords: "",
        creator: "",
        producer: "",
        creationDate: null,
        modificationDate: null,
      },
    });
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    const xmp = out.catalog.lookup(PDFName.of("Metadata"));
    if (!(xmp instanceof PDFRawStream)) throw new Error("no XMP stream");
    const text = new TextDecoder().decode(decodePDFRawStream(xmp).decode());
    expect(text).toMatch(/pdfaid:part[^0-9]{1,3}2/);
  });
});
