// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_ENV,
  parseLifecycleConfig,
  resolveLifecycleReadiness,
} from "./config";

describe("resolveLifecycleReadiness — states", () => {
  it("is unknown when nothing is declared", () => {
    const r = resolveLifecycleReadiness({});
    expect(r.state).toBe("unknown");
    expect(r.provider).toBeNull();
    expect(r.versioned).toBeNull();
    expect(r.detail).toMatch(/unknown/i);
  });

  it("is declared when a provider is set but not asserted validated", () => {
    const r = resolveLifecycleReadiness({
      [LIFECYCLE_ENV.provider]: "aws-s3",
    });
    expect(r.state).toBe("declared");
    expect(r.provider).toBe("aws-s3");
    expect(r.detail).toMatch(/not asserted as verified|not.*validated/i);
  });

  it("is validated only when the operator asserts it", () => {
    const r = resolveLifecycleReadiness({
      [LIFECYCLE_ENV.provider]: "minio",
      [LIFECYCLE_ENV.validated]: "true",
      [LIFECYCLE_ENV.versioned]: "true",
    });
    expect(r.state).toBe("validated");
    expect(r.provider).toBe("minio");
    expect(r.versioned).toBe(true);
  });

  it("is invalid on an unknown provider", () => {
    const r = resolveLifecycleReadiness({
      [LIFECYCLE_ENV.provider]: "dropbox",
    });
    expect(r.state).toBe("invalid");
    expect(r.provider).toBeNull();
  });

  it("is invalid on a malformed boolean flag", () => {
    const r = resolveLifecycleReadiness({
      [LIFECYCLE_ENV.provider]: "aws-s3",
      [LIFECYCLE_ENV.validated]: "sometimes",
    });
    expect(r.state).toBe("invalid");
  });
});

describe("parseLifecycleConfig", () => {
  it("reports not-selected on an empty environment", () => {
    const parsed = parseLifecycleConfig({});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.selected).toBe(false);
    expect(parsed.issues).toEqual([]);
  });

  it("names the offending variable on a bad provider (never the value)", () => {
    const parsed = parseLifecycleConfig({
      [LIFECYCLE_ENV.provider]: "dropbox",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.selected).toBe(true);
    expect(parsed.issues[0]!.field).toBe(LIFECYCLE_ENV.provider);
    expect(parsed.issues[0]!.message).not.toContain("dropbox");
  });

  it("parses a fully-valid declaration", () => {
    const parsed = parseLifecycleConfig({
      [LIFECYCLE_ENV.provider]: "cloudflare-r2",
      [LIFECYCLE_ENV.validated]: "1",
      [LIFECYCLE_ENV.versioned]: "off",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.config).toEqual({
      provider: "cloudflare-r2",
      validated: true,
      versioned: false,
    });
  });
});

describe("resolveLifecycleReadiness — content-free", () => {
  it("never claims rules are in force merely because a provider is declared", () => {
    const r = resolveLifecycleReadiness({ [LIFECYCLE_ENV.provider]: "aws-s3" });
    // "declared" must not read as "applied/verified".
    expect(r.state).not.toBe("validated");
    expect(JSON.stringify(r)).not.toMatch(/PDFXYZ_/);
  });
});
