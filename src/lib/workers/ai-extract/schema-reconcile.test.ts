/**
 * Schema mode ships the fields that were ASKED FOR — every one, named as asked,
 * and says which the model left out.
 *
 * THE DEFECT (2026-09-28): the engine shipped `parseModelJson(completion.text)`
 * as-is. extraction.md iterated `Object.entries(data)` — only what came back —
 * so a request for 12 invoice fields answered with 10 produced 10 rows and no
 * marker, and a field returned as `invoice_number` for a request named
 * "Invoice Number" arrived under a key no consumer asked for. The manifest said
 * "absent values are null", which was true only of the fields the model chose
 * to mention. The proof harness checked the ZIP container, so `{}` passed.
 *
 * Everything here is read from the PACKAGE a user downloads — the bytes of
 * extraction.json, extraction.md and manifest.json — not from engine internals.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { ExtractOptions } from "@/lib/jobs/ai-extract";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { runAiExtract } from "./engine";
import {
  AI_EXTRACT_NOT_NULL_WARNING,
  AI_EXTRACT_NULL_CELL,
  AI_EXTRACT_NULL_INSTRUCTION,
  AI_EXTRACT_NULL_MEANING,
} from "@/lib/jobs/ai-extract-null-meaning";

const INPUT = new Uint8Array([1, 2, 3]);
const TEXT = "Invoice INV-7 from Acme. Total 1200. Due 30 June.";

const extract = async (): Promise<ExtractedPdfText> => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: TEXT, characterCount: TEXT.length }],
  text: TEXT,
  characterCount: TEXT.length,
  hasText: true,
});

function replying(text: string): AiProvider {
  const result: AiCompletionResult = {
    ok: true,
    text,
    model: "gpt-test",
    usage: { inputTokens: 300, outputTokens: 40 },
  };
  return { id: "openai", model: "gpt-test", complete: async () => result };
}

const schema = (...names: string[]): ExtractOptions => ({
  mode: "schema",
  schema: names.map((name) => ({ name, type: "string" as const })),
});

async function run(options: ExtractOptions, reply: unknown) {
  const out = await runAiExtract(INPUT, options, {
    extract,
    provider: replying(JSON.stringify(reply)),
  });
  if (!out.ok) throw new Error(`run failed: ${out.message}`);
  const zip = await JSZip.loadAsync(out.output);
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`${name} is missing from the package`);
    return file.async("string");
  };
  return {
    meta: out.meta,
    extraction: JSON.parse(await read("extraction.json")) as Record<
      string,
      unknown
    >,
    raw: JSON.parse(await read("model-output.json")) as unknown,
    manifest: JSON.parse(await read("manifest.json")) as {
      extraction: {
        keys: number;
        missingKeys?: string[];
        renamedKeys?: Record<string, string>;
        extraKeys?: string[];
      };
      notice: string;
    },
    md: await read("extraction.md"),
    readme: await read("README.txt"),
  };
}

describe("schema mode reconciles the reply with the request", () => {
  it("POSITIVE CONTROL: every requested field returned — nothing missing, nothing moved", async () => {
    const pkg = await run(schema("invoice", "total"), {
      invoice: "INV-7",
      total: 1200,
    });
    expect(pkg.extraction).toEqual({ invoice: "INV-7", total: 1200 });
    expect(pkg.manifest.extraction).toEqual({
      keys: 2,
      missingKeys: [],
      renamedKeys: {},
      extraKeys: [],
    });
    expect(pkg.md).not.toContain("not returned by the model");
  });

  it("a requested field the model OMITTED is null, named in the manifest, and marked in the table", async () => {
    const pkg = await run(schema("invoice", "total", "due_date"), {
      invoice: "INV-7",
      total: 1200,
    });
    // A consumer keyed on the requested names finds every one of them.
    expect(Object.keys(pkg.extraction)).toEqual([
      "invoice",
      "total",
      "due_date",
    ]);
    expect(pkg.extraction.due_date).toBeNull();
    expect(pkg.manifest.extraction.missingKeys).toEqual(["due_date"]);
    expect(pkg.manifest.extraction.keys).toBe(2);
    expect(pkg.meta.extractedKeys).toBe(2);
    // The row exists and says what happened — never borrowing "not found".
    expect(pkg.md).toMatch(/\| due_date \| _\(not returned by the model\)_ \|/);
    // The raw reply is still there, exactly as returned.
    expect(pkg.raw).toEqual({ invoice: "INV-7", total: 1200 });
  });

  // INVERTED 2026-10-09, history kept. This test was titled "a null the model
  // DID return reads as not found, distinct from not returned" and pinned the
  // cell `_(not found)_`. The distinction from "not returned" was right; the
  // meaning was not: a field whose text holds several different values can
  // come back null too (the ai-extract production proof failed exactly that
  // way), and "_(not found)_" told that user their value was absent.
  // AGAIN 2026-10-09: it then pinned "_(not found, or more than one match)_"
  // and a notice saying a null "matched more than once" — a value printed
  // twice over is one value, which a model returns, and the notice stated the
  // reason as fact (review). `null-meaning.test.ts` holds every surface that
  // explains a null to both reasons, as possibilities. AND AGAIN: a third
  // round of the package's own wording dropped a reason unseen (re-review 3),
  // so the words are now `@/lib/jobs/ai-extract-null-meaning`'s, and this
  // test holds the package to RENDERING them — the relationship, not a copy
  // of the string.
  it("a null the model DID return reads as not found OR several different values, distinct from not returned", async () => {
    const pkg = await run(schema("invoice", "po_number"), {
      invoice: "INV-7",
      po_number: null,
    });
    expect(pkg.manifest.extraction.missingKeys).toEqual([]);
    expect(pkg.md).toContain(`| po_number | ${AI_EXTRACT_NULL_CELL} |`);
    // Health: the cell is the two reasons, not one.
    expect(AI_EXTRACT_NULL_CELL).toBe(
      "_(not found, or several different values)_",
    );
    expect(pkg.md).not.toMatch(/_\(not found\)_/);
    expect(pkg.md).not.toMatch(/more than one match/);
    expect(pkg.md).not.toContain("not returned by the model");
    // The note under the table: the instruction, then what a null means,
    // then the warning that a single value may be one of several.
    expect(pkg.manifest.notice).toContain(
      [
        AI_EXTRACT_NULL_INSTRUCTION,
        AI_EXTRACT_NULL_MEANING,
        AI_EXTRACT_NOT_NULL_WARNING,
      ].join(" "),
    );
  });

  it("a null INSIDE a list is shown as the model's null, with no reason claimed for it", async () => {
    const pkg = await run(
      {
        mode: "schema",
        schema: [{ name: "regions", type: "array" }],
      },
      { regions: ["North", null, "East"] },
    );
    expect(pkg.md).toMatch(/\| regions \| North; _\(null\)_; East \|/);
  });

  it("a RESPELLED key lands under the requested name, and the respelling is recorded", async () => {
    const pkg = await run(schema("Invoice Number", "Total"), {
      invoice_number: "INV-7",
      total: 1200,
    });
    expect(pkg.extraction).toEqual({ "Invoice Number": "INV-7", Total: 1200 });
    expect(pkg.manifest.extraction.renamedKeys).toEqual({
      "Invoice Number": "invoice_number",
      Total: "total",
    });
    expect(pkg.manifest.extraction.missingKeys).toEqual([]);
    expect(pkg.manifest.extraction.extraKeys).toEqual([]);
    expect(pkg.md).toContain('_(returned as "invoice_number")_');
  });

  it("an EXACT name is never stolen by another field's respelling", async () => {
    // "total" is asked for verbatim AND "Total" is a respelling of it. The
    // verbatim request wins; the other field is missing, not given a guess.
    const pkg = await run(schema("Total", "total"), { total: 5 });
    expect(pkg.extraction).toEqual({ Total: null, total: 5 });
    expect(pkg.manifest.extraction.missingKeys).toEqual(["Total"]);
  });

  it("an AMBIGUOUS respelling is reported missing rather than guessed", async () => {
    const pkg = await run(schema("Due Date"), {
      due_date: "30 June",
      "due-date": "1 July",
    });
    expect(pkg.extraction).toEqual({ "Due Date": null });
    expect(pkg.manifest.extraction.missingKeys).toEqual(["Due Date"]);
    expect(pkg.manifest.extraction.extraKeys).toEqual(["due_date", "due-date"]);
  });

  it("an AMBIGUOUS respelling in the other direction — two FIELDS, one key — is not guessed either", async () => {
    // Review of 2026-09-28: the parser admits "invoice number" and
    // "invoice_number" as two fields (its duplicate rule only trims and
    // lowercases), and one reply key "Invoice Number" is a respelling of BOTH.
    // Ambiguity was counted across the reply's keys only, so the value went to
    // whichever field came first — a guess, under a docblock saying it never
    // guesses. Both are missing; the key is listed with its value.
    const pkg = await run(schema("invoice number", "invoice_number"), {
      "Invoice Number": "INV-7",
    });
    expect(pkg.extraction).toEqual({
      "invoice number": null,
      invoice_number: null,
    });
    expect(pkg.manifest.extraction.missingKeys).toEqual([
      "invoice number",
      "invoice_number",
    ]);
    expect(pkg.manifest.extraction.renamedKeys).toEqual({});
    expect(pkg.manifest.extraction.extraKeys).toEqual(["Invoice Number"]);
  });

  it("POSITIVE CONTROL for the above: the same key with ONE loose-matching field is respelled", async () => {
    const pkg = await run(schema("invoice number", "total"), {
      "Invoice Number": "INV-7",
      total: 5,
    });
    expect(pkg.extraction).toEqual({ "invoice number": "INV-7", total: 5 });
    expect(pkg.manifest.extraction.renamedKeys).toEqual({
      "invoice number": "Invoice Number",
    });
  });

  it("keys nobody asked for stay out of extraction.json and are listed, with their values, in the table", async () => {
    const pkg = await run(schema("invoice"), {
      invoice: "INV-7",
      vendor: "Acme",
    });
    expect(pkg.extraction).toEqual({ invoice: "INV-7" });
    expect(pkg.manifest.extraction.extraKeys).toEqual(["vendor"]);
    expect(pkg.md).toContain("Other keys the model returned");
    expect(pkg.md).toMatch(/\| vendor \| Acme \|/);
  });

  it("the package's own words describe what it now contains", async () => {
    const pkg = await run(schema("invoice", "total"), { invoice: "INV-7" });
    // The README no longer calls a reconciled file "exactly the model's JSON".
    const extractionLine = pkg.readme
      .split("\n")
      .find((line) => line.trim().startsWith("extraction.json"));
    expect(extractionLine).toBeDefined();
    expect(extractionLine).not.toContain("exactly the model's JSON");
    expect(extractionLine).toContain("missingKeys");
    expect(pkg.readme).toMatch(
      /model-output\.json\s+The model's JSON reply exactly as returned/,
    );
    expect(pkg.manifest.notice).toContain("extraction.missingKeys");
  });

  it("prompt mode has no request to reconcile: extraction.json is the reply", async () => {
    const out = await runAiExtract(
      INPUT,
      { mode: "prompt", prompt: "Extract the invoice number." },
      { extract, provider: replying('{"invoice":"INV-7"}') },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const zip = await JSZip.loadAsync(out.output);
    expect(
      JSON.parse(await zip.file("extraction.json")!.async("string")),
    ).toEqual({
      invoice: "INV-7",
    });
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.extraction).toEqual({ keys: 1 });
  });
});

describe("a failure after the model was PAID still reports what it spent", () => {
  it("a LIST reply to a schema fails honestly, retryable, carrying usage and window", async () => {
    const out = await runAiExtract(INPUT, schema("invoice"), {
      extract,
      provider: replying('[{"invoice":"INV-7"}]'),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("failed");
    expect(out.retryable).toBe(true);
    expect(out.message).toMatch(/list instead of the requested fields/);
    expect(out.usage).toMatchObject({
      inputTokens: 300,
      outputTokens: 40,
      calls: 1,
    });
    expect(out.window?.truncated).toBe(false);
  });

  it("a non-JSON reply carries usage too — the success arm is not the only one that costs", async () => {
    const out = await runAiExtract(INPUT, schema("invoice"), {
      extract,
      provider: replying("Sorry, I cannot help with that."),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.usage).toMatchObject({ inputTokens: 300, outputTokens: 40 });
    expect(out.window).toBeDefined();
  });
});

describe("the surfaces that list the package's contents list what it contains", () => {
  it("the panel's Output row and the worker capability name every data file the engine writes", async () => {
    // Derived from a REAL package, so a file added to the ZIP must be added to
    // the sentences that tell a user what they will download.
    const out = await runAiExtract(INPUT, schema("invoice"), {
      extract,
      provider: replying('{"invoice":"INV-7"}'),
    });
    if (!out.ok) throw new Error(out.message);
    const zip = await JSZip.loadAsync(out.output);
    const dataFiles = Object.keys(zip.files).filter(
      (name) => name !== "README.txt" && name !== "manifest.json",
    );
    expect(
      dataFiles.length,
      "health: the package has data files",
    ).toBeGreaterThanOrEqual(3);

    const { readFileSync } = await import("node:fs");
    const panel = readFileSync(
      "src/components/tools/ai-extract-worker-panel.tsx",
      "utf8",
    );
    // The row as the panel declares it — a JSX prop until WP-10 moved the
    // spec rows onto the shell, an object field since.
    const at = panel.search(/label(?:=|: )"Output"/);
    expect(at, "health: the panel declares an Output row").toBeGreaterThan(0);
    const outputRow = panel.slice(at);
    const { createAiExtractProcessor } =
      await import("../processor/ai-extract");
    const detail = createAiExtractProcessor({
      extract,
      provider: replying("{}"),
    }).capability().detail;
    for (const name of dataFiles) {
      expect(
        outputRow.slice(0, 200),
        `the panel's Output row omits ${name}`,
      ).toContain(name);
      expect(detail, `the worker capability omits ${name}`).toContain(name);
    }
  });
});
