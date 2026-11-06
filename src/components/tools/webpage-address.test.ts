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
    // A host with a port, or a host that is only a name or an IP, is an
    // address too: it gets the prefix, and the check then names the host.
    ["localhost:3000", "https://localhost:3000"],
    ["localhost", "https://localhost"],
    ["example.com:8080/a", "https://example.com:8080/a"],
    ["127.0.0.1:8000", "https://127.0.0.1:8000"],
    ["[::1]:8080/", "https://[::1]:8080/"],
    // Any other scheme, with or without "//", is left as typed, for the
    // check to refuse in words. (Review of d00e836d: "mailto:me@example.com"
    // used to gain the prefix and be refused for a user name and password.)
    ["ftp://example.com", "ftp://example.com"],
    ["mailto:me@example.com", "mailto:me@example.com"],
    ["tel:+1.555", "tel:+1.555"],
    ["javascript:void(0).x", "javascript:void(0).x"],
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

  /*
   * The two halves composed, as the panel calls them: what the user typed,
   * normalized, then explained. A unit table of either half alone cannot see
   * a prefix added to an address that should have been left alone.
   */
  it.each([
    ["mailto:me@example.com", /^Only http:\/\/ and https:\/\//],
    ["tel:+1.555", /^Only http:\/\/ and https:\/\//],
    ["javascript:void(0).x", /^Only http:\/\/ and https:\/\//],
    ["localhost:3000", /not on the public internet/],
    ["localhost", /not on the public internet/],
    ["127.0.0.1:8000", /not on the public internet/],
    ["[::1]:8080/", /not on the public internet/],
  ])("what the user typed, %j, is refused for what it is", (typed, reason) => {
    expect(webpageAddressProblem(normalizeWebpageAddress(typed))).toMatch(
      reason,
    );
  });

  it("a public host typed with a port, and no scheme, is sent", () => {
    expect(
      webpageAddressProblem(normalizeWebpageAddress("example.com:8080/a")),
    ).toBeNull();
  });
});
