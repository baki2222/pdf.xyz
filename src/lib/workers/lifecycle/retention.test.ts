// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import {
  DEFAULT_RETENTION_SETTINGS,
  RETENTION_BOUNDS,
  RETENTION_ENV,
  parseRetentionSettings,
  resolveRetentionSettings,
} from "./retention";

describe("parseRetentionSettings — defaults", () => {
  it("returns the app-wide default window on an empty environment", () => {
    const parsed = parseRetentionSettings({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config).toEqual(DEFAULT_RETENTION_SETTINGS);
    // The object TTLs mirror the single source of truth in @/lib/jobs.
    expect(parsed.config.inputTtlMinutes).toBe(
      DEFAULT_RETENTION.inputTtlMinutes,
    );
    expect(parsed.config.artifactTtlMinutes).toBe(
      DEFAULT_RETENTION.outputTtlMinutes,
    );
  });
});

describe("parseRetentionSettings — valid overrides", () => {
  it("parses in-bounds overrides for every knob", () => {
    const parsed = parseRetentionSettings({
      [RETENTION_ENV.inputTtlMinutes]: "30",
      [RETENTION_ENV.artifactTtlMinutes]: "120",
      [RETENTION_ENV.multipartAbortHours]: "6",
      [RETENTION_ENV.noncurrentVersionDays]: "2",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config).toEqual({
      inputTtlMinutes: 30,
      artifactTtlMinutes: 120,
      multipartAbortHours: 6,
      noncurrentVersionDays: 2,
    });
  });

  it("accepts the exact min and max bounds", () => {
    const parsed = parseRetentionSettings({
      [RETENTION_ENV.inputTtlMinutes]: String(
        RETENTION_BOUNDS.inputTtlMinutes.min,
      ),
      [RETENTION_ENV.artifactTtlMinutes]: String(
        RETENTION_BOUNDS.artifactTtlMinutes.max,
      ),
    });
    expect(parsed.ok).toBe(true);
  });
});

describe("parseRetentionSettings — invalid overrides fail closed", () => {
  it("rejects an over-ceiling input TTL (privacy risk) and names the variable only", () => {
    const parsed = parseRetentionSettings({
      [RETENTION_ENV.inputTtlMinutes]: String(
        RETENTION_BOUNDS.inputTtlMinutes.max + 1,
      ),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]!.field).toBe(RETENTION_ENV.inputTtlMinutes);
    // The message names the variable/bound, never the offending value.
    expect(parsed.issues[0]!.message).not.toContain(
      String(RETENTION_BOUNDS.inputTtlMinutes.max + 1),
    );
  });

  it("rejects zero, negative-shaped, and non-numeric values", () => {
    for (const raw of ["0", "-5", "abc", "12.5", ""]) {
      // An empty string is treated as unset (⇒ default, ok); the rest are invalid.
      const parsed = parseRetentionSettings({
        [RETENTION_ENV.multipartAbortHours]: raw,
      });
      if (raw === "") expect(parsed.ok).toBe(true);
      else expect(parsed.ok).toBe(false);
    }
  });

  it("collects an issue per malformed knob", () => {
    const parsed = parseRetentionSettings({
      [RETENTION_ENV.inputTtlMinutes]: "0",
      [RETENTION_ENV.noncurrentVersionDays]: "99",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.map((i) => i.field).sort()).toEqual(
      [
        RETENTION_ENV.inputTtlMinutes,
        RETENTION_ENV.noncurrentVersionDays,
      ].sort(),
    );
  });
});

describe("resolveRetentionSettings — safe fallback", () => {
  it("degrades a malformed override to the safe defaults rather than throwing", () => {
    const settings = resolveRetentionSettings({
      [RETENTION_ENV.inputTtlMinutes]: "not-a-number",
    });
    expect(settings).toEqual(DEFAULT_RETENTION_SETTINGS);
  });

  it("applies a valid override", () => {
    const settings = resolveRetentionSettings({
      [RETENTION_ENV.artifactTtlMinutes]: "45",
    });
    expect(settings.artifactTtlMinutes).toBe(45);
  });
});
