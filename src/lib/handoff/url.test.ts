import { describe, expect, it } from "vitest";
import { newHandoffId } from "./ids";
import { HANDOFF_PARAM, readHandoffId, stripHandoffFromUrl } from "./url";

describe("readHandoffId", () => {
  it("reads a well-formed token", () => {
    const id = newHandoffId();
    expect(readHandoffId(`?${HANDOFF_PARAM}=${id}`)).toBe(id);
  });

  it("returns null when the param is absent", () => {
    expect(readHandoffId("?foo=bar")).toBeNull();
    expect(readHandoffId("")).toBeNull();
  });

  it("rejects a malformed (non-token) value", () => {
    expect(readHandoffId(`?${HANDOFF_PARAM}=not-a-token`)).toBeNull();
    expect(readHandoffId(`?${HANDOFF_PARAM}=`)).toBeNull();
    // A prefix-only value is too short to be a real id.
    expect(readHandoffId(`?${HANDOFF_PARAM}=h_`)).toBeNull();
  });
});

describe("stripHandoffFromUrl", () => {
  it("removes the token while preserving path, other params, and hash", () => {
    const out = stripHandoffFromUrl(
      "https://pdf.xyz/tools/merge-pdf?keep=1&handoff=h_abc123def456&x=2#section",
    );
    expect(out).not.toContain("h_abc123def456");
    expect(out).not.toContain("handoff=");
    expect(out).toContain("keep=1");
    expect(out).toContain("x=2");
    expect(out).toContain("#section");
    expect(out.startsWith("https://pdf.xyz/tools/merge-pdf")).toBe(true);
  });

  it("collapses to a clean path when the token was the only param", () => {
    expect(
      stripHandoffFromUrl("https://pdf.xyz/tools/rotate-pdf?handoff=h_deadbeef00"),
    ).toBe("https://pdf.xyz/tools/rotate-pdf");
  });

  it("returns the input unchanged when there is no token", () => {
    const href = "https://pdf.xyz/tools/merge-pdf?keep=1";
    // Identity is preserved so the caller can skip a needless history rewrite.
    expect(stripHandoffFromUrl(href)).toBe(href);
  });

  it("never throws on an unparseable input", () => {
    expect(stripHandoffFromUrl("not a url")).toBe("not a url");
  });
});
