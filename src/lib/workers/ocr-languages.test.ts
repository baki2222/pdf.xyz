// @vitest-environment node
/**
 * The runtime half of the OCR language contract: what packs this host actually has,
 * what the capability payload may therefore claim, and what happens when a user
 * asks for a language the worker cannot recognize.
 *
 * The build-time half — that the Dockerfile installs a pack for every advertised
 * language — lives in `src/deploy/ocr-languages.test.ts`. Both exist because the
 * two can drift independently: the Dockerfile can fall behind the product's
 * language menu, and a running deployment can be an older image than the current
 * Dockerfile describes.
 */
import { describe, expect, it } from "vitest";
import { buildOcrCapability } from "./ocr";
import { probeInstalledOcrLanguages } from "./ocr-native";
import { createOcrProcessor } from "./processor/ocr";
import type { ProcessorInputFile } from "./processor/types";

const ENGINES = { ocrmypdf: true, tesseract: true };

function pdfInput(): ProcessorInputFile {
  return {
    fileId: "f_x",
    filename: "scan.pdf",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
  };
}

/** A runner that must never be reached when the language check refuses first. */
function explodingRunner() {
  return async () => {
    throw new Error("the runner must not be called");
  };
}

describe("probeInstalledOcrLanguages", () => {
  const dirs = (map: Record<string, string[]>) => (dir: string) => map[dir] ?? [];

  it("reads language codes from traineddata filenames", () => {
    const found = probeInstalledOcrLanguages(
      { TESSDATA_PREFIX: "/t" },
      { readDir: dirs({ "/t": ["eng.traineddata", "spa.traineddata", "chi_sim.traineddata"] }) },
    );
    expect(found).toEqual(["chi_sim", "eng", "spa"]);
  });

  it("excludes osd — it is script detection, not a selectable language", () => {
    const found = probeInstalledOcrLanguages(
      { TESSDATA_PREFIX: "/t" },
      { readDir: dirs({ "/t": ["eng.traineddata", "osd.traineddata"] }) },
    );
    expect(found).toEqual(["eng"]);
  });

  it("ignores non-traineddata files", () => {
    const found = probeInstalledOcrLanguages(
      { TESSDATA_PREFIX: "/t" },
      { readDir: dirs({ "/t": ["eng.traineddata", "configs", "pdf.ttf", "README"] }) },
    );
    expect(found).toEqual(["eng"]);
  });

  it("merges and de-duplicates across every search directory", () => {
    const found = probeInstalledOcrLanguages(
      { TESSDATA_PREFIX: "/custom" },
      {
        readDir: dirs({
          "/custom": ["eng.traineddata", "ara.traineddata"],
          "/usr/share/tessdata": ["eng.traineddata", "hin.traineddata"],
        }),
      },
    );
    expect(found).toEqual(["ara", "eng", "hin"]);
  });

  it("returns an empty list rather than throwing when nothing is readable", () => {
    expect(probeInstalledOcrLanguages({}, { readDir: () => [] })).toEqual([]);
  });
});

describe("buildOcrCapability — reports what is runnable, not what is offered", () => {
  it("narrows the advertised list to the packs actually installed", () => {
    const capability = buildOcrCapability("remote-configured", ENGINES, ["eng", "spa"]);
    expect(capability.available).toBe(true);
    expect(capability.languages).toEqual(["eng", "spa"]);
  });

  it("never invents a language: an installed pack the product does not offer is not reported", () => {
    // `epo` has a Tesseract pack but is not in OCR_LANGUAGES — the capability is the
    // intersection, so it must not appear in a menu the product cannot honour.
    const capability = buildOcrCapability("remote-configured", ENGINES, ["eng", "epo"]);
    expect(capability.languages).toEqual(["eng"]);
  });

  it("falls back to the advertised list when the caller cannot observe the packs", () => {
    // The web tier has no worker filesystem; the advertised list is the best it can
    // honestly say from there.
    const capability = buildOcrCapability("remote-configured", ENGINES);
    expect(capability.languages.length).toBeGreaterThan(1);
    expect(capability.languages).toContain("eng");
  });

  it("reports no languages at all when OCR is unavailable", () => {
    expect(buildOcrCapability("disabled", ENGINES, ["eng"]).languages).toEqual([]);
  });
});

