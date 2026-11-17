// @vitest-environment node
/**
 * AI Data Extraction's saved schemas (competitor audit #16): the bounds, the
 * one validator, hostile files and broken storage.
 *
 * THE ONE-VALIDATOR PROPERTY is checked as a relationship, not as a list of
 * messages: over a corpus of field lists — every way the job contract
 * refuses one, and lists it accepts — a schema is made exactly when
 * `parseExtractOptions` (what the route and the worker run) accepts the same
 * list, and a refusal says the contract's own sentence. A second, looser
 * check would make the two sets differ.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_EXTRACTION_FIELDS,
  MAX_FIELD_DESCRIPTION_CHARS,
  MAX_FIELD_NAME_CHARS,
  type ExtractionField,
} from "./ai-extract";
import { parseExtractOptions } from "./ai-extract-options";
import {
  MAX_SAVED_SCHEMAS,
  MAX_SCHEMA_FILE_BYTES,
  MAX_SCHEMA_NAME_CHARS,
  SAVED_SCHEMAS_KEY,
  SCHEMA_FILE_FORMAT,
  SCHEMA_FILE_VERSION,
  deleteSchema,
  parseSchemaFile,
  readSavedSchemas,
  saveSchema,
  schemaFileName,
  schemaFileText,
  schemaFileTooLarge,
  schemaFromFields,
  storageWorks,
  writeSavedSchemas,
  type SavedSchema,
} from "./ai-extract-schemas";

/** A Map-backed Storage; `quota` throws on setItem past that many chars. */
function memoryStorage(
  quota = Infinity,
): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => {
      if (v.length > quota) throw new Error("QuotaExceededError");
      map.set(k, String(v));
    },
  };
}

/** A Storage whose every method throws, as blocked site data does. */
const blocked: Storage = new Proxy({} as Storage, {
  get() {
    throw new Error("SecurityError");
  },
});

const CTRL = String.fromCharCode(7);
/** A three-byte UTF-8 character (U+4E2D), the most bytes per UTF-16 unit. */
const WIDE = String.fromCodePoint(0x4e2d);

const invoice: ExtractionField[] = [
  { name: "invoice_number", type: "string" },
  { name: "total", type: "number", description: "grand total incl. VAT" },
  { name: "due", type: "date" },
];
const schema = (name: string, fields = invoice): SavedSchema => ({
  name,
  fields,
});
const fileOf = (value: unknown) => JSON.stringify(value);
const header = { format: SCHEMA_FILE_FORMAT, version: SCHEMA_FILE_VERSION };

