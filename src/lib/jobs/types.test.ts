import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION,
  isDownloadReady,
  isTerminalStatus,
  TERMINAL_STATUSES,
  type JobArtifact,
  type JobStatus,
} from "./types";

const artifact: JobArtifact = {
  artifactId: "a_result1",
  filename: "output.pdf",
  contentType: "application/pdf",
  bytes: 2048,
  url: "https://storage.example/signed",
  expiresAt: "2026-01-01T00:00:00.000Z",
};

describe("job state helpers", () => {
  it("classifies terminal vs in-flight statuses", () => {
    for (const status of [
      "completed",
      "failed",
      "expired",
      "canceled",
    ] as JobStatus[]) {
      expect(isTerminalStatus(status), status).toBe(true);
    }
    for (const status of ["queued", "scanning", "processing"] as JobStatus[]) {
      expect(isTerminalStatus(status), status).toBe(false);
    }
    expect([...TERMINAL_STATUSES].sort()).toEqual([
      "canceled",
      "completed",
      "expired",
      "failed",
    ]);
  });

  it("marks download ready only for completed jobs with artifacts", () => {
    expect(
      isDownloadReady({ status: "completed", artifacts: [artifact] }),
    ).toBe(true);
    expect(isDownloadReady({ status: "completed", artifacts: [] })).toBe(false);
    expect(isDownloadReady({ status: "completed" })).toBe(false);
    expect(
      isDownloadReady({ status: "processing", artifacts: [artifact] }),
    ).toBe(false);
    expect(isDownloadReady({ status: "failed" })).toBe(false);
  });
});

describe("retention default", () => {
  it("is privacy-first: bounded TTLs and never persists after a job", () => {
    expect(DEFAULT_RETENTION.persistsAfterJob).toBe(false);
    expect(DEFAULT_RETENTION.inputTtlMinutes).toBeGreaterThan(0);
    expect(DEFAULT_RETENTION.outputTtlMinutes).toBeGreaterThan(0);
  });
});
