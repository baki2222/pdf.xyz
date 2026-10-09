/**
 * The production proof of AI Data Extraction asks a question with ONE right
 * answer, and accepts that answer and nothing less.
 *
 * Until 2026-09-28 the harness spec for ai-extract was `expect: isZipContainer`
 * with no `verify`, so `{}` — every requested field dropped — was proof. The
 * packages below are built by the REAL engine from a fake provider's reply, so
 * the verdict is read from what a user would download, including the
 * manifest's `missingKeys` the engine writes.
 *
 * ── 2026-10-09: THE PROOF'S QUESTION HAD NO SINGLE ANSWER ────────────────────
 *
 * The first production run of that verifier failed: "every requested value is
 * null". The composed chain handed the model the whole table, declared and
 * undeclared (`workers/ai-extract-read.chain.test.ts`); what the proof asked of
 * it was ONE `region` (string) and ONE `q1` (number) from a table of FOUR
 * regions, under an engine instruction to answer null rather than guess. Null
 * is that instruction followed. Every test here fed the engine a reply its
 * author typed — `{"region":"North","q1":1200}` — so the suite agreed with the
 * request instead of asking whether the text supported it, and the verifier
 * accepted any ONE row, so a document cut after its first row would have
 * passed too. Both tests are inverted below, history kept, and a model that
 * follows the engine's prompt to the letter (`@/tests/literal-extraction-model`)
 * now answers the proof's request through the real engine.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import type { AiProvider } from "@/lib/workers/ai/provider";
import { literalExtractionModel } from "@/tests/literal-extraction-model";
import {
  PROOF_EXTRACTION_COLUMNS,
  PROOF_EXTRACTION_SCHEMA,
  PROOF_TABLE_ROWS,
  PROOF_TABLE_TITLE,
  proofColumn,
  verifyExtractionProof,
} from "./extraction-proof";

/** The fixture as the worker's `pdftotext -layout` gives it, padding collapsed. */
const TEXT = [
  PROOF_TABLE_TITLE,
  "",
  ...PROOF_TABLE_ROWS.map((row) => row.join(" ")),
].join("\n");

const DATA_ROWS = PROOF_TABLE_ROWS.length - 1;

function fixedReply(reply: string): AiProvider {
  return {
    id: "openai",
    model: "gpt-test",
    complete: async () => ({ ok: true, text: reply, model: "gpt-test" }),
  };
}

async function packageFrom(
  provider: AiProvider,
  schema: readonly {
    name: string;
    type: string;
    description?: string;
  }[] = PROOF_EXTRACTION_SCHEMA,
  text = TEXT,
): Promise<Uint8Array> {
  const extract = async (): Promise<ExtractedPdfText> => ({
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: true,
  });
  const run = await runAiExtract(
    new Uint8Array([1]),
    {
      mode: "schema",
      schema: schema.map((field) => ({ ...field })) as never,
    },
    { extract, provider },
  );
  if (!run.ok) throw new Error(run.message);
  return run.output;
}

const packageFor = (reply: string) => packageFrom(fixedReply(reply));

/** The whole table's answer, derived from the fixture. */
const WHOLE = Object.fromEntries(
  PROOF_EXTRACTION_SCHEMA.map((field, i) => [
    field.name,
    proofColumn(PROOF_EXTRACTION_COLUMNS[i]!).map((cell) =>
      /^\d+$/.test(cell) ? Number(cell) : cell,
    ),
  ]),
);

describe("the proof's request", () => {
  it("health: the table has several data rows, so ONE value per field is a guess", () => {
    expect(DATA_ROWS).toBeGreaterThan(1);
    for (const header of PROOF_EXTRACTION_COLUMNS) {
      expect(proofColumn(header)).toHaveLength(DATA_ROWS);
    }
  });

  it("asks for each column as a list, because the table holds a value per row", () => {
    // The relation, not a string: a field over a column of N>1 values has N
    // candidates, and the engine instructs "use null — never a guess".
    expect(PROOF_EXTRACTION_SCHEMA).toHaveLength(
      PROOF_EXTRACTION_COLUMNS.length,
    );
    for (const field of PROOF_EXTRACTION_SCHEMA) {
      expect(
        field.type,
        `${field.name} asks for one value of ${DATA_ROWS}`,
      ).toBe("array");
    }
  });

  it("has one right answer: a model that follows the engine's prompt to the letter passes the proof", async () => {
    const model = literalExtractionModel();
    const verdict = await verifyExtractionProof(await packageFrom(model));
    expect(
      model.requests,
      "health: the engine never asked the model",
    ).toHaveLength(1);
    expect(verdict).toEqual({
      ok: true,
      detail: PROOF_EXTRACTION_SCHEMA.map(
        (field) =>
          `${field.name}=${(WHOLE[field.name] as unknown[]).join(",")}`,
      ).join("; "),
    });
  });

  it("CONTROL: the same model asked the old question — one region, one q1 — answers null, the 2026-10-09 failure", async () => {
    // The request the proof shipped until 2026-10-09, kept as history. The
    // model is shown the whole table and answers exactly what production did.
    const OLD = [
      { name: "region", type: "string", description: "The region name" },
      { name: "q1", type: "number", description: "The Q1 figure" },
    ];
    const model = literalExtractionModel();
    const verdict = await verifyExtractionProof(await packageFrom(model, OLD));
    for (const cell of PROOF_TABLE_ROWS.flat()) {
      expect(model.documents[0], "the model was not shown the table").toContain(
        cell,
      );
    }
    expect(verdict).toEqual({
      ok: false,
      detail: "every requested value is null",
    });
  });

  it("CONTROL: the same model shown a document with no table answers null, not the table", async () => {
    const verdict = await verifyExtractionProof(
      await packageFrom(
        literalExtractionModel(),
        PROOF_EXTRACTION_SCHEMA,
        PROOF_TABLE_TITLE,
      ),
    );
    expect(verdict).toEqual({
      ok: false,
      detail: "every requested value is null",
    });
  });
});