describe("one validator: a schema is exactly a field list a job accepts", () => {
  const corpus: unknown[][] = [
    invoice,
    [{ name: "a", type: "boolean" }],
    [{ name: " padded ", type: "array", description: "  hint  " }],
    [],
    [{ name: "a" }, { name: "A" }],
    [{ name: "x".repeat(MAX_FIELD_NAME_CHARS + 1), type: "string" }],
    [{ name: "x".repeat(MAX_FIELD_NAME_CHARS), type: "string" }],
    [{ name: `a${CTRL}b`, type: "string" }],
    [{ name: "a", type: "money" }],
    [{ name: "a", type: "string", description: 7 }],
    [
      {
        name: "a",
        type: "string",
        description: "d".repeat(MAX_FIELD_DESCRIPTION_CHARS + 1),
      },
    ],
    [{ name: "a", type: "string", description: `x${CTRL}` }],
    Array.from({ length: MAX_EXTRACTION_FIELDS }, (_, i) => ({
      name: `f${i}`,
      type: "string",
    })),
    Array.from({ length: MAX_EXTRACTION_FIELDS + 1 }, (_, i) => ({
      name: `f${i}`,
      type: "string",
    })),
    ["not a field"],
    [null],
  ];

  it("health: the corpus has both outcomes, several of each", () => {
    const outcomes = corpus.map(
      (fields) => parseExtractOptions({ mode: "schema", schema: fields }).ok,
    );
    expect(outcomes.filter(Boolean).length).toBeGreaterThanOrEqual(4);
    expect(outcomes.filter((ok) => !ok).length).toBeGreaterThanOrEqual(10);
  });

  it.each(corpus.map((fields, i) => [i, fields] as const))(
    "list %i: a file and the job contract agree",
    (_, fields) => {
      const job = parseExtractOptions({ mode: "schema", schema: fields });
      const file = parseSchemaFile(fileOf({ ...header, name: "S", fields }));
      expect(file.ok).toBe(job.ok);
      if (job.ok && file.ok)
        expect(file.value.fields).toEqual(job.value.schema);
      if (!job.ok && !file.ok)
        expect(file.message).toBe(job.error.body.error.message);
    },
  );

  it("the panel's list is checked the same way, blank rows skipped as Extract data skips them", () => {
    const made = schemaFromFields("Invoice", [
      ...invoice,
      { name: "   ", type: "string" },
    ]);
    expect(made).toEqual({ ok: true, value: schema("Invoice") });
    const dup = schemaFromFields("Invoice", [
      ...invoice,
      { name: "TOTAL", type: "string" },
    ]);
    expect(dup.ok).toBe(false);
    const job = parseExtractOptions({
      mode: "schema",
      schema: [...invoice, { name: "TOTAL", type: "string" }],
    });
    expect(job.ok).toBe(false);
    if (!dup.ok && !job.ok)
      expect(dup.message).toBe(job.error.body.error.message);
    expect(schemaFromFields("Empty", [{ name: "", type: "string" }])).toEqual({
      ok: false,
      message: "Add at least one field to extract.",
    });
  });
});

describe("a schema's name", () => {
  it("is required, bounded and control-character-free", () => {
    expect(schemaFromFields("  ", invoice).ok).toBe(false);
    expect(
      schemaFromFields("n".repeat(MAX_SCHEMA_NAME_CHARS), invoice).ok,
    ).toBe(true);
    expect(
      schemaFromFields("n".repeat(MAX_SCHEMA_NAME_CHARS + 1), invoice),
    ).toEqual({
      ok: false,
      message: `A schema name can be up to ${MAX_SCHEMA_NAME_CHARS} characters.`,
    });
    expect(schemaFromFields(`a${CTRL}`, invoice).ok).toBe(false);
    expect(schemaFromFields("  Invoice  ", invoice)).toEqual({
      ok: true,
      value: schema("Invoice"),
    });
  });

  it("names a file safely", () => {
    expect(schemaFileName("Supplier invoice (EU)")).toBe(
      "supplier-invoice-eu.schema.json",
    );
    expect(schemaFileName(`${WIDE}${WIDE}`)).toBe("schema.schema.json");
    expect(schemaFileName("../../etc/passwd")).toBe("etc-passwd.schema.json");
    expect(schemaFileName("x".repeat(200)).length).toBeLessThanOrEqual(
      40 + ".schema.json".length,
    );
  });
});

