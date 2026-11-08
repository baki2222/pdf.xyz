import { describe, expect, it } from "vitest";
import { BATCH_LIMITS } from "./limits";
import {
  OCR_BATCH_SLUG,
  WORKER_BATCH_TOOLS,
  IMAGE_BATCH_TOOLS,
  RASTER_BATCH_TOOLS,
  SETTINGS_BATCH_TOOLS,
  TEXT_BATCH_TOOLS,
  batchLimitsSentence,
  batchMaxFilesFor,
} from "./tools";

const MB = 1024 * 1024;

/**
 * Which cap each batch takes, and the sentence its page states, read from
 * the limits (batch plan P2): the raster batches take
 * `BATCH_LIMITS.rasterMaxFiles`, every other batch `clientMaxFiles`.
 */
describe("batch caps by tool", () => {
  it("every raster batch is a registered batch, and the images batches are all raster", () => {
    const registered = [
      ...Object.keys(SETTINGS_BATCH_TOOLS),
      ...Object.keys(IMAGE_BATCH_TOOLS),
      ...Object.keys(TEXT_BATCH_TOOLS),
    ];
    // Health: four raster tools, as batch plan P2 names them.
    expect(RASTER_BATCH_TOOLS.length).toBeGreaterThanOrEqual(4);
    for (const slug of RASTER_BATCH_TOOLS) expect(registered).toContain(slug);
    for (const slug of Object.keys(IMAGE_BATCH_TOOLS))
      expect(RASTER_BATCH_TOOLS).toContain(slug);
    expect(RASTER_BATCH_TOOLS).toContain("grayscale-pdf");
  });

  it("a raster batch caps at rasterMaxFiles, every other at clientMaxFiles", () => {
    for (const slug of RASTER_BATCH_TOOLS)
      expect(batchMaxFilesFor(slug), slug).toBe(BATCH_LIMITS.rasterMaxFiles);
    for (const slug of ["rotate-pdf", "flatten-pdf", "text-to-pdf"])
      expect(batchMaxFilesFor(slug), slug).toBe(BATCH_LIMITS.clientMaxFiles);
  });

  it("the page sentence carries that cap and the noun of the files taken", () => {
    const total = BATCH_LIMITS.clientMaxTotalBytes / MB;
    expect(batchLimitsSentence("pdf-to-png")).toBe(
      `A batch takes up to ${BATCH_LIMITS.rasterMaxFiles} PDFs, ${total} MB in all.`,
    );
    expect(batchLimitsSentence("text-to-pdf")).toBe(
      `A batch takes up to ${BATCH_LIMITS.clientMaxFiles} text files, ${total} MB in all.`,
    );
    // No slug: the settings batches' sentence, as P1 shipped it.
    expect(batchLimitsSentence()).toBe(
      `A batch takes up to ${BATCH_LIMITS.clientMaxFiles} PDFs, ${total} MB in all.`,
    );
    // Control: the two caps differ, so the sentences do.
    expect(batchLimitsSentence("grayscale-pdf")).not.toBe(
      batchLimitsSentence("rotate-pdf"),
    );
  });
});

/**
 * Batch plan P5: OCR PDF's batch takes `BATCH_LIMITS.ocrMaxFiles`, and only
 * it; every other worker batch takes `workerMaxFiles`. Its page states the
 * OCR cap with the noun the batch counts in.
 */
describe("the OCR batch's cap", () => {
  it("OCR PDF caps at ocrMaxFiles, every other worker batch at workerMaxFiles", () => {
    expect(OCR_BATCH_SLUG in WORKER_BATCH_TOOLS).toBe(true);
    expect(batchMaxFilesFor(OCR_BATCH_SLUG)).toBe(BATCH_LIMITS.ocrMaxFiles);
    const others = Object.keys(WORKER_BATCH_TOOLS).filter(
      (slug) => slug !== OCR_BATCH_SLUG,
    );
    // Health: P3's ten and P4's two.
    expect(others.length).toBeGreaterThanOrEqual(12);
    for (const slug of others)
      expect(batchMaxFilesFor(slug), slug).toBe(BATCH_LIMITS.workerMaxFiles);
  });

  it("its page sentence carries the OCR cap and the noun the batch counts in", () => {
    expect(batchLimitsSentence(OCR_BATCH_SLUG)).toBe(
      `A batch takes up to ${BATCH_LIMITS.ocrMaxFiles} scans, ${BATCH_LIMITS.clientMaxTotalBytes / MB} MB in all.`,
    );
    // Control: the two worker caps differ, so the sentences do.
    expect(batchLimitsSentence(OCR_BATCH_SLUG)).not.toContain(
      `${BATCH_LIMITS.workerMaxFiles} `,
    );
  });
});
