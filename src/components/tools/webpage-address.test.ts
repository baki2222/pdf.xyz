import { describe, expect, it } from "vitest";
import { isSafePublicHttpUrl } from "@/lib/jobs/validation";
import {
  collapseRepeatedScheme,
  normalizeWebpageAddress,
  webpageAddressProblem,
} from "./webpage-address";

describe("normalizeWebpageAddress", () => {
  it.each([
    ["https://https://example.com/page", "https://example.com/page"],
    ["https://http://example.com", "http://example.com"],
    ["HTTPS://https://https://example.com", "https://example.com"],
    ["  example.com  ", "https://example.com"],
    ["www.example.com/a?b=1#c", "https://www.example.com/a?b=1#c"],
    ["https://example.com", "https://example.com"],
    ["http://example.com", "http://example.com"],
    // Left as typed, for the check to refuse in words.
    ["ftp://example.com", "ftp://example.com"],
    ["localhost:3000", "localhost:3000"],
    ["not an address", "not an address"],
    ["", ""],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeWebpageAddress(raw)).toBe(expected);
  });

  it("collapses a doubled scheme while the user is still typing", () => {
    expect(collapseRepeatedScheme("https://https://")).toBe("https://");
    expect(collapseRepeatedScheme("https://exa")).toBe("https://exa");
    expect(collapseRepeatedScheme("https://")).toBe("https://");
  });
});

describe("webpageAddressProblem", () => {
  /*
   * The RELATIONSHIP, not strings: the field says "fine" exactly when the
   * server's `isSafePublicHttpUrl` accepts the address. The corpus holds
   * both verdicts (positive controls), and its size is bounded so a corpus
   * that quietly shrinks cannot pass on nothing.
   */
  const CORPUS = [
    "https://example.com",
    "http://example.com/a/b?c=1",
    "https://www.example.co.uk/",
    "https://93.184.215.14/",
    "https://bücher.de/",
    "https://https://example.com",
    "https://localhost/",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "https://intranet/",
    "https://printer.local/",
    "https://user:pw@example.com/",
    "ftp://example.com/",
    "javascript:alert(1)",
    "not an address",
    "",
    "https://",
  ];

  it("agrees with the server's check on every address", () => {
    const accepted = CORPUS.filter(isSafePublicHttpUrl);
    expect(accepted.length).toBeGreaterThanOrEqual(4);
    expect(CORPUS.length - accepted.length).toBeGreaterThanOrEqual(10);
    for (const address of CORPUS)
      expect(webpageAddressProblem(address) === null, address).toBe(
        isSafePublicHttpUrl(address),
      );
  });

  it("speaks plainly: no API field names, no backticks", () => {
    for (const address of CORPUS) {
      const problem = webpageAddressProblem(address);
      if (problem) expect(problem, address).not.toMatch(/`|options\.url/);
    }
  });

  it("names the actual problem", () => {
    expect(webpageAddressProblem("https://")).toBe(
      "Type the page's address first.",
    );
    expect(webpageAddressProblem("http://localhost:3000/")).toMatch(
      /not on the public internet/,
    );
    expect(webpageAddressProblem("http://10.1.2.3/")).toMatch(
      /not on the public internet/,
    );
    expect(webpageAddressProblem("https://exa")).toMatch(/full address/);
    expect(webpageAddressProblem("https://user:pw@example.com/")).toMatch(
      /user name and password/,
    );
    expect(webpageAddressProblem("ftp://example.com/")).toMatch(/Only http/);
  });
});
