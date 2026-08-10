import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  describeSummarizeRequest,
  parseSummarizeOptions,
  summaryOutputName,
} from "./summarize-pdf";

describe("parseSummarizeOptions", () => {
  it("defaults an empty bag to a standard paragraph summary", () => {
    const r = parseSummarizeOptions({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBe(DEFAULT_SUMMARY_LENGTH);
      expect(r.value.format).toBe(DEFAULT_SUMMARY_FORMAT);
      expect(r.value.focus).toBeUndefined();
    }
  });

  it("accepts valid length/format/focus", () => {
    const r = parseSummarizeOptions({
      length: "detailed",
      format: "bullets",
      focus: "financial risks",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        length: "detailed",
        format: "bullets",
        focus: "financial risks",
      });
    }
  });

  it("rejects an unknown length (never coerces)", () => {
    const r = parseSummarizeOptions({ length: "epic" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("length");
  });

  it("rejects an unknown format", () => {
    const r = parseSummarizeOptions({ format: "haiku" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("format");
  });

  it("drops an all-whitespace focus rather than storing it", () => {
    const r = parseSummarizeOptions({ focus: "   " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.focus).toBeUndefined();
  });

  it("rejects a control character in focus", () => {
    const r = parseSummarizeOptions({ focus: "a\u0007b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("focus");
  });

  it("rejects an over-long focus", () => {
    const r = parseSummarizeOptions({
      focus: "x".repeat(MAX_SUMMARY_FOCUS_CHARS + 1),
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-object options bag", () => {
    // @ts-expect-error deliberately wrong type
    expect(parseSummarizeOptions([]).ok).toBe(false);
  });
});

describe("describeSummarizeRequest", () => {
  it("renders human copy for the UI", () => {
    expect(
      describeSummarizeRequest({ length: "brief", format: "outline" }),
    ).toBe("Brief summary as a section outline");
  });
});

describe("summaryOutputName", () => {
  it("derives a -summary.zip name from the source PDF", () => {
    expect(summaryOutputName("Q3 Report.pdf")).toBe("Q3 Report-summary.zip");
  });

  it("falls back to a neutral stem for unusable names", () => {
    expect(summaryOutputName(null)).toBe("document-summary.zip");
  });
});
