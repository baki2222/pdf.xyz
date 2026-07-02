// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nativeOcrDeps, ocrNativeArgs, type OcrNativePaths } from "./native";
import type { OcrOptions } from "./engine";

const paths: OcrNativePaths = {
  inputPath: "/tmp/pdfxyz/input.pdf",
  outBase: "/tmp/pdfxyz/output",
  outPdfPath: "/tmp/pdfxyz/output.pdf",
  outTxtPath: "/tmp/pdfxyz/output.txt",
};

function opts(overrides: Partial<OcrOptions> = {}): OcrOptions {
  return {
    languages: ["eng"],
    outputMode: "searchable-pdf",
    deskew: false,
    rotate: false,
    clean: false,
    onExistingText: "skip",
    ...overrides,
  };
}

describe("ocrNativeArgs — ocrmypdf", () => {
  it("builds a minimal searchable-PDF invocation over the fixed temp paths", () => {
    const { command, args, outputFile } = ocrNativeArgs(
      "ocrmypdf",
      opts(),
      "pdf",
      paths,
    );
    expect(command).toBe("ocrmypdf");
    expect(args).toEqual([
      "-l",
      "eng",
      "--skip-text",
      "--output-type",
      "pdf",
      "--quiet",
      paths.inputPath,
      paths.outPdfPath,
    ]);
    // Input and output are always the last two positional args (never mixed in).
    expect(args.slice(-2)).toEqual([paths.inputPath, paths.outPdfPath]);
    expect(outputFile).toBe(paths.outPdfPath);
  });

  it("joins multiple languages with '+' as a single argv element", () => {
    const { args } = ocrNativeArgs(
      "ocrmypdf",
      opts({ languages: ["eng", "deu", "chi_sim"] }),
      "pdf",
      paths,
    );
    const langIndex = args.indexOf("-l");
    expect(args[langIndex + 1]).toBe("eng+deu+chi_sim");
  });

  it("maps every preprocessing option and existing-text strategy to real flags", () => {
    const { args } = ocrNativeArgs(
      "ocrmypdf",
      opts({
        deskew: true,
        rotate: true,
        clean: true,
        onExistingText: "force",
        pages: "1-3,5",
      }),
      "pdf",
      paths,
    );
    expect(args).toContain("--deskew");
    expect(args).toContain("--rotate-pages");
    expect(args).toContain("--clean");
    expect(args).toContain("--force-ocr");
    expect(args).not.toContain("--skip-text");
    const pagesIndex = args.indexOf("--pages");
    expect(args[pagesIndex + 1]).toBe("1-3,5");
  });

  it("uses --redo-ocr for the redo strategy", () => {
    const { args } = ocrNativeArgs(
      "ocrmypdf",
      opts({ onExistingText: "redo" }),
      "pdf",
      paths,
    );
    expect(args).toContain("--redo-ocr");
  });

  it("emits a text sidecar and reads from it in text-sidecar mode", () => {
    const { args, outputFile } = ocrNativeArgs(
      "ocrmypdf",
      opts({ outputMode: "text-sidecar" }),
      "pdf",
      paths,
    );
    const sidecarIndex = args.indexOf("--sidecar");
    expect(args[sidecarIndex + 1]).toBe(paths.outTxtPath);
    // OCRmyPDF still needs a PDF output positionally, but we read the sidecar.
    expect(args.slice(-2)).toEqual([paths.inputPath, paths.outPdfPath]);
    expect(outputFile).toBe(paths.outTxtPath);
  });

  it("supplies an assumed DPI when handed a bare image", () => {
    const { args } = ocrNativeArgs("ocrmypdf", opts(), "image", paths);
    const dpiIndex = args.indexOf("--image-dpi");
    expect(args[dpiIndex + 1]).toBe("300");
  });
});

describe("ocrNativeArgs — tesseract", () => {
  it("builds a single-image searchable-PDF invocation", () => {
    const { command, args, outputFile } = ocrNativeArgs(
      "tesseract",
      opts(),
      "image",
      paths,
    );
    expect(command).toBe("tesseract");
    expect(args).toEqual([paths.inputPath, paths.outBase, "-l", "eng", "pdf"]);
    expect(outputFile).toBe(`${paths.outBase}.pdf`);
  });

  it("adds automatic page segmentation (--psm 1) when auto-rotate is requested", () => {
    const { args } = ocrNativeArgs(
      "tesseract",
      opts({ rotate: true }),
      "image",
      paths,
    );
    const psmIndex = args.indexOf("--psm");
    expect(args[psmIndex + 1]).toBe("1");
  });

  it("writes a .txt config + output file in text-sidecar mode", () => {
    const { args, outputFile } = ocrNativeArgs(
      "tesseract",
      opts({ outputMode: "text-sidecar" }),
      "image",
      paths,
    );
    expect(args[args.length - 1]).toBe("txt");
    expect(outputFile).toBe(`${paths.outBase}.txt`);
  });
});

describe("nativeOcrDeps", () => {
  it("returns a presence-only engine map and a native executor", () => {
    const deps = nativeOcrDeps();
    expect(typeof deps.engines.ocrmypdf).toBe("boolean");
    expect(typeof deps.engines.tesseract).toBe("boolean");
    expect(typeof deps.native).toBe("function");
  });
});
