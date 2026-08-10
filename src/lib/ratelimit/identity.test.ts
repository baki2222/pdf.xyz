// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";

const trusted = { trustForwardedFor: true } as const;
const untrusted = { trustForwardedFor: false } as const;

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("deriveClientToken", () => {
  it("uses one shared bucket when the forwarding header is untrusted", () => {
    // Even with a forwarded address present, an untrusted proxy is never believed.
    const token = deriveClientToken(
      headers({ "x-forwarded-for": "203.0.113.1" }),
      untrusted,
    );
    expect(token).toBe(SHARED_BUCKET_TOKEN);
  });

  it("falls back to the shared bucket when trusted but no address is present", () => {
    expect(deriveClientToken(headers(), trusted)).toBe(SHARED_BUCKET_TOKEN);
  });

  it("derives an opaque, address-free token when trusted", () => {
    const address = "203.0.113.7";
    const token = deriveClientToken(
      headers({ "x-forwarded-for": address }),
      trusted,
    );
    expect(token).not.toBe(SHARED_BUCKET_TOKEN);
    expect(token.startsWith("c_")).toBe(true);
    // The token never contains the raw address — it is a salted hash.
    expect(token).not.toContain(address);
  });

  it("is stable for the same address and distinct for different ones", () => {
    const a1 = deriveClientToken(
      headers({ "x-forwarded-for": "198.51.100.4" }),
      trusted,
    );
    const a2 = deriveClientToken(
      headers({ "x-forwarded-for": "198.51.100.4" }),
      trusted,
    );
    const b = deriveClientToken(
      headers({ "x-forwarded-for": "198.51.100.5" }),
      trusted,
    );
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("reads the leftmost hop of a forwarded-for list", () => {
    const viaList = deriveClientToken(
      headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1, 10.0.0.2" }),
      trusted,
    );
    const direct = deriveClientToken(
      headers({ "x-forwarded-for": "198.51.100.9" }),
      trusted,
    );
    expect(viaList).toBe(direct);
  });

  it("falls back to x-real-ip when no forwarded-for is present", () => {
    const token = deriveClientToken(
      headers({ "x-real-ip": "192.0.2.44" }),
      trusted,
    );
    expect(token.startsWith("c_")).toBe(true);
    expect(token).not.toContain("192.0.2.44");
  });
});
