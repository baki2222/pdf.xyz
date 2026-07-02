import { describe, expect, it } from "vitest";
import { TERMINAL_STATUSES, type JobStatus } from "@/lib/jobs";
import {
  QUEUE_TRANSITIONS,
  canCancel,
  canExpire,
  canRedeliver,
  canTransition,
  deletionTarget,
} from "./state";

const ALL_STATUSES: JobStatus[] = [
  "queued",
  "scanning",
  "processing",
  "completed",
  "failed",
  "expired",
  "canceled",
];

describe("queue state machine", () => {
  it("defines transitions for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(QUEUE_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("walks the documented happy path", () => {
    expect(canTransition("queued", "scanning")).toBe(true);
    expect(canTransition("scanning", "processing")).toBe(true);
    expect(canTransition("processing", "completed")).toBe(true);
  });

  it("allows failure and cancellation from every in-flight state", () => {
    for (const status of ["queued", "scanning", "processing"] as JobStatus[]) {
      expect(canTransition(status, "failed")).toBe(true);
      expect(canTransition(status, "canceled")).toBe(true);
    }
  });

  it("never lets a job skip processing straight to completed", () => {
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("scanning", "completed")).toBe(false);
  });

  it("allows redelivery of an active job back to queued", () => {
    // Lease expiry / retryable requeue returns an un-acked job to the queue.
    expect(canTransition("scanning", "queued")).toBe(true);
    expect(canTransition("processing", "queued")).toBe(true);
    expect(canRedeliver("scanning")).toBe(true);
    expect(canRedeliver("processing")).toBe(true);
    // A fresh queued job or any terminal job is never redelivered.
    for (const status of [
      "queued",
      "completed",
      "failed",
      "expired",
      "canceled",
    ] as JobStatus[]) {
      expect(canRedeliver(status)).toBe(false);
    }
    // Redelivery never resurrects a terminal job.
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("canceled", "queued")).toBe(false);
  });

  it("treats failed/expired/canceled as dead ends", () => {
    for (const status of ["failed", "expired", "canceled"] as JobStatus[]) {
      expect(QUEUE_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("only allows completed → expired (retention)", () => {
    expect(canTransition("completed", "expired")).toBe(true);
    expect(canExpire("completed")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "completed")) {
      expect(canExpire(status)).toBe(false);
    }
  });

  it("canCancel is exactly the non-terminal statuses", () => {
    for (const status of ALL_STATUSES) {
      const terminal = (TERMINAL_STATUSES as readonly JobStatus[]).includes(
        status,
      );
      expect(canCancel(status)).toBe(!terminal);
    }
  });

  it("maps a delete-now request to the right terminal target", () => {
    expect(deletionTarget("queued")).toBe("canceled");
    expect(deletionTarget("processing")).toBe("canceled");
    expect(deletionTarget("completed")).toBe("expired");
    // Already terminal with nothing to delete → idempotent no-op.
    expect(deletionTarget("failed")).toBeNull();
    expect(deletionTarget("expired")).toBeNull();
    expect(deletionTarget("canceled")).toBeNull();
  });
});
