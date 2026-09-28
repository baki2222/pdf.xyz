/**
 * The production proof of AI Data Extraction fails on an extraction of nothing.
 *
 * Until 2026-09-28 the harness spec for ai-extract was `expect: isZipContainer`
 * with no `verify`, so `{}` — every requested field dropped — was proof. The
 * packages below are built by the REAL engine from a fake provider's reply, so
 * the verdict is read from what a user would download, including the
 * manifest's `missingKeys` the engine now writes.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { runAiExtract } from "@/lib/workers/ai-extract/engine";
import {
  PROOF_EXTRACTION_SCHEMA,
  PROOF_TABLE_ROWS,
  verifyExtractionProof,
} from "./extraction-proof";

const TEXT = PROOF_TABLE_ROWS.map((row) => row.join(" ")).join("\n");

async function packageFor(reply: string): Promise<Uint8Array> {
  const extract = async (): Promise<ExtractedPdfText> => ({
    pageCount: 1,
    pages: [{ pageNumber: 1, text: TEXT, characterCount: TEXT.length }],
    text: TEXT,
    characterCount: TEXT.length,
    hasText: true,
  });
  const run = await runAiExtract(
    new Uint8Array([1]),
    {
      mode: "schema",
      schema: PROOF_EXTRACTION_SCHEMA.map((field) => ({ ...field })),
    },
    {
      extract,
      provider: {
        id: "openai",
        model: "gpt-test",
        complete: async () => ({ ok: true, text: reply, model: "gpt-test" }),
      },
    },
  );
  if (!run.ok) throw new Error(run.message);
  return run.output;
}

describe("verifyExtractionProof", () => {
  it("passes a real extraction of the proof table", async () => {
    const verdict = await verifyExtractionProof(
      await packageFor('{"region":"North","q1":1200}'),
    );
    expect(verdict).toEqual({ ok: true, detail: 'region="North", q1=1200' });
  });

  it("tolerates how a model writes a number, not a number the table lacks", async () => {
    expect(
      (
        await verifyExtractionProof(
          await packageFor('{"region":"East","q1":"1,560"}'),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await verifyExtractionProof(
          await packageFor('{"region":"East","q1":1561}'),
        )
      ).ok,
    ).toBe(false);
  });

  it("POSITIVE CONTROL: fails the blank extraction the old check certified", async () => {
    const verdict = await verifyExtractionProof(await packageFor("{}"));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/did not return: region, q1/);
  });

  it("fails when the model dropped q1, even though extraction.json now carries the key as null", async () => {
    const verdict = await verifyExtractionProof(
      await packageFor('{"region":"North"}'),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("q1");
  });

  it("fails an older package whose extraction.json simply lacks a key", async () => {
    const zip = new JSZip();
    zip.file("extraction.json", JSON.stringify({ region: "North" }));
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
    expect(block, "the ai-extract proof spec is gone").toContain("tablePdf");
    expect(block).toContain("verifyExtractionProof");
    expect(block).toContain("PROOF_EXTRACTION_SCHEMA");
    const table = harness.slice(harness.indexOf("async function tablePdf"));
    expect(table.slice(0, table.indexOf("\n}"))).toContain("PROOF_TABLE_ROWS");
  });
});
