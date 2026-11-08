import { describe, expect, it } from "vitest";
import { JOB_LIMITS, RATE_LIMITS } from "@/lib/jobs/types";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import {
  BATCH_LIMITS,
  capBatchFiles,
  overBytesReason,
  overCountReason,
} from "./limits";

const MB = 1024 * 1024;

/**
 * Each batch limit against a SECOND, independent bound (CLAUDE.md rule 3: a
 * constant has no relationships to constrain, so a restated literal proves
 * nothing). The owner's ruling (2026-11-08) is written here as numbers, not
 * read from the module, so a change to either side is a red test that has to
 * argue which one moved.
 */
describe("BATCH_LIMITS — every value against an independent bound", () => {
  it("the client file cap is the owner's 20, and never more than one server upload takes", () => {
    expect(BATCH_LIMITS.clientMaxFiles).toBe(20);
    expect(BATCH_LIMITS.clientMaxFiles).toBeLessThanOrEqual(
      JOB_LIMITS.maxInputFiles,
    );
    // A batch is two or more files: a cap under 2 is no batch at all.
    expect(BATCH_LIMITS.clientMaxFiles).toBeGreaterThanOrEqual(2);
  });

  it("the client byte total is the owner's 200 MB, takes two of the largest file, and stays under the server's total", () => {
    expect(BATCH_LIMITS.clientMaxTotalBytes).toBe(200 * MB);
    expect(BATCH_LIMITS.clientMaxTotalBytes).toBeGreaterThanOrEqual(
      2 * MAX_PDF_BYTES,
    );
    expect(BATCH_LIMITS.clientMaxTotalBytes).toBeLessThanOrEqual(
      JOB_LIMITS.maxTotalBytes,
    );
  });

  it("the raster cap is the owner's 10, below the client cap, and still a batch", () => {
    expect(BATCH_LIMITS.rasterMaxFiles).toBe(10);
    // A raster file becomes many images held until the ZIP: its cap is
    // never above the cap for tools whose file stays one file.
    expect(BATCH_LIMITS.rasterMaxFiles).toBeLessThan(
      BATCH_LIMITS.clientMaxFiles,
    );
    expect(BATCH_LIMITS.rasterMaxFiles).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(BATCH_LIMITS.rasterMaxFiles)).toBe(true);
  });

  // Batch plan P3: a worker batch is N single jobs, each one upload and one
  // job against the hourly limits every visitor on an address shares
  // (`RATE_LIMITS`, `PER_CLIENT_KEYING_DISCLOSED`). The bound is the
  // plan's: a batch takes at most a SIXTH of the smaller hourly count, so
  // one batch leaves five more of its size, or a colleague's work, room in
  // the same hour. It is read from `RATE_LIMITS`, never restated, so a
  // lowered limit turns this red before a batch can outgrow it.
  it("the worker cap is the owner's 10, and at most a sixth of the hourly jobs and uploads", () => {
    expect(BATCH_LIMITS.workerMaxFiles).toBe(10);
    expect(BATCH_LIMITS.workerMaxFiles).toBeLessThanOrEqual(
      Math.floor(
        Math.min(
          RATE_LIMITS.jobsPerHourPerClient,
          RATE_LIMITS.uploadsPerHourPerClient,
        ) / 6,
      ),
    );
    expect(BATCH_LIMITS.workerMaxFiles).toBeLessThanOrEqual(
      BATCH_LIMITS.clientMaxFiles,
    );
    expect(BATCH_LIMITS.workerMaxFiles).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(BATCH_LIMITS.workerMaxFiles)).toBe(true);
  });

  it("the refusal sentences carry the limits themselves, not typed numbers", () => {
    expect(overCountReason(BATCH_LIMITS.clientMaxFiles)).toContain(
      `up to ${BATCH_LIMITS.clientMaxFiles} files`,
    );
    expect(overBytesReason(BATCH_LIMITS.clientMaxTotalBytes)).toContain(
      `up to ${BATCH_LIMITS.clientMaxTotalBytes / MB} MB`,
    );
    // Control: a different limit says a different number.
    expect(overCountReason(7)).toContain("up to 7 files");
    expect(overCountReason(7)).not.toContain("20");
  });
});

describe("capBatchFiles — every file is taken or listed, never dropped", () => {
  const f = (name: string, size = 1) => ({ name, size });

  it("lists every file past the count, in order, with the count's sentence", () => {
    const files = Array.from({ length: 23 }, (_, i) => f(`f${i}.pdf`));
    const { accepted, rejected } = capBatchFiles(files);
    expect(accepted).toHaveLength(BATCH_LIMITS.clientMaxFiles);
    expect(rejected.map((r) => r.file.name)).toEqual([
      "f20.pdf",
      "f21.pdf",
      "f22.pdf",
    ]);
    expect(
      rejected.every(
        (r) => r.reason === overCountReason(BATCH_LIMITS.clientMaxFiles),
      ),
    ).toBe(true);
    // The whole input is accounted for.
    expect(accepted.length + rejected.length).toBe(files.length);
  });

  it("refuses a file that would take the total past the cap, and still takes a smaller one after it", () => {
    const { accepted, rejected } = capBatchFiles(
      [f("a", 90 * MB), f("b", 90 * MB), f("c", 30 * MB), f("d", 20 * MB)],
      { maxFiles: 20, maxTotalBytes: 200 * MB },
    );
    expect(accepted.map((x) => x.name)).toEqual(["a", "b", "d"]);
    expect(rejected).toEqual([
      { file: f("c", 30 * MB), reason: overBytesReason(200 * MB) },
    ]);
  });

  it("takes everything under both limits", () => {
    const files = [f("a"), f("b")];
    expect(capBatchFiles(files)).toEqual({ accepted: files, rejected: [] });
  });
});