describe("a schema file", () => {
  it("round-trips: export, then import, gives the same schema", () => {
    const text = schemaFileText(schema("Invoice"));
    expect(JSON.parse(text)).toEqual({
      ...header,
      name: "Invoice",
      fields: invoice,
    });
    expect(parseSchemaFile(text)).toEqual({
      ok: true,
      value: schema("Invoice"),
    });
  });

  it("the largest schema a person can build exports under the import cap", () => {
    // Every bound at its maximum, in the widest characters UTF-8 has per
    // UTF-16 unit — so no schema this page saves is one it cannot import.
    const widest: SavedSchema = {
      name: WIDE.repeat(MAX_SCHEMA_NAME_CHARS),
      fields: Array.from({ length: MAX_EXTRACTION_FIELDS }, (_, i) => ({
        name: `${i}`.padEnd(MAX_FIELD_NAME_CHARS, WIDE),
        type: "string" as const,
        description: WIDE.repeat(MAX_FIELD_DESCRIPTION_CHARS),
      })),
    };
    const text = schemaFileText(widest);
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_SCHEMA_FILE_BYTES);
    // Positive control: it is a real schema, and it is big.
    expect(bytes).toBeGreaterThan(MAX_SCHEMA_FILE_BYTES / 4);
    expect(parseSchemaFile(text)).toEqual({ ok: true, value: widest });
  });

  it("over the size cap is refused before it is parsed", () => {
    expect(schemaFileTooLarge(MAX_SCHEMA_FILE_BYTES)).toBeNull();
    expect(schemaFileTooLarge(MAX_SCHEMA_FILE_BYTES + 1)).toMatch(/larger/);
    const huge = fileOf({
      ...header,
      name: "S",
      fields: [
        {
          name: "a",
          type: "string",
          description: "x".repeat(MAX_SCHEMA_FILE_BYTES),
        },
      ],
    });
    const result = parseSchemaFile(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/larger than a schema file/);
  });

  const refusals: [string, string][] = [
    ["not JSON", "{ name: Invoice"],
    ["empty", ""],
    ["a list", fileOf([header])],
    ["a number", "7"],
    ["null", "null"],
    ["another JSON file", fileOf({ name: "S", fields: invoice })],
    [
      "a newer version",
      fileOf({ ...header, version: 2, name: "S", fields: invoice }),
    ],
    [
      "a string version",
      fileOf({ ...header, version: "1", name: "S", fields: invoice }),
    ],
    ["no name", fileOf({ ...header, fields: invoice })],
    ["a numeric name", fileOf({ ...header, name: 5, fields: invoice })],
    [
      "a huge name",
      fileOf({ ...header, name: "n".repeat(10_000), fields: invoice }),
    ],
    ["fields not a list", fileOf({ ...header, name: "S", fields: { a: 1 } })],
    ["no fields", fileOf({ ...header, name: "S", fields: [] })],
    [
      "an extra top-level key",
      fileOf({ ...header, name: "S", fields: invoice, run: true }),
    ],
    [
      "a top-level __proto__",
      `{"format":${JSON.stringify(SCHEMA_FILE_FORMAT)},"version":1,"name":"S","fields":[{"name":"a"}],"__proto__":{"polluted":true}}`,
    ],
    [
      "a constructor key",
      fileOf({
        ...header,
        name: "S",
        fields: invoice,
        constructor: { prototype: { polluted: true } },
      }),
    ],
    [
      "a field's __proto__",
      `{"format":${JSON.stringify(SCHEMA_FILE_FORMAT)},"version":1,"name":"S","fields":[{"name":"a","__proto__":{"polluted":true}}]}`,
    ],
    [
      "a field's extra key",
      fileOf({ ...header, name: "S", fields: [{ name: "a", value: 1 }] }),
    ],
    [
      "a field that is a string",
      fileOf({ ...header, name: "S", fields: ["a"] }),
    ],
    [
      "a wrong type",
      fileOf({ ...header, name: "S", fields: [{ name: "a", type: "object" }] }),
    ],
    ["a deep nesting", "[".repeat(50_000)],
  ];

  it.each(refusals)("refuses %s whole, with a sentence", (_, text) => {
    const result = parseSchemaFile(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/^[A-Z].*\.$/);
      expect(result.message.length).toBeLessThan(200);
    }
    // Nothing leaked onto the prototype either.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("CONTROL: the same files without the hostile part are accepted", () => {
    expect(
      parseSchemaFile(fileOf({ ...header, name: "S", fields: [{ name: "a" }] }))
        .ok,
    ).toBe(true);
    expect(
      parseSchemaFile(
        fileOf({
          ...header,
          name: "S",
          fields: [{ name: "a", type: "string" }],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("this browser's storage", () => {
  it("save, list newest first, replace by name, delete", () => {
    const store = memoryStorage();
    expect(saveSchema(schema("A"), store)).toMatchObject({
      ok: true,
      replaced: null,
    });
    expect(saveSchema(schema("B"), store).ok).toBe(true);
    expect(readSavedSchemas(store).map((s) => s.name)).toEqual(["B", "A"]);
    const replaced = saveSchema(
      schema("a", [{ name: "x", type: "string" }]),
      store,
    );
    expect(replaced).toMatchObject({ ok: true, replaced: schema("A") });
    expect(readSavedSchemas(store)).toEqual([
      schema("a", [{ name: "x", type: "string" }]),
      schema("B"),
    ]);
    expect(deleteSchema("B", store)).toEqual({
      ok: true,
      schemas: [schema("a", [{ name: "x", type: "string" }])],
    });
    expect(deleteSchema("a", store).schemas).toEqual([]);
    // An empty list leaves nothing behind.
    expect(store.map.has(SAVED_SCHEMAS_KEY)).toBe(false);
  });

  it(`keeps at most ${MAX_SAVED_SCHEMAS}, and says so instead of dropping one`, () => {
    const store = memoryStorage();
    for (let i = 0; i < MAX_SAVED_SCHEMAS; i++)
      expect(saveSchema(schema(`S${i}`), store).ok).toBe(true);
    const over = saveSchema(schema("one more"), store);
    expect(over.ok).toBe(false);
    if (!over.ok)
      expect(over.message).toContain(`${MAX_SAVED_SCHEMAS} schemas`);
    expect(readSavedSchemas(store)).toHaveLength(MAX_SAVED_SCHEMAS);
    // Replacing one at the cap is not adding one.
    expect(saveSchema(schema("S3"), store).ok).toBe(true);
  });

  it("a full or blocked store says it did not save, and storageWorks tells them apart", () => {
    const full = memoryStorage(10);
    expect(storageWorks(full)).toBe(false);
    const result = saveSchema(schema("A"), full);
    expect(result.ok).toBe(false);
    expect(readSavedSchemas(blocked)).toEqual([]);
    expect(storageWorks(blocked)).toBe(false);
    expect(storageWorks(undefined)).toBe(false);
    expect(saveSchema(schema("A"), undefined).ok).toBe(false);
    expect(writeSavedSchemas([schema("A")], blocked)).toBe(false);
    // CONTROL: a working store passes, and the probe leaves it as it was.
    const fine = memoryStorage();
    expect(storageWorks(fine)).toBe(true);
    expect(fine.map.size).toBe(0);
    saveSchema(schema("A"), fine);
    const held = fine.map.get(SAVED_SCHEMAS_KEY);
    expect(storageWorks(fine)).toBe(true);
    expect(fine.map.get(SAVED_SCHEMAS_KEY)).toBe(held);
  });

  it("corrupted storage is ignored, entry by entry, and never repaired into something else", () => {
    const store = memoryStorage();
    const put = (value: string) => store.map.set(SAVED_SCHEMAS_KEY, value);
    for (const broken of [
      "not json",
      "null",
      "[]",
      '{"version":2,"schemas":[]}',
      '{"version":1,"schemas":{}}',
      '{"version":1}',
    ]) {
      put(broken);
      expect(readSavedSchemas(store), broken).toEqual([]);
    }
    put(
      JSON.stringify({
        version: 1,
        schemas: [
          schema("Good"),
          { name: "Dup", fields: [{ name: "a" }, { name: "A" }] },
          { name: "", fields: invoice },
          { name: "Extra", fields: invoice, run: true },
          "junk",
          null,
          schema("good"),
          schema("Second"),
        ],
      }),
    );
    expect(readSavedSchemas(store).map((s) => s.name)).toEqual([
      "Good",
      "Second",
    ]);
    put(
      `{"version":1,"schemas":[{"name":"P","fields":[{"name":"a"}],"__proto__":{"polluted":true}}]}`,
    );
    expect(readSavedSchemas(store)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // More entries than the cap: the first ones are read, the rest ignored.
    put(
      JSON.stringify({
        version: 1,
        schemas: Array.from({ length: MAX_SAVED_SCHEMAS + 5 }, (_, i) =>
          schema(`S${i}`),
        ),
      }),
    );
    expect(readSavedSchemas(store)).toHaveLength(MAX_SAVED_SCHEMAS);
    // Storage text too large to be ours is not read at all.
    put("x".repeat(MAX_SAVED_SCHEMAS * MAX_SCHEMA_FILE_BYTES + 1));
    expect(readSavedSchemas(store)).toEqual([]);
  });
});
