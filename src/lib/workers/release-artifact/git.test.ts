/**
 * Proof that the git provenance reducer bounds every untrusted raw fact to an enum, never echoes a
 * raw branch name / remote / hostile commit, and stays honest about unknowns.
 */

import { describe, expect, it } from "vitest";
import {
  boundCommit,
  classifyRef,
  cleanlinessFrom,
  reduceGitProvenance,
  UNKNOWN_GIT_PROVENANCE,
  type RawGitFacts,
} from "./git";

describe("classifyRef", () => {
  it("classifies mainline refs as default (with or without a remote prefix)", () => {
    expect(classifyRef("main", false)).toBe("default");
    expect(classifyRef("master", false)).toBe("default");
    expect(classifyRef("origin/main", false)).toBe("default");
  });

  it("classifies release branches and version tags as release", () => {
    expect(classifyRef("release/2.0", false)).toBe("release");
    expect(classifyRef("hotfix/urgent-1", false)).toBe("release");
    expect(classifyRef("v1.2.3", false)).toBe("release");
    expect(classifyRef("v10.0", false)).toBe("release");
    expect(classifyRef("origin/release/2.0", false)).toBe("release");
  });

  it("classifies any other branch as topic", () => {
    expect(classifyRef("phase-47-release-evidence", false)).toBe("topic");
    expect(classifyRef("feature/foo", false)).toBe("topic");
  });

  it("classifies a detached HEAD as detached (flag or literal HEAD)", () => {
    expect(classifyRef("HEAD", false)).toBe("detached");
    expect(classifyRef("anything", true)).toBe("detached");
  });

  it("is unknown for absent/empty refs", () => {
    expect(classifyRef(undefined, undefined)).toBe("unknown");
    expect(classifyRef("", false)).toBe("unknown");
    expect(classifyRef("   ", false)).toBe("unknown");
  });

  it("classifies a hostile ref into a bounded class and never returns the raw text", () => {
    const hostile = "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef";
    // A slash-bearing hostile name is not default/release-shaped ⇒ topic (a bounded token).
    expect(classifyRef(hostile, false)).toBe("topic");
  });
});

describe("boundCommit", () => {
  it("accepts a well-formed abbreviated hash and caps it to 12 chars", () => {
    expect(boundCommit("27a5555fd3e3")).toBe("27a5555fd3e3");
    expect(boundCommit("27a5555")).toBe("27a5555");
    expect(boundCommit("27a5555fd3e3deadbeef00112233445566778899")).toBe("27a5555fd3e3");
  });

  it("lowercases an uppercase hex hash", () => {
    expect(boundCommit("ABCDEF1234567890")).toBe("abcdef123456");
  });

  it("rejects anything that is not a 7–40 char hex object id", () => {
    expect(boundCommit("abc")).toBeNull(); // too short
    expect(boundCommit("a".repeat(41))).toBeNull(); // too long
    expect(boundCommit("/tmp/secret.pdf")).toBeNull();
    expect(boundCommit("s3://bucket/key")).toBeNull();
    expect(boundCommit("not-hex-zzzzzz")).toBeNull();
    expect(boundCommit(undefined)).toBeNull();
    expect(boundCommit("")).toBeNull();
  });
});

describe("cleanlinessFrom", () => {
  it("maps the tri-state honestly", () => {
    expect(cleanlinessFrom(true)).toBe("dirty");
    expect(cleanlinessFrom(false)).toBe("clean");
    expect(cleanlinessFrom(undefined)).toBe("unknown");
  });
});

describe("reduceGitProvenance", () => {
  it("reduces a full fact set to bounded enums + a validated commit", () => {
    const facts: RawGitFacts = { commit: "27a5555fd3e3", ref: "main", dirty: false, detached: false };
    expect(reduceGitProvenance(facts)).toEqual({
      cleanliness: "clean",
      refClass: "default",
      commit: "27a5555fd3e3",
      commitPresent: true,
    });
  });

  it("yields fully-unknown provenance for null/undefined/empty facts", () => {
    expect(reduceGitProvenance(null)).toEqual(UNKNOWN_GIT_PROVENANCE);
    expect(reduceGitProvenance(undefined)).toEqual(UNKNOWN_GIT_PROVENANCE);
    expect(reduceGitProvenance({})).toEqual(UNKNOWN_GIT_PROVENANCE);
  });

  it("never lets a hostile raw ref/commit survive into the output", () => {
    const facts: RawGitFacts = {
      commit: "AKIAIOSFODNN7EXAMPLE",
      ref: "https://acct.r2.cloudflarestorage.com/obj?token~h_abc123",
      dirty: true,
    };
    const p = reduceGitProvenance(facts);
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("cloudflarestorage");
    expect(serialized).not.toContain("token~");
    expect(p.commit).toBeNull(); // the AKIA string is not a hex object id
    expect(p.refClass).toBe("topic"); // the URL is bounded to a class
    expect(p.cleanliness).toBe("dirty");
  });
});
