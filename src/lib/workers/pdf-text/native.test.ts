// @vitest-environment node
/**
 * The native `pdftotext` seam: argv construction, the presence-only probe, temp-dir
 * cleanup, and — most importantly — that an extractor is injected ONLY when the
 * binary really exists, so `capability().ready` cannot claim a tool this worker
 * can't run.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createNativePdfLayoutExtractor,
  createNativePdfTextExtractor,
  nativePdfOfficeExportDeps,
  nativeTableExtractDeps,
  pdfTextArgs,
  probePdfTextFromConfig,
  resolveNativePdfTextExtractor,
  type PdfTextExec,
  type PdfTextFs,
  type PdfTextSeams,
} from "./native";
import { resolveNativePdfTextConfig } from "./native-config";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function fakeFs(dir = join("tmp", "pdfxyz-pdftext-x")): PdfTextFs & {
  removed: string[];
  written: string[];
} {
  const removed: string[] = [];
  const written: string[] = [];
  return {
    removed,
    written,
    mkdtemp: async () => dir,
    writeFile: async (file) => {
      written.push(file);
    },
    rm: async (target) => {
      removed.push(target);
    },
  };
}

function seams(stdout: string, over: Partial<PdfTextSeams> = {}): PdfTextSeams {
  return {
    resolveOnPath: () => true,
    fileExists: () => true,
    exec: async () => stdout,
    fs: fakeFs(),
    ...over,
  };
}

describe("pdfTextArgs", () => {
  it("asks for column-preserving plain text and writes to stdout", () => {
    const input = join("tmp", "d", "input.pdf");
    expect(pdfTextArgs("layout", input)).toEqual([
      "-layout",
      "-q",
      "--",
      input,
      "-",
    ]);
  });

  it("asks for per-word bounding boxes in bbox mode", () => {
    const input = join("tmp", "d", "input.pdf");
    expect(pdfTextArgs("bbox", input)).toEqual([
      "-bbox-layout",
      "-q",
      "--",
      input,
      "-",
    ]);
  });

  it("ends option parsing before the path, so a path can never read as a flag", () => {
    const args = pdfTextArgs("layout", join("tmp", "-oops.pdf"));
    expect(args.indexOf("--")).toBeLessThan(
      args.indexOf(join("tmp", "-oops.pdf")),
    );
  });
});

describe("probePdfTextFromConfig", () => {
  const config = resolveNativePdfTextConfig({});

  it("returns the binary when it is on PATH", () => {
    expect(probePdfTextFromConfig(config, { resolveOnPath: () => true })).toBe(
      "pdftotext",
    );
  });

  it("returns null when it is not installed", () => {
    expect(
      probePdfTextFromConfig(config, { resolveOnPath: () => false }),
    ).toBeNull();
  });

  it("returns null when the kill switch is off, even with the binary present", () => {
    const disabled = resolveNativePdfTextConfig({ PDFXYZ_PDF_TEXT: "off" });
    expect(
      probePdfTextFromConfig(disabled, { resolveOnPath: () => true }),
    ).toBeNull();
  });

  it("probes an absolute override by existence rather than PATH", () => {
    const overridden = resolveNativePdfTextConfig({
      PDFXYZ_PDF_TEXT_BIN: "/opt/poppler/bin/pdftotext",
    });
    expect(
      probePdfTextFromConfig(overridden, {
        resolveOnPath: () => false,
        fileExists: () => true,
      }),
    ).toBe("/opt/poppler/bin/pdftotext");
  });
});

describe("extractors", () => {
  const config = resolveNativePdfTextConfig({});

  it("parses plain-text output into pages", async () => {
    const extract = createNativePdfTextExtractor(
      "pdftotext",
      config,
      "keep",
      seams("page one\fpage two\f"),
    );
    const out = await extract(PDF);
    expect(out.pageCount).toBe(2);
    expect(out.hasText).toBe(true);
  });

  it("collapses -layout padding for the AI path and keeps it for export", async () => {
    // The two consumers need opposite things and both failures are silent: an
    // AI engine fed padding counts alignment spaces against its ceiling, and an
    // office export fed collapsed text loses the 2+ spaces it splits rows on.
    const row = "North   1200  1350";
    const collapsing = createNativePdfTextExtractor(
      "pdftotext",
      config,
      "collapse",
      seams(row),
    );
    const keeping = createNativePdfTextExtractor(
      "pdftotext",
      config,
      "keep",
      seams(row),
    );

    expect((await collapsing(PDF)).text).toBe("North 1200 1350");
    expect((await keeping(PDF)).text).toBe(row);
  });

  it("collapsing keeps the ROW, which is what -layout is carrying", async () => {
    // Not merely "fewer characters". `-layout` is the only mode that
    // reconstructs visual reading order: on the production binary (poppler
    // 22.12.0) the default mode flattens a table to one cell per line with no
    // row boundaries, and `-raw` emits content-stream order, which generators
    // write out of visual order. Cells must stay on their row and stay
    // separated. Full measurement at `collapseLayoutPadding`.
    const table = "Region  Q1    Q2\nNorth   1200  1350";
    const extract = createNativePdfTextExtractor(
      "pdftotext",
      config,
      "collapse",
      seams(table),
    );
    expect((await extract(PDF)).text).toBe("Region Q1 Q2\nNorth 1200 1350");
  });

  it("parses bbox output into positioned items", async () => {
    const extractLayout = createNativePdfLayoutExtractor(
      "pdftotext",
      config,
      seams(
        `<page width="595" height="842"><word xMin="60" yMin="94" xMax="97" yMax="104">Region</word></page>`,
      ),
    );
    const layout = await extractLayout(PDF);
    expect(layout.pages[0]!.items[0]).toMatchObject({ text: "Region", x: 60 });
  });

  it("writes the input under a fixed name inside the temp dir", async () => {
    const fs = fakeFs(join("tmp", "run"));
    const extract = createNativePdfTextExtractor(
      "pdftotext",
      config,
      "keep",
      seams("x", { fs }),
    );
    await extract(PDF);
    expect(fs.written).toEqual([join("tmp", "run", "input.pdf")]);
  });

  it("removes the temp dir after a successful run", async () => {
    const fs = fakeFs(join("tmp", "run"));
    const extract = createNativePdfTextExtractor(
      "pdftotext",
      config,
      "keep",
      seams("x", { fs }),
    );
    await extract(PDF);
    expect(fs.removed).toEqual([join("tmp", "run")]);
  });

  it("removes the temp dir even when the binary fails", async () => {
    const fs = fakeFs(join("tmp", "run"));
    const extract = createNativePdfTextExtractor("pdftotext", config, "keep", {
      ...seams("", { fs }),
      exec: async () => {
        throw new Error("pdftotext failed.");
      },
    });
    await expect(extract(PDF)).rejects.toThrow();
    expect(fs.removed).toEqual([join("tmp", "run")]);
  });

  it("rejects an oversized input before spawning anything", async () => {
    let spawned = false;
    const exec: PdfTextExec = async () => {
      spawned = true;
      return "";
    };
    const tiny = resolveNativePdfTextConfig({
      PDFXYZ_PDF_TEXT_MAX_INPUT_BYTES: "2",
    });
    const extract = createNativePdfTextExtractor(
      "pdftotext",
      tiny,
      "keep",
      seams("", { exec }),
    );
    await expect(extract(PDF)).rejects.toThrow(/maximum size/i);
    expect(spawned).toBe(false);
  });

  it("bounds stdout and runtime by the configured ceilings", async () => {
    let options: Parameters<PdfTextExec>[2] | undefined;
    const exec: PdfTextExec = async (_command, _args, opts) => {
      options = opts;
      return "x";
    };
    const bounded = resolveNativePdfTextConfig({
      PDFXYZ_PDF_TEXT_MAX_OUTPUT_BYTES: "8",
      PDFXYZ_PDF_TEXT_TIMEOUT_MS: "1234",
    });
    await createNativePdfTextExtractor(
      "pdftotext",
      bounded,
      "keep",
      seams("", { exec }),
    )(PDF);
    expect(options).toMatchObject({ maxBuffer: 8, timeout: 1234 });
  });
});

describe("deps wiring — readiness must reflect the host, not the wiring", () => {
  it("injects extract only when pdftotext is present", () => {
    expect(
      nativePdfOfficeExportDeps({}, { resolveOnPath: () => true }).extract,
    ).toBeTypeOf("function");
    expect(
      nativePdfOfficeExportDeps({}, { resolveOnPath: () => false }).extract,
    ).toBeUndefined();
  });

  it("injects extractLayout only when pdftotext is present", () => {
    expect(
      nativeTableExtractDeps({}, { resolveOnPath: () => true }).extractLayout,
    ).toBeTypeOf("function");
    expect(
      nativeTableExtractDeps({}, { resolveOnPath: () => false }).extractLayout,
    ).toBeUndefined();
  });

  it("still reports size limits when the binary is missing", () => {
    const deps = nativeTableExtractDeps({}, { resolveOnPath: () => false });
    expect(deps.limits?.maxInputBytes).toBeGreaterThan(0);
  });

  it("gives the AI engines collapsed padding and office export the raw spacing", async () => {
    // THE RELATIONSHIP, not the argument. Both builders call the same factory
    // and the padding choice is now the only thing separating them; a swap is
    // silent in both directions — AI ceilings would count alignment spaces
    // again, and office export would lose the 2+ spaces it splits rows on.
    const row = "North   1200  1350";
    const wired = { resolveOnPath: () => true, ...seams(row) };

    const ai = resolveNativePdfTextExtractor({}, wired);
    const office = nativePdfOfficeExportDeps({}, wired).extract;
    expect(
      ai,
      "pdftotext probed present but no AI extractor was built",
    ).toBeTypeOf("function");
    expect(office).toBeTypeOf("function");

    expect(
      (await ai!(PDF)).text,
      "the four AI engines must receive collapsed padding — this count is " +
        "compared against TRANSLATE_MAX_INPUT_CHARS and paid for in output tokens",
    ).toBe("North 1200 1350");
    expect(
      (await office!(PDF)).text,
      "PDF→Office export splits spreadsheet rows on runs of 2+ spaces; " +
        "collapsing here merges its columns",
    ).toBe(row);
  });
});
