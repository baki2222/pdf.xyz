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

const TRUSTED = { trustForwardedFor: true };
const DEFAULT = { trustForwardedFor: false };

describe("the client address, when the operator has granted trust", () => {
  it("prefers x-vercel-forwarded-for, which survives a proxy above the platform", () => {
    // Vercel documents plain x-forwarded-for as overwritable by a proxy layered
    // on top of it, and the vendor-scoped spelling as identical otherwise.
    const token = deriveClientToken(
      new Headers({
        "x-vercel-forwarded-for": "203.0.113.7",
        "x-forwarded-for": "10.0.0.1",
        "x-real-ip": "10.0.0.2",
      }),
      TRUSTED,
    );
    const expected = deriveClientToken(
      new Headers({ "x-vercel-forwarded-for": "203.0.113.7" }),
      TRUSTED,
    );
    expect(token).toBe(expected);
  });

  it("falls back to x-forwarded-for, then x-real-ip", () => {
    const viaForwarded = deriveClientToken(
      new Headers({
        "x-forwarded-for": "203.0.113.7",
        "x-real-ip": "10.0.0.2",
      }),
      TRUSTED,
    );
    expect(viaForwarded).toBe(
      deriveClientToken(
        new Headers({ "x-forwarded-for": "203.0.113.7" }),
        TRUSTED,
      ),
    );
    const viaRealIp = deriveClientToken(
      new Headers({ "x-real-ip": "203.0.113.9" }),
      TRUSTED,
    );
    expect(viaRealIp).not.toBe(SHARED_BUCKET_TOKEN);
    expect(viaRealIp).not.toBe(viaForwarded);
  });

  it("takes the origin client from the head of a forwarding chain", () => {
    const chained = deriveClientToken(
      new Headers({
        "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178",
      }),
      TRUSTED,
    );
    expect(chained).toBe(
      deriveClientToken(
        new Headers({ "x-forwarded-for": "203.0.113.7" }),
        TRUSTED,
      ),
    );
  });

  it("separates two different clients", () => {
    const a = deriveClientToken(
      new Headers({ "x-forwarded-for": "203.0.113.7" }),
      TRUSTED,
    );
    const b = deriveClientToken(
      new Headers({ "x-forwarded-for": "198.51.100.42" }),
      TRUSTED,
    );
    expect(a).not.toBe(b);
    expect(a).not.toBe(SHARED_BUCKET_TOKEN);
    expect(b).not.toBe(SHARED_BUCKET_TOKEN);
    // Content-free by construction: the address never appears in the token.
    expect(a).not.toContain("203.0.113.7");
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
