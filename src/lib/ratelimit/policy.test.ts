import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/jobs";
import { allPolicies, policyFor, RATE_LIMIT_POLICIES } from "./policy";
import { RATE_LIMIT_ACTIONS } from "./types";

describe("rate-limit policies", () => {
  it("defines exactly one policy per action, with a matching id", () => {
    for (const action of RATE_LIMIT_ACTIONS) {
      const policy = policyFor(action);
      expect(policy.action).toBe(action);
      expect(policy.id).toBe(action);
    }
    expect(Object.keys(RATE_LIMIT_POLICIES).sort()).toEqual(
      [...RATE_LIMIT_ACTIONS].sort(),
    );
  });

  it("uses strictly positive limits and windows", () => {
    for (const policy of allPolicies()) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowSeconds).toBeGreaterThan(0);
      expect(Number.isInteger(policy.limit)).toBe(true);
      expect(Number.isInteger(policy.windowSeconds)).toBe(true);
    }
  });

  it("reuses the published contract numbers so the guard and docs cannot drift", () => {
    expect(policyFor("uploads.create").limit).toBe(RATE_LIMITS.uploadsPerHourPerClient);
    expect(policyFor("uploads.create").windowSeconds).toBe(3600);
    expect(policyFor("jobs.create").limit).toBe(RATE_LIMITS.jobsPerHourPerClient);
    expect(policyFor("jobs.status").limit).toBe(
      RATE_LIMITS.statusRequestsPerMinutePerClient,
    );
    expect(policyFor("jobs.status").windowSeconds).toBe(60);
  });

  it("enumerates every policy in the stable action order", () => {
    expect(allPolicies().map((p) => p.action)).toEqual([...RATE_LIMIT_ACTIONS]);
  });

  it("carries only content-free labels (no identity anywhere in the table)", () => {
    const serialized = JSON.stringify(RATE_LIMIT_POLICIES);
    // A policy is a route capability + a budget — never a caller, path, or secret.
    expect(serialized).not.toMatch(/ip|token|filename|cookie|authorization/i);
  });
});
