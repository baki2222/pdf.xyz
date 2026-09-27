// @vitest-environment node
/**
 * Which header the client address comes from, and — the load-bearing one —
 * that the DEFAULT configuration still cannot tell two clients apart.
 *
 * The second test is the baseline Hermes measured on production with two real
 * vantages: the VPS was refused at request 121, and this machine's FIRST
 * request came back 429 because a different continent had spent the budget.
 * That is asserted here so the same fact is checkable without two machines,
 * and so it goes RED the moment identity starts separating clients — at which
 * point the allowance copy has to be re-strengthened too
 * (`allowance-copy.test.ts` is anchored to the same precondition).
 */
import { describe, expect, it } from "vitest";
import { SHARED_BUCKET_TOKEN, deriveClientToken } from "./identity";

const TRUSTED = {
  trustForwardedFor: true,
  keySalt: "test-shared-salt",
  clientIpHeader: "cf-connecting-ip",
};
const DEFAULT = { trustForwardedFor: false };

/**
 * Headers a client can write itself. None of them may move a request to a
 * different bucket when the operator has named a different one.
 */
const CLIENT_WRITABLE = [
  "x-vercel-forwarded-for",
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "fastly-client-ip",
];

describe("the client address, when the operator has granted trust", () => {
  /*
   * INVERTED 2026-09. This block used to open with:
   *
   *   it("prefers x-vercel-forwarded-for, which survives a proxy above the platform", …)
   *
   * pinning a fallback list (x-vercel-forwarded-for → x-forwarded-for →
   * x-real-ip, leftmost hop). The site is not on Vercel and nothing in front of
   * it strips that header, so any caller named their own bucket: on production
   * 130 requests with one spoofed value gave 120 × 400 + 10 × 429, and the next
   * spoofed value got a fresh budget. x-forwarded-for fell the same way.
   */
  it.each(CLIENT_WRITABLE)(
    "a spoofed %s cannot move a request to another bucket",
    (header) => {
      const real = { "cf-connecting-ip": "203.0.113.7" };
      const a = deriveClientToken(
        new Headers({ ...real, [header]: "198.51.100.91" }),
        TRUSTED,
      );
      const b = deriveClientToken(
        new Headers({ ...real, [header]: "198.51.100.92" }),
        TRUSTED,
      );
      expect(a).toBe(b);
      expect(a).toBe(deriveClientToken(new Headers(real), TRUSTED));
      // And alone, it earns nothing but the shared bucket.
      expect(
        deriveClientToken(new Headers({ [header]: "198.51.100.91" }), TRUSTED),
      ).toBe(SHARED_BUCKET_TOKEN);
    },
  );

  it("POSITIVE CONTROL: the configured header does separate clients", () => {
    const a = deriveClientToken(
      new Headers({ "cf-connecting-ip": "203.0.113.7" }),
      TRUSTED,
    );
    const b = deriveClientToken(
      new Headers({ "cf-connecting-ip": "198.51.100.42" }),
      TRUSTED,
    );
    expect(a).not.toBe(b);
    expect(a).not.toBe(SHARED_BUCKET_TOKEN);
    expect(b).not.toBe(SHARED_BUCKET_TOKEN);
    // Content-free by construction: the address never appears in the token.
    expect(a).not.toContain("203.0.113.7");
  });

  it("with trust on but no header named, every request shares one bucket", () => {
    const noHeader = { trustForwardedFor: true, keySalt: "test-shared-salt" };
    for (const header of [...CLIENT_WRITABLE, "cf-connecting-ip"])
      expect(
        deriveClientToken(new Headers({ [header]: "203.0.113.7" }), noHeader),
        header,
      ).toBe(SHARED_BUCKET_TOKEN);
  });

  it("refuses a list-shaped or non-address value instead of splitting it", () => {
    for (const value of [
      "198.51.100.9, 203.0.113.7",
      "unknown",
      "203.0.113.7:443",
      "",
    ])
      expect(
        deriveClientToken(new Headers({ "cf-connecting-ip": value }), TRUSTED),
        value,
      ).toBe(SHARED_BUCKET_TOKEN);
  });

  it("an IPv6 client is one client per /64, not 2^64 of them", () => {
    const tok = (ip: string) =>
      deriveClientToken(new Headers({ "cf-connecting-ip": ip }), TRUSTED);
    expect(tok("2001:4860:1:2::1")).toBe(tok("2001:4860:1:2:ffff:ee:dd:cc"));
    expect(tok("2001:4860:1:2::1")).not.toBe(tok("2001:4860:1:3::1"));
    expect(tok("::ffff:203.0.113.7")).toBe(tok("203.0.113.7"));
  });
});

describe("the default configuration, which is the live defect", () => {
  it("cannot tell two clients apart, whatever headers they send", () => {
    // Measured on production 2026-08-10 with two real vantages: the VPS was
    // refused at request 121; a second machine's FIRST request got 429.
    //
    // WHEN THIS GOES RED, identity has started separating clients — go
    // strengthen the allowance copy in the same change.
    const a = deriveClientToken(
      new Headers({ "x-forwarded-for": "203.0.113.7" }),
      DEFAULT,
    );
    const b = deriveClientToken(
      new Headers({ "x-vercel-forwarded-for": "198.51.100.42" }),
      DEFAULT,
    );
    expect(a).toBe(SHARED_BUCKET_TOKEN);
    expect(
      b,
      "identity now separates clients under the DEFAULT config — the allowance " +
        "copy and allowance-copy.test.ts must be updated in this same change",
    ).toBe(a);
  });
});
