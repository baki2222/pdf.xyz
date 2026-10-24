/**
 * Option memory (`pdfxyz.options.v1`, redesign E.9 and E.14): the last
 * choices made in a few tools, so the next file opens set the same way.
 *
 * ONLY ENUMS, NUMBERS AND BOOLEANS. A field is declared in
 * {@link OPTION_SCHEMAS} as one of those three kinds — there is no string
 * kind to declare — and every write and every read goes through the schema:
 * a field it does not name is never written, and a value outside its field
 * (an enum value not listed, a number out of range) reads as the default.
 * So a watermark's text, a header's words and a custom page-number format
 * cannot reach storage, whatever a caller passes; `option-memory.test.tsx`
 * types them into the real editors and reads the stored JSON for them.
 *
 * Each enum lists its values literally — `import type` only, so a tool that
 * reads its memory loads no other tool's module — and the test holds every
 * list to the picker that offers it.
 *
 * Every read and write is wrapped: a browser that refuses storage remembers
 * nothing, and says nothing.
 */
import type { HAlign, StampPosition } from "@/lib/pdf/stamp";
import { OPTIONS_STORAGE_KEY } from "./options-key";

export { OPTIONS_STORAGE_KEY };

export interface EnumField<T extends string> {
  readonly kind: "enum";
  readonly values: readonly T[];
}
export interface NumberField {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
}
export interface BooleanField {
  readonly kind: "boolean";
}
export type Field = EnumField<string> | NumberField | BooleanField;
export type Schema = Readonly<Record<string, Field>>;

const oneOf = <T extends string>(values: readonly T[]): EnumField<T> => ({
  kind: "enum",
  values,
});
const int = (min: number, max: number): NumberField => ({
  kind: "number",
  min,
  max,
  integer: true,
});

const POSITIONS: readonly StampPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const ALIGNS: readonly HAlign[] = ["left", "center", "right"];

/** Every tool that remembers options, and exactly what it may remember. */
export const OPTION_SCHEMAS = {
  "page-numbers": {
    position: oneOf(POSITIONS),
    // The presets only: a custom format is typed text, and is never kept.
    format: oneOf([
      "Page {n} of {total}",
      "{n} / {total}",
      "{n}",
      "- {n} -",
    ] as const),
    startPage: int(1, 99999),
    startAt: int(0, 99999),
  },
  // Never the text.
  watermark: {
    opacity: int(5, 100),
    rotation: int(-90, 90),
  },
  // Positions only: a header's words are typed text.
  "header-footer": {
    headerAlign: oneOf(ALIGNS),
    footerAlign: oneOf(ALIGNS),
  },
  "pdf-to-image": {
    resolution: oneOf(["screen", "high", "print"] as const),
    // Colour or grayscale; the page range is typed text and is never kept.
    color: oneOf(["color", "gray"] as const),
  },
} as const satisfies Readonly<Record<string, Schema>>;

export type OptionTool = keyof typeof OPTION_SCHEMAS;

type ValueOf<F> =
  F extends EnumField<infer T> ? T : F extends NumberField ? number : boolean;
export type RememberedOptions<T extends OptionTool> = {
  -readonly [K in keyof (typeof OPTION_SCHEMAS)[T]]?: ValueOf<
    (typeof OPTION_SCHEMAS)[T][K]
  >;
};

function valid(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case "enum":
      return (field.values as readonly unknown[]).includes(value);
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= field.min &&
        value <= field.max &&
        (!field.integer || Number.isInteger(value))
      );
    case "boolean":
      return typeof value === "boolean";
  }
}

/** The schema's fields of `raw`, each kept only if valid. */
function sanitize(schema: Schema, raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [name, field] of Object.entries(schema)) {
    const value = (raw as Record<string, unknown>)[name];
    if (valid(field, value)) out[name] = value;
  }
  return out;
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Every tool's stored record, each through its schema. */
function readAll(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  let value: unknown;
  try {
    value = JSON.parse(store()?.getItem(OPTIONS_STORAGE_KEY) ?? "null");
  } catch {
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  const { version, tools } = value as { version?: unknown; tools?: unknown };
  if (version !== 1 || typeof tools !== "object" || tools === null) return out;
  if (Array.isArray(tools)) return out;
  for (const [tool, schema] of Object.entries(OPTION_SCHEMAS) as [
    string,
    Schema,
  ][]) {
    const kept = sanitize(schema, (tools as Record<string, unknown>)[tool]);
    if (Object.keys(kept).length > 0) out[tool] = kept;
  }
  return out;
}

/** The choices last made in `tool`; empty when none were kept. */
export function recallOptions<T extends OptionTool>(
  tool: T,
): RememberedOptions<T> {
  return (readAll()[tool] ?? {}) as RememberedOptions<T>;
}

/** Keep `values` for `tool` — only the fields its schema names. */
export function rememberOptions<T extends OptionTool>(
  tool: T,
  values: RememberedOptions<T>,
): void {
  const tools = readAll();
  tools[tool] = sanitize(OPTION_SCHEMAS[tool], values);
  try {
    store()?.setItem(
      OPTIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, tools }),
    );
  } catch {
    // Storage refused (full, blocked): the choice is just not remembered.
  }
}
