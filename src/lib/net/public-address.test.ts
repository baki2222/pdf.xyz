import { describe, expect, it } from "vitest";
import {
  BLOCKED_IPV4_RANGES,
  BLOCKED_IPV6_RANGES,
  blockedRangeFor,
  isInternalHostname,
  isPublicIpAddress,
  normalizeHost,
  parseIpv4,
  parseIpv6,
} from "./public-address";
import { MUST_ALLOW, MUST_BLOCK } from "./public-address.corpus";

describe("public-address classifier", () => {
  it.each(MUST_BLOCK)("refuses %s", (addr) => {
    expect(isPublicIpAddress(addr)).toBe(false);
  });

  it.each(MUST_ALLOW)("allows public %s", (addr) => {
    expect(blockedRangeFor(addr)).toBeNull();
  });

  it("every blocked range refuses at least one corpus address", () => {
    const tables = [...BLOCKED_IPV4_RANGES, ...BLOCKED_IPV6_RANGES];
    // Health check: a table that shrank to nothing would make this vacuous.
    expect(tables.length).toBeGreaterThanOrEqual(19);
    const hit = new Set(
      MUST_BLOCK.map((a) => blockedRangeFor(a)?.cidr).filter(Boolean),
    );
    const unexercised = tables.map((r) => r.cidr).filter((c) => !hit.has(c));
    expect(unexercised).toEqual([]);
  });

  it("parses the spellings a URL parser and a resolver emit", () => {
    expect(parseIpv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIpv4("256.0.0.1")).toBeNull();
    expect(parseIpv4("1.2.3")).toBeNull();
    expect(parseIpv6("::1")).toBe(1n);
    expect(parseIpv6("[::ffff:7f00:1]")).toBe(parseIpv6("::ffff:127.0.0.1"));
    expect(parseIpv6("1:2:3:4:5:6:7:8")).not.toBeNull();
    expect(parseIpv6("1::2::3")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:8::")).toBeNull();
    expect(parseIpv6("fe80::1%eth0")).toBeNull();
    expect(isPublicIpAddress("not-an-ip")).toBe(false);
  });

  it("names that only resolve inside the worker's network are internal", () => {
    for (const host of [
      "localhost",
      "localhost.",
      "LOCALHOST..",
      "api.localhost",
      "printer.local",
      "metadata.google.internal",
      "metadata",
      "router.home.arpa",
      "x.invalid",
      "[::1]",
      "127.0.0.1",
      "",
    ])
      expect(isInternalHostname(host), host).toBe(true);
    for (const host of [
      "example.com",
      "example.com.",
      "1.1.1.1",
      "[2606:4700::1111]",
    ])
      expect(isInternalHostname(host), host).toBe(false);
    expect(normalizeHost("[FD00::1]")).toBe("fd00::1");
  });
});