describe("verifyExtractionProof", () => {
  it("passes the whole table, top to bottom", async () => {
    // INVERTED 2026-10-09, history kept: this was "passes a real extraction of
    // the proof table" over `{"region":"North","q1":1200}` — one row, typed by
    // the test's author, which is the answer the old request had no grounds
    // for and the answer a document cut after its first row would also give.
    const verdict = await verifyExtractionProof(
      await packageFor(JSON.stringify(WHOLE)),
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses ONE row of the table: one row is not proof the table was read", async () => {
    const verdict = await verifyExtractionProof(
      await packageFor('{"region":"North","q1":1200}'),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/^region is "North"/);
  });

  it("refuses a table cut short — the shape a read cap that bit would leave", async () => {
    const cut = Object.fromEntries(
      Object.entries(WHOLE).map(([k, v]) => [k, (v as unknown[]).slice(0, 2)]),
    );
    const verdict = await verifyExtractionProof(
      await packageFor(JSON.stringify(cut)),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain(proofColumn("Region").join(", "));
  });

  it("tolerates how a model writes a number, not a number the table lacks", async () => {
    const written = {
      ...WHOLE,
      q1: proofColumn("Q1").map((cell) => Number(cell).toLocaleString("en-US")),
    };
    expect(written.q1.some((v) => v.includes(","))).toBe(true);
    expect(
      (await verifyExtractionProof(await packageFor(JSON.stringify(written))))
        .ok,
    ).toBe(true);
    const wrong = {
      ...WHOLE,
      q1: (WHOLE.q1 as number[]).map((n, i) => (i === 2 ? n + 1 : n)),
    };
    expect(
      (await verifyExtractionProof(await packageFor(JSON.stringify(wrong)))).ok,
    ).toBe(false);
  });

  it("tolerates how a model writes a name — case and padding — not a name the table lacks", async () => {
    const shouted = {
      ...WHOLE,
      region: proofColumn("Region").map((r) => ` ${r.toUpperCase()} `),
    };
    expect(
      (await verifyExtractionProof(await packageFor(JSON.stringify(shouted))))
        .ok,
    ).toBe(true);
    const reordered = {
      ...WHOLE,
      region: [...proofColumn("Region")].reverse(),
    };
    expect(
      (await verifyExtractionProof(await packageFor(JSON.stringify(reordered))))
        .ok,
    ).toBe(false);
  });

  it("POSITIVE CONTROL: fails the blank extraction the old check certified", async () => {
    const verdict = await verifyExtractionProof(await packageFor("{}"));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/did not return: region, q1/);
  });

  it("fails when the model dropped q1, even though extraction.json now carries the key as null", async () => {
    const verdict = await verifyExtractionProof(
      await packageFor(JSON.stringify({ region: WHOLE.region })),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("q1");
  });

  it("fails an older package whose extraction.json simply lacks a key", async () => {
    const zip = new JSZip();
    zip.file("extraction.json", JSON.stringify({ region: WHOLE.region }));
    const verdict = await verifyExtractionProof(
      await zip.generateAsync({ type: "uint8array" }),
    );
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.detail).toContain("lacks requested key(s): q1");
  });

  it("fails bytes that are not a package", async () => {
    expect((await verifyExtractionProof(new Uint8Array([1, 2, 3]))).ok).toBe(
      false,
    );
  });

  it("the harness draws THIS table and runs THIS check for ai-extract", () => {
    // A correct verifier nothing calls is worth nothing. Read the harness.
    const harness = readFileSync("scripts/worker-prove-tools.ts", "utf8");
    const spec = harness.slice(harness.indexOf('tool: "ai-extract"'));
    const block = spec.slice(0, spec.indexOf("\n  },"));
    expect(block, "the ai-extract proof spec is gone").toMatch(
      /make: async \(\) => Buffer\.from\(await proofTablePdf\(\)\)/,
    );
    expect(block).toContain("verifyExtractionProof");
    expect(block).toContain("PROOF_EXTRACTION_SCHEMA");
    // The fixture is drawn in ONE place, beside the rows the verifier reads.
    expect(harness).not.toMatch(/async function tablePdf/);
  });
});
