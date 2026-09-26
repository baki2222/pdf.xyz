// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";

const trusted = {
  trustForwardedFor: true,
  keySalt: "test-shared-salt",
  clientIpHeader: "cf-connecting-ip",
} as const;
const untrusted = { trustForwardedFor: false } as const;

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("deriveClientToken", () => {
  it("uses one shared bucket when the forwarding header is untrusted", () => {
    // Even with a forwarded address present, an untrusted proxy is never believed.
    const token = deriveClientToken(
      headers({ "cf-connecting-ip": "203.0.113.1" }),
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
      headers({ "cf-connecting-ip": address }),
      trusted,
    );
    expect(token).not.toBe(SHARED_BUCKET_TOKEN);
    expect(token.startsWith("c_")).toBe(true);
    // The token never contains the raw address — it is a salted hash.
    expect(token).not.toContain(address);
  });

  it("is stable for the same address and distinct for different ones", () => {
    const a1 = deriveClientToken(
      headers({ "cf-connecting-ip": "198.51.100.4" }),
      trusted,
    );
    const a2 = deriveClientToken(
      headers({ "cf-connecting-ip": "198.51.100.4" }),
      trusted,
    );
    const b = deriveClientToken(
      headers({ "cf-connecting-ip": "198.51.100.5" }),
      trusted,
    );
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  // INVERTED 2026-09: this used to assert that the LEFTMOST hop of an
  // x-forwarded-for list was the client, and the next test that x-real-ip was a
  // fallback. The leftmost hop is whatever the client wrote; a fallback is a
  // second header to spoof. Both are refused now.
  it("refuses a forwarding list rather than believing its first entry", () => {
    expect(
      deriveClientToken(
        headers({ "cf-connecting-ip": "198.51.100.9, 10.0.0.1, 10.0.0.2" }),
        trusted,
      ),
    ).toBe(SHARED_BUCKET_TOKEN);
  });

  it("does not fall back to another header when the named one is absent", () => {
    expect(
      deriveClientToken(
        headers({ "x-real-ip": "192.0.2.44", "x-forwarded-for": "192.0.2.45" }),
        trusted,
      ),
    ).toBe(SHARED_BUCKET_TOKEN);
  });
});
