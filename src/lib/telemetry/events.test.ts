import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  TOOL_ERROR_REASONS,
  isKnownEventName,
  toolCompletedEvent,
  handoffCreatedEvent,
} from "./events";

describe("event name allowlist", () => {
  it("includes exactly the known named product events", () => {
    expect([...EVENT_NAMES].sort()).toEqual(
      [
        "tool_viewed",
        "tool_completed",
        "tool_failed",
        "workspace_handoff_created",
        "suggestion_opened",
        "worker_status_checked",
        "worker_operations_checked",
        "gated_tool_interest",
      ].sort(),
    );
    // `worker_contract_hit` was declared here until 2026-09-27 and sent by
    // nothing; its fields duplicated `tool_completed`/`tool_failed`, which are
    // now sent. `event-call-sites.test.ts` fails on any declared-but-unsent
    // event, so a decorative one cannot come back.
  });

  it("recognizes every listed name", () => {
    for (const name of EVENT_NAMES) {
      expect(isKnownEventName(name)).toBe(true);
    }
  });

  it("rejects unknown names and non-strings", () => {
    expect(isKnownEventName("tool_opened")).toBe(false);
    expect(isKnownEventName("")).toBe(false);
    expect(isKnownEventName(undefined)).toBe(false);
    expect(isKnownEventName(42)).toBe(false);
    expect(isKnownEventName({ name: "tool_viewed" })).toBe(false);
  });
});

describe("toolCompletedEvent", () => {
  it("buckets input count, output size, and duration — storing no raw numbers", () => {
    const event = toolCompletedEvent({
      toolSlug: "compress-pdf",
      capability: "in-browser",
      inputCount: 3,
      outputBytes: 5 * 1024 * 1024,
      elapsedMs: 2500,
    });

    expect(event).toEqual({
      name: "tool_completed",
      toolSlug: "compress-pdf",
      capability: "in-browser",
      inputCount: "2-5",
      outputSize: "1-10MB",
      duration: "1-5s",
    });

    // Privacy invariant: every value is a coarse label/string, never a raw number.
    for (const value of Object.values(event)) {
      expect(typeof value).not.toBe("number");
    }
  });

  it("omits optional dimensions that weren't measured", () => {
    const event = toolCompletedEvent({
      toolSlug: "merge-pdf",
      capability: "in-browser",
      inputCount: 12,
    });

    expect(event).toEqual({
      name: "tool_completed",
      toolSlug: "merge-pdf",
      capability: "in-browser",
      inputCount: "6-20",
    });
    expect("outputSize" in event).toBe(false);
    expect("duration" in event).toBe(false);
  });
});

describe("handoffCreatedEvent", () => {
  it("buckets the file count and preserves slug + mode", () => {
    const event = handoffCreatedEvent({
      toolSlug: "compress-pdf",
      mode: "batch",
      fileCount: 7,
    });

    expect(event).toEqual({
      name: "workspace_handoff_created",
      toolSlug: "compress-pdf",
      mode: "batch",
      fileCount: "6-20",
    });
    expect(typeof event.fileCount).toBe("string");
  });
});

describe("TOOL_ERROR_REASONS", () => {
  it("covers the honest, coarse failure categories the UX distinguishes", () => {
    expect(TOOL_ERROR_REASONS).toContain("handoff-expired");
    expect(TOOL_ERROR_REASONS).toContain("unsupported-batch");
    expect(TOOL_ERROR_REASONS).toContain("worker-unavailable");
    // Reasons are fixed categories, never free-form messages.
    for (const reason of TOOL_ERROR_REASONS) {
      expect(reason).toMatch(/^[a-z-]+$/);
    }
  });
});
