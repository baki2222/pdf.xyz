// @vitest-environment node
/**
 * Which OCR engine runs a given input.
 *
 * The `ocr-pdf` tool accepts `PDF, JPG, PNG`, but its two engines are not
 * interchangeable: OCRmyPDF is PDF-in/PDF-out and rejects a raster outright, while
 * Tesseract reads an image and cannot take a PDF. Selection used a fixed preference
 * order that ignored the input, so with both engines installed OCRmyPDF always won
 * and every image upload died inside the engine — surfacing as "The OCR engine could
 * not process this file", which blamed the user's picture for our wrong dispatch.
 * Two of the three accepted formats were broken.
 */
import { describe, expect, it } from "vitest";
import type { NativeOcrConfig } from "./ocr-native-config";
import type { ProcessorInputFile } from "./processor/types";
import { engineForInput, isImageInput } from "./ocr-native";

function cfg(over: Partial<NativeOcrConfig> = {}): NativeOcrConfig {
  return {
    enabled: true,
    binaries: { ocrmypdf: "ocrmypdf", tesseract: "tesseract" },
    overridden: { ocrmypdf: false, tesseract: false },
    timeoutMs: 300_000,
    maxInputBytes: 200 * 1024 * 1024,
    maxOutputBytes: 500 * 1024 * 1024,
    ...over,
  };
}

function file(contentType: string, filename = "scan"): ProcessorInputFile {
  return {
    fileId: "f_x",
    filename,
    contentType,
    bytes: new Uint8Array([1, 2, 3]),
  };
}

/** Which binaries this host has. */
const installed = (...names: string[]) => ({
  resolveOnPath: (binary: string) => names.includes(binary),
});

const BOTH = installed("ocrmypdf", "tesseract");
const ONLY_OCRMYPDF = installed("ocrmypdf");
const ONLY_TESSERACT = installed("tesseract");
const NOTHING = installed();

describe("isImageInput", () => {
  it("recognizes the raster types the tool accepts", () => {
    expect(isImageInput(file("image/png"))).toBe(true);
    expect(isImageInput(file("image/jpeg"))).toBe(true);
    expect(isImageInput(file("image/tiff"))).toBe(true);
  });

  it("treats a PDF, and anything unrecognized, as not an image", () => {
    expect(isImageInput(file("application/pdf"))).toBe(false);
    expect(isImageInput(file("application/octet-stream"))).toBe(false);
  });
});

describe("engineForInput — dispatch follows the input, not a fixed order", () => {
  it("sends an image to Tesseract even when OCRmyPDF is installed and preferred", () => {
    // The regression: OCRmyPDF won on preference and could not read the raster.
    expect(engineForInput(file("image/png"), cfg(), BOTH)).toBe("tesseract");
    expect(engineForInput(file("image/jpeg"), cfg(), BOTH)).toBe("tesseract");
  });

  it("sends a PDF to OCRmyPDF", () => {
    // Preferred for PDFs on purpose: it adds an invisible text layer to the existing
    // pages, which is the tool's promise. Tesseract would rebuild the document.
    expect(engineForInput(file("application/pdf"), cfg(), BOTH)).toBe("ocrmypdf");
  });

  it("returns null for an image when only OCRmyPDF is installed", () => {
    // Better than dispatching to an engine that cannot read it: the caller reports a
    // missing engine instead of a broken file.
    expect(engineForInput(file("image/png"), cfg(), ONLY_OCRMYPDF)).toBeNull();
  });

  it("returns null for a PDF when only Tesseract is installed", () => {
    expect(engineForInput(file("application/pdf"), cfg(), ONLY_TESSERACT)).toBeNull();
  });

  it("still serves the input kind each installed engine can handle", () => {
    expect(engineForInput(file("application/pdf"), cfg(), ONLY_OCRMYPDF)).toBe("ocrmypdf");
    expect(engineForInput(file("image/png"), cfg(), ONLY_TESSERACT)).toBe("tesseract");
  });

  it("returns null for everything when nothing is installed", () => {
    expect(engineForInput(file("application/pdf"), cfg(), NOTHING)).toBeNull();
    expect(engineForInput(file("image/png"), cfg(), NOTHING)).toBeNull();
  });

  it("returns null for everything when the OCR kill switch is off", () => {
    expect(engineForInput(file("image/png"), cfg({ enabled: false }), BOTH)).toBeNull();
    expect(engineForInput(file("application/pdf"), cfg({ enabled: false }), BOTH)).toBeNull();
  });

  it("honours a pin: an image gets no engine when the config pins OCRmyPDF", () => {
    // A pinned engine is an operator's explicit choice; dispatch must not silently
    // route around it to the other engine.
    const pinned = cfg({ engine: "ocrmypdf" } as Partial<NativeOcrConfig>);
    expect(engineForInput(file("image/png"), pinned, BOTH)).toBeNull();
    expect(engineForInput(file("application/pdf"), pinned, BOTH)).toBe("ocrmypdf");
  });
});
