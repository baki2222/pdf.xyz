// @vitest-environment node
/**
 * TRANSLATE_READING_ORDER_MEASURED is data copied from one run of
 * `scripts/worker-translate-reading-order-proof.ts` in the live worker image.
 * A typed table has no relationships of its own (CLAUDE.md rule 3), so this
 * file binds it to the things it must agree with: the script that produced
 * it (the same corpus, by name, discovered from the script's source), the
 * bounds it was measured against, and the gate's own consequences.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED } from "@/lib/jobs/translate-limits";
import { TRANSLATE_FLOW_TIMEOUT_MS } from "@/lib/jobs/translate-reading-order";
import { resolveNativePdfTextConfig } from "../pdf-text/native-config";
import { TRANSLATE_READING_ORDER_MEASURED } from "./reading-order";

const SCRIPT = "scripts/worker-translate-reading-order-proof.ts";
const docs = TRANSLATE_READING_ORDER_MEASURED.documents;

/** The corpus names, read from the script's `corpus` array literal. */
function scriptCorpusNames(): string[] {
  const source = readFileSync(path.join(process.cwd(), SCRIPT), "utf8");
  const start = source.indexOf("const corpus:");
  const end = source.indexOf("];", start);
  expect(start, `${SCRIPT} lost its corpus array`).toBeGreaterThan(-1);
  return [...source.slice(start, end).matchAll(/\[\s*"([^"]+)",/g)].map(
    (m) => m[1]!,
  );
}

describe("TRANSLATE_READING_ORDER_MEASURED", () => {
  it("covers exactly the corpus the proof script measures (health: at least 12 documents)", () => {
    const names = scriptCorpusNames();
    expect(names.length).toBeGreaterThanOrEqual(12);
    expect(docs.map((d) => d.name)).toEqual(names);
  });

  it("was measured on the same binary as the shipped divergence table", () => {
    expect(TRANSLATE_READING_ORDER_MEASURED.binary).toBe(
      TRANSLATE_EXTRACTOR_DIVERGENCE_SHIPPED.binary,
    );
  });

  it("never records flow longer than -layout, and never more pages sent or fallen back than exist", () => {
    for (const d of docs) {
      expect(d.flowChars, d.name).toBeLessThanOrEqual(d.layoutChars);
      expect(
        d.flowPages + d.fellBack.ink + d.fellBack.longer + d.fellBack.rtl,
        d.name,
      ).toBeLessThanOrEqual(d.pages);
    }
  });

  it("the largest document read within both bounds the flow run is held to", () => {
    const largest = docs.reduce((a, b) => (b.pages > a.pages ? b : a));
    expect(largest.pages).toBeGreaterThanOrEqual(300);
    const { maxOutputBytes } = resolveNativePdfTextConfig({});
    for (const d of docs) {
      expect(d.bboxBytes, d.name).toBeLessThan(maxOutputBytes);
      expect(d.bboxMs, d.name).toBeLessThan(TRANSLATE_FLOW_TIMEOUT_MS);
    }
  });

  it("records the RTL pages as fallbacks and every other text document as flow", () => {
    const rtl = docs.filter((d) => d.fellBack.rtl > 0).map((d) => d.name);
    expect(rtl.sort()).toEqual(["Arabic", "Hebrew"]);
    for (const d of docs)
      if (!rtl.includes(d.name)) expect(d.flowPages, d.name).toBeGreaterThan(0);
  });
});
