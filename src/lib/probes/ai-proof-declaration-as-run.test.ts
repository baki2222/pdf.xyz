// @vitest-environment node
// @native-canvas
/**
 * Each AI proof's declaration, made the way `scripts/worker-prove-tools.ts`
 * makes it: a Node `Buffer`, the default extractor, plain Node.
 *
 * `ai-proof-declaration.test.tsx` proves the harness declares what each
 * panel declares, but it calls the declaration with what a TEST has: a plain
 * `Uint8Array` and a legacy-build extractor of its own. The script calls it
 * with `Buffer.from(await spec.make())`, or a carried artifact, which is
 * also a Buffer, and with the default extractor. pdfjs refuses a Buffer
 * outright ("Please provide binary data as `Uint8Array`, rather than
 * `Buffer`"), `countDeclaredCharacters` turns that throw into "could not
 * count", and on 2026-10-09 the first production run of these proofs
 * stopped at `[declare]` on every AI tool. Nothing was sent. Every unit test
 * of the declaration was green, because none of them made the call the
 * script makes.
 *
 * A browser never holds a Buffer: a panel reads a File into a plain
 * `Uint8Array`. So the declaration copies its input into one, which is
 * what this file holds, for every proof the harness runs.
 */
import { describe, expect, it } from "vitest";
import { AI_PROOF_SPECS } from "@/tests/ai-proof-specs";
import { browserAiDeclaration } from "./ai-proof-declaration";

describe("each AI proof's declaration, made as the harness makes it", () => {
  it("covers every AI proof (health)", () => {
    // An empty spec list would make every case below vacuous.
    expect(AI_PROOF_SPECS.length).toBeGreaterThanOrEqual(4);
  });

  for (const spec of AI_PROOF_SPECS.filter((s) => s.make)) {
    it(`${spec.tool} (${spec.name}): a Buffer, the default extractor, declared`, async () => {
      const bytes = Buffer.from(await spec.make!());
      // The input is what the script passes, not what a test would.
      expect(Buffer.isBuffer(bytes)).toBe(true);
      const verdict = await browserAiDeclaration(spec.tool, bytes);
      expect(verdict, JSON.stringify(verdict)).toMatchObject({
        kind: "declared",
      });
      if (verdict.kind !== "declared") return;
      expect(verdict.declaration.declaredCharacters).toBeGreaterThan(0);
    }, 60_000);
  }
});
