// The decode budget (lane l01), checked where it is cheap to check in-process.
// The hostile cases themselves (hangs and GiB bombs) run in child processes in
// src/tests/hostile/decode-budget.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
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
import { PdfEngineError } from "./engine-errors";
import { writePdfMetadata } from "./metadata";

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