describe("buildOcrCapability — OCR observed on the out-of-band worker", () => {
  it("is available when the worker's heartbeat reports it, with no local engine", () => {
    // The production shape: the web tier ships no OCR binary, so a local probe
    // answers "no" — but the worker that runs the jobs reports OCR enabled.
    const capability = buildOcrCapability("disabled", undefined, undefined, true);
    expect(capability.available).toBe(true);
    expect(capability.languages.length).toBeGreaterThan(1);
  });

  it("does not name an engine it cannot observe", () => {
    // Guessing "ocrmypdf" here would be a fabrication: the web tier has no way to
    // know which engine the worker runs.
    expect(buildOcrCapability("disabled", undefined, undefined, true).engine).toBeNull();
  });

  it("admits it is guessing when the worker does not report its packs", () => {
    // The honest fallback, unchanged in substance: with no observed pack list the menu
    // is the full catalogue, and the copy has to say so rather than implying the
    // worker was asked and answered.
    const { detail } = buildOcrCapability("disabled", undefined, undefined, true);
    expect(detail).toMatch(/not reporting which language packs/i);
    expect(detail).toMatch(/fails honestly/i);
  });

  it("reports the observed packs, and says they are observed, once the worker sends them", () => {
    // This assertion used to read `not observable from here`, which was true when the
    // heartbeat carried only a boolean. It now carries the language list, so a claim
    // of ignorance would itself be the inaccurate statement.
    const capability = buildOcrCapability("disabled", undefined, ["eng", "ben"], true);
    expect(capability.languages).toEqual(["eng", "ben"]);
    expect(capability.detail).toMatch(/actually has installed/i);
    expect(capability.detail).not.toMatch(/not observable from here/i);
  });

  it("stays unavailable when no worker reported OCR", () => {
    // The pre-existing, cautious answer must be unchanged when there is no signal.
    for (const signal of [false, undefined]) {
      const capability = buildOcrCapability("disabled", undefined, undefined, signal);
      expect(capability.available).toBe(false);
      expect(capability.languages).toEqual([]);
    }
  });

  it("prefers a locally-probed engine over the heartbeat when both are present", () => {
    // A local-dev worker with a real engine should still name it.
    const capability = buildOcrCapability("local-dev", ENGINES, ["eng"], true);
    expect(capability.engine).not.toBeNull();
    expect(capability.languages).toEqual(["eng"]);
  });
});

describe("the OCR processor refuses an uninstalled language honestly", () => {
  const processor = (installedLanguages?: readonly string[]) =>
    createOcrProcessor({
      engines: ENGINES,
      runner: explodingRunner(),
      ...(installedLanguages ? { installedLanguages } : {}),
    });

  it("fails before running, naming the language, and does NOT blame the file", async () => {
    const result = await processor(["eng"]).process({
      tool: "ocr-pdf",
      inputs: [pdfInput()],
      options: { languages: ["spa"] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unprocessable_entity");
    // The old behaviour told the user their document could not be processed.
    expect(result.error.message).not.toMatch(/could not process this file/i);
    expect(result.error.message).toMatch(/Spanish/);
    expect(result.error.message).toMatch(/language pack/i);
  });

  it("is NOT retryable — a missing pack cannot appear on a second attempt", async () => {
    const result = await processor(["eng"]).process({
      tool: "ocr-pdf",
      inputs: [pdfInput()],
      options: { languages: ["ara"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(false);
  });

  it("names every missing language when several were requested", async () => {
    const result = await processor(["eng"]).process({
      tool: "ocr-pdf",
      inputs: [pdfInput()],
      options: { languages: ["eng", "hin", "jpn"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/Hindi/);
    expect(result.error.message).toMatch(/Japanese/);
    // The one that IS installed must not be blamed.
    expect(result.error.message).not.toMatch(/English/);
  });

  it("lets an installed language through to the runner", async () => {
    // The runner throws by design, so reaching it proves the check did not refuse.
    const result = await processor(["eng"]).process({
      tool: "ocr-pdf",
      inputs: [pdfInput()],
      options: { languages: ["eng"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/could not process this file/i);
  });

  it("skips the check entirely when the packs could not be observed", async () => {
    // Absent `installedLanguages` must not turn into "nothing is installed" — that
    // would refuse every job on a host whose filesystem we simply could not read.
    const result = await processor().process({
      tool: "ocr-pdf",
      inputs: [pdfInput()],
      options: { languages: ["spa"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });
});
