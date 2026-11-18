import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EXTRACTION_FIELD_TYPES,
  EXTRACTION_MODES,
  type ExtractionFieldType,
  type ExtractionMode,
  MAX_EXTRACTION_FIELDS,
  MAX_EXTRACTION_PROMPT_CHARS,
  MAX_FIELD_DESCRIPTION_CHARS,
  MAX_FIELD_NAME_CHARS,
  describeExtractRequest,
  extractionOutputName,
} from "./ai-extract";
import { parseExtractOptions } from "./ai-extract-options";

/**
 * The vocabularies are spelled twice since 2026-11-17: as types beside the
 * parser (`./ai-extract-options`, where `/privacy`'s options walk reads them)
 * and as the tables the panel draws (`./ai-extract`, kept out of the parser's
 * module so the panel's first load does not carry the parser). The tables
 * `satisfies` the types (no stray word); these hold the other direction, at
 * compile time (tsc) and at run time.
 */
describe("the field-type and mode tables are exactly the types", () => {
  it("each table lists every member of its type, and nothing else", () => {
    expectTypeOf<
      (typeof EXTRACTION_FIELD_TYPES)[number]
    >().toEqualTypeOf<ExtractionFieldType>();
    expectTypeOf<
      (typeof EXTRACTION_MODES)[number]
    >().toEqualTypeOf<ExtractionMode>();
    expect(new Set(EXTRACTION_FIELD_TYPES).size).toBe(
      EXTRACTION_FIELD_TYPES.length,
    );
    expect([...EXTRACTION_MODES]).toEqual(["prompt", "schema"]);
  });
});

describe("parseExtractOptions — mode", () => {
  it("rejects a non-object options bag", () => {
    // @ts-expect-error deliberately wrong type
    expect(parseExtractOptions([]).ok).toBe(false);
  });

  it("requires a mode (never guesses one)", () => {
    const r = parseExtractOptions({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("mode");
  });

  it("rejects an unknown mode (never coerces)", () => {
    const r = parseExtractOptions({ mode: "magic" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("mode");
  });
});

describe("parseExtractOptions — prompt mode", () => {
  it("accepts a bounded free-text extraction prompt", () => {
    const r = parseExtractOptions({
      mode: "prompt",
      prompt: "Extract the invoice number and total.",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe("prompt");
      expect(r.value.prompt).toBe("Extract the invoice number and total.");
      expect(r.value.schema).toBeUndefined();
    }
  });

  it("requires a prompt when mode is prompt (never runs an aimless extraction)", () => {
    const r = parseExtractOptions({ mode: "prompt" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("prompt");
  });

  it("rejects an all-whitespace prompt", () => {
    const r = parseExtractOptions({ mode: "prompt", prompt: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.body.error.details?.[0]?.field).toBe("prompt");
  });

  it("allows newlines/tabs in the prompt but rejects other control characters", () => {
    const ok = parseExtractOptions({
      mode: "prompt",
      prompt: "Line one\n\tLine two",
    });
    expect(ok.ok).toBe(true);
    const bad = parseExtractOptions({
      mode: "prompt",
      prompt: `a${String.fromCharCode(7)}b`,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.error.body.error.details?.[0]?.field).toBe("prompt");
  });

  it("rejects an over-long prompt", () => {
    const r = parseExtractOptions({
      mode: "prompt",
      prompt: "x".repeat(MAX_EXTRACTION_PROMPT_CHARS + 1),
    });
    expect(r.ok).toBe(false);
  });
});

describe("parseExtractOptions — schema mode", () => {
  it("accepts a list of typed fields", () => {
    const r = parseExtractOptions({
      mode: "schema",
      schema: [
        { name: "invoice_number", type: "string" },
        { name: "total", type: "number", description: "grand total incl. tax" },
        { name: "paid", type: "boolean" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe("schema");
      expect(r.value.schema).toHaveLength(3);
      expect(r.value.schema?.[1]).toEqual({
        name: "total",
        type: "number",
        description: "grand total incl. tax",
      });
      expect(r.value.prompt).toBeUndefined();
    }
  });

  it("requires a non-empty schema when mode is schema", () => {
    const empty = parseExtractOptions({ mode: "schema", schema: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok)
      expect(empty.error.body.error.details?.[0]?.field).toBe("schema");
    const missing = parseExtractOptions({ mode: "schema" });
    expect(missing.ok).toBe(false);
  });

  it("names every supported field type", () => {
    expect([...EXTRACTION_FIELD_TYPES]).toEqual([
      "string",
      "number",
      "boolean",
      "date",
      "array",
    ]);
  });

  it("defaults a field type to string when omitted", () => {
    const r = parseExtractOptions({
      mode: "schema",
      schema: [{ name: "vendor" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.schema?.[0]).toEqual({ name: "vendor", type: "string" });
  });

  it("rejects an unknown field type", () => {
    const r = parseExtractOptions({
      mode: "schema",
      schema: [{ name: "x", type: "money" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.body.error.details?.[0]?.field).toContain("schema");
  });

  it("rejects a field with a missing/empty name", () => {
    expect(
      parseExtractOptions({ mode: "schema", schema: [{ type: "string" }] }).ok,
    ).toBe(false);
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: [{ name: "  ", type: "string" }],
      }).ok,
    ).toBe(false);
  });

  it("rejects a control character in a field name or description", () => {
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: [{ name: `a${String.fromCharCode(0)}b`, type: "string" }],
      }).ok,
    ).toBe(false);
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: [
          {
            name: "ok",
            type: "string",
            description: `d${String.fromCharCode(7)}e`,
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects duplicate field names (case-insensitive)", () => {
    const r = parseExtractOptions({
      mode: "schema",
      schema: [
        { name: "Total", type: "number" },
        { name: "total", type: "string" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long field name or description", () => {
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: [
          { name: "x".repeat(MAX_FIELD_NAME_CHARS + 1), type: "string" },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseExtractOptions({
        mode: "schema",
        schema: [
          {
            name: "x",
            type: "string",
            description: "y".repeat(MAX_FIELD_DESCRIPTION_CHARS + 1),
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects too many fields", () => {
    const schema = Array.from(
      { length: MAX_EXTRACTION_FIELDS + 1 },
      (_, i) => ({ name: `f${i}`, type: "string" }),
    );
    expect(parseExtractOptions({ mode: "schema", schema }).ok).toBe(false);
  });
});

describe("describeExtractRequest", () => {
  it("renders human copy for the UI", () => {
    expect(
      describeExtractRequest({ mode: "prompt", prompt: "Extract totals" }),
    ).toMatch(/prompt/i);
    expect(
      describeExtractRequest({
        mode: "schema",
        schema: [
          { name: "a", type: "string" },
          { name: "b", type: "number" },
        ],
      }),
    ).toMatch(/2 fields/i);
  });
});

describe("extractionOutputName", () => {
  it("derives a -extraction.zip name from the source PDF", () => {
    expect(extractionOutputName("Invoice 42.pdf")).toBe(
      "Invoice 42-extraction.zip",
    );
  });

  it("falls back to a neutral stem for unusable names", () => {
    expect(extractionOutputName(null)).toBe("document-extraction.zip");
  });
});
