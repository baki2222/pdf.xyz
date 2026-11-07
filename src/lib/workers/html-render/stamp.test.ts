import { describe, expect, it } from "vitest";
import { stampDate, stampFooterTemplate, stampText } from "./stamp";

describe("the address-and-date stamp (audit webpage-to-pdf#7)", () => {
  const at = new Date(Date.UTC(2026, 10, 8, 4, 7, 59));

  it("states the time in UTC, whatever the worker's zone, with the month named", () => {
    expect(stampDate(at)).toBe("8 November 2026, 04:07 UTC");
    expect(stampDate(new Date(Date.UTC(2027, 0, 31, 23, 59)))).toBe(
      "31 January 2027, 23:59 UTC",
    );
  });

  it("names the address asked for", () => {
    expect(stampText("https://example.com/terms?x=1", at)).toBe(
      "Captured from https://example.com/terms?x=1 on 8 November 2026, 04:07 UTC",
    );
  });

  it("puts the address in the footer as text, never as markup", () => {
    const footer = stampFooterTemplate(
      'https://example.com/a?<img src=x onerror="y">&b',
      at,
    );
    expect(footer).not.toContain("<img");
    expect(footer).toContain("&lt;img src=x onerror=&quot;y&quot;&gt;&amp;b");
    // Chromium fills elements with these class names; the stamp has none.
    expect(footer).not.toMatch(/class=/);
  });
});
