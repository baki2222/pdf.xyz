// @vitest-environment node
/**
 * Proof for the artifact-manifest policy resolver: the shipped defaults, per-knob
 * bounded parsing, and fail-safe fallback (a malformed value never throws and never
 * disturbs another knob). Deterministic; env injected.
 */
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_ENV,
  DEFAULT_ARTIFACT_POLICY,
  resolveArtifactPolicy,
} from "./policy";

describe("resolveArtifactPolicy — defaults", () => {
  it("ships enabled with content-type + retention checks on and byte ceiling off", () => {
    expect(resolveArtifactPolicy({})).toEqual(DEFAULT_ARTIFACT_POLICY);
    expect(DEFAULT_ARTIFACT_POLICY.enabled).toBe(true);
    expect(DEFAULT_ARTIFACT_POLICY.maxBytes).toBe(0);
    expect(DEFAULT_ARTIFACT_POLICY.checkContentType).toBe(true);
    expect(DEFAULT_ARTIFACT_POLICY.requireRetentionClass).toBe(true);
  });
});

describe("resolveArtifactPolicy — master switch", () => {
  it("disables on a recognized OFF token", () => {
    for (const off of ["0", "false", "no", "off", "disabled"]) {
      expect(resolveArtifactPolicy({ [ARTIFACT_ENV.enabled]: off }).enabled).toBe(
        false,
      );
    }
  });

  it("keeps the default on an unrecognized value (a typo never flips it)", () => {
    expect(
      resolveArtifactPolicy({ [ARTIFACT_ENV.enabled]: "maybe" }).enabled,
    ).toBe(true);
  });
});

describe("resolveArtifactPolicy — bounded integer knobs", () => {
  it("accepts an in-range maxArtifacts / maxBytes", () => {
    const p = resolveArtifactPolicy({
      [ARTIFACT_ENV.maxArtifacts]: "8",
      [ARTIFACT_ENV.maxBytes]: "1048576",
    });
    expect(p.maxArtifacts).toBe(8);
    expect(p.maxBytes).toBe(1048576);
  });

  it("falls back to the default on a malformed or out-of-range value", () => {
    for (const bad of ["0", "-1", "1e6", "0x10", "1.5", "1kb", "abc"]) {
      // maxArtifacts min is 1, so "0"/"-1" are out of range too.
      expect(
        resolveArtifactPolicy({ [ARTIFACT_ENV.maxArtifacts]: bad }).maxArtifacts,
      ).toBe(DEFAULT_ARTIFACT_POLICY.maxArtifacts);
    }
    expect(
      resolveArtifactPolicy({ [ARTIFACT_ENV.maxBytes]: "9999999999999" }).maxBytes,
    ).toBe(DEFAULT_ARTIFACT_POLICY.maxBytes);
  });
});

describe("resolveArtifactPolicy — independent knobs", () => {
  it("resolves each flag independently; one malformed knob never disturbs another", () => {
    const p = resolveArtifactPolicy({
      [ARTIFACT_ENV.checkContentType]: "off",
      [ARTIFACT_ENV.requireRetentionClass]: "false",
      [ARTIFACT_ENV.maxArtifacts]: "not-a-number", // ignored → default
    });
    expect(p.checkContentType).toBe(false);
    expect(p.requireRetentionClass).toBe(false);
    expect(p.enabled).toBe(true); // untouched
    expect(p.maxArtifacts).toBe(DEFAULT_ARTIFACT_POLICY.maxArtifacts);
  });
});
