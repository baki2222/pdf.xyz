// @vitest-environment node
/**
 * The `translateReadingOrder` probe, without poppler.
 *
 * The probe runs ONE `translate-pdf` job through the executor's order and
 * reads what the model was sent and what the reader was delivered. Here the
 * extractor is driven from VERBATIM poppler output (`@/tests/poppler-samples`'
 * TWO_COLUMN pair, whose columns are `LEFT_COLUMN` / `RIGHT_COLUMN`), either
 * through `translateDeps`' own composite with only `pdftotext`'s `exec`
 * swapped, or through a plain extractor of the shared resolver's shape.
 *
 * Every control asserts WHICH checks failed, never only `ok === false`: a
 * plain extractor sets no reading order, so it fails `source` before order is
 * ever looked at, and a control that failed only there would stay false with
 * the order checks neutered (CLAUDE.md rule 5: the mutation needs its own
 * health check).
 *
 * MUTATIONS (2026-11-16, each on a scratch copy of
 * `./reading-order-capability.ts`, the mutated line grepped back and diffed,
 * then restored):
 *  - the control check (6) always passes: "a page whose -layout does not
 *    interleave proves nothing" went red; the shared-resolver control stayed
 *    false through `order_sent`;
 *  - `order_sent` (3) always passes: the shared-resolver control's
 *    `failed` lost "order_sent" and went red — and the OLD assertion
 *    (`ok === false` alone) stayed GREEN under the same mutation, which is
 *    why the verdict is structured;
 *  - `order_delivered` (4) always passes: the control's `failed` lost
 *    "order_delivered" and went red.
 */
import { describe, expect, it } from "vitest";
import { collapseLayoutPadding, type ExtractedPdfText } from "@/lib/pdf/text";
import {
  columnsReadInOrder,
  LEFT_COLUMN,
  RIGHT_COLUMN,
} from "@/tests/pdf-office-fixtures";
import { TWO_COLUMN_BBOX, TWO_COLUMN_LAYOUT } from "@/tests/poppler-samples";
import type { AiProvider } from "../ai/provider";
import {
  resolveNativePdfTextExtractor,
  type PdfTextExec,
} from "../pdf-text/native";
import { flowText } from "../pdf-text/flow";
import { parseBboxFlow, parseLayoutText } from "../pdf-text/parse";
import { ProcessorRegistry } from "../processor/registry";
import { createTranslateProcessor } from "../processor/translate";
import { translateDeps } from "./native";
import { composeReadingOrderExtractor } from "./reading-order";
import {
  columnsSentInOrder,
  probeTranslateReadingOrder,
  proofCorpusShortfall,
  provesTranslateReadingOrder,
  READING_ORDER_PROBE_COLUMNS,
  READING_ORDER_PROBE_TITLE,
  readingOrderProbePdf,
  type ProbeColumns,
} from "./reading-order-capability";

/** The TWO_COLUMN pair's columns: what the verbatim samples hold. */
const TWO_COLUMN: ProbeColumns = { left: LEFT_COLUMN, right: RIGHT_COLUMN };

/** An exec answering `-layout` and `-bbox-layout` with the TWO_COLUMN pair. */
function samplesExec(bbox: () => Promise<string>): PdfTextExec {
  return (_command, args) =>
    args.includes("-bbox-layout")
      ? bbox()
      : args.includes("-layout")
        ? Promise.resolve(TWO_COLUMN_LAYOUT)
        : Promise.reject(new Error(`unexpected run: ${args.join(" ")}`));
}

/** `translateDeps`' own composite, only `pdftotext`'s exec swapped. */
function composite(bbox: () => Promise<string> = async () => TWO_COLUMN_BBOX) {
  const extract = translateDeps(
    {},
    {},
    { resolveOnPath: () => false },
    { resolveOnPath: () => true, exec: samplesExec(bbox) },
  ).extract;
  if (!extract) throw new Error("health: no extractor was wired");
  return extract;
}

/** The shared resolver every other AI tool reads, same exec. */
function sharedResolver() {
  const extract = resolveNativePdfTextExtractor(
    {},
    { resolveOnPath: () => true, exec: samplesExec(async () => "") },
  );
  if (!extract) throw new Error("health: no shared extractor was wired");
  return extract;
}

const layoutOf = (): ExtractedPdfText =>
  parseLayoutText(collapseLayoutPadding(TWO_COLUMN_LAYOUT));

describe("columnsSentInOrder — held equal to the suite's columnsReadInOrder", () => {
  // The paragraph shapes of `pdf-text/flow.test.ts`: the flow shape, and
  // the old one-paragraph-per-layout-line shape PDF to Word shipped.
  const flowShape = [
    "Quarterly Report",
    LEFT_COLUMN.join(" "),
    RIGHT_COLUMN.join(" "),
  ];
  const oldShape = parseLayoutText(TWO_COLUMN_LAYOUT)
    .text.split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  it("the flow shape passes both", () => {
    expect(columnsReadInOrder(flowShape)).toBe(true);
    expect(columnsSentInOrder(flowShape.join("\n"), TWO_COLUMN)).toBe(true);
  });

  it("the old -layout shape fails both", () => {
    // Health: the old shape really is interleaved.
    expect(
      oldShape.some(
        (l) => l.includes(LEFT_COLUMN[0]) && l.includes(RIGHT_COLUMN[0]),
      ),
    ).toBe(true);
    expect(columnsReadInOrder(oldShape)).toBe(false);
    expect(columnsSentInOrder(oldShape.join("\n"), TWO_COLUMN)).toBe(false);
  });

  it("is stricter where it must be: right before left, a sentence twice, a mixed paragraph", () => {
    const L = LEFT_COLUMN.join(" ");
    const R = RIGHT_COLUMN.join(" ");
    expect(columnsSentInOrder([R, L].join("\n"), TWO_COLUMN)).toBe(false);
    expect(columnsSentInOrder([L, L, R].join("\n"), TWO_COLUMN)).toBe(false);
    expect(
      columnsSentInOrder([L, `${R} ${LEFT_COLUMN[0]}`].join("\n"), TWO_COLUMN),
    ).toBe(false);
  });

  it("the probe's own columns: each one sentence with its own tokens, no hyphens", () => {
    const { left, right } = READING_ORDER_PROBE_COLUMNS;
    expect(left.join(" ")).toMatch(/A101[\s\S]*Oslo/);
    expect(right.join(" ")).toMatch(/B202[\s\S]*Lima/);
    expect(left.join(" ")).not.toMatch(/B202|Lima/);
    expect(right.join(" ")).not.toMatch(/A101|Oslo/);
    expect([...left, ...right].join(" ")).not.toContain("-");
    const inOrder = [
      READING_ORDER_PROBE_TITLE,
      left.join(" "),
      right.join(" "),
    ];
    expect(columnsSentInOrder(inOrder.join("\n"))).toBe(true);
    const interleaved = left.map((line, i) => `${line} ${right[i]}`);
    expect(columnsSentInOrder(interleaved.join("\n"))).toBe(false);
  });
});

describe("readingOrderProbePdf", () => {
  it("is a one-page PDF generated in memory", async () => {
    const bytes = await readingOrderProbePdf();
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});

describe("probeTranslateReadingOrder — the verdict", () => {
  it("Translate's composite over the verbatim TWO_COLUMN pair passes every check", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: composite(),
      columns: TWO_COLUMN,
    });
    expect(verdict).toEqual({ ok: true, failed: [] });
  });

  it("POSITIVE CONTROL: the shared resolver's extractor fails on ORDER, not only on source", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: sharedResolver(),
      columns: TWO_COLUMN,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toContain("order_sent");
    expect(verdict.failed).toContain("order_delivered");
    // The job itself ran: a delivered job whose text was interleaved.
    expect(verdict.failed).not.toContain("stage");
    expect(verdict.failed).not.toContain("health");
    expect(verdict.failed).not.toContain("control");
  });

  it("POSITIVE CONTROL: a plain extractor of the shared resolver's shape fails the same way", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: async () => layoutOf(),
      columns: TWO_COLUMN,
    });
    expect(verdict.failed).toEqual(
      expect.arrayContaining(["order_sent", "order_delivered", "source"]),
    );
  });

  it("a composite whose flow drops a word falls back to -layout: order and source fail", async () => {
    const dropped = TWO_COLUMN_BBOX.replace(/>revenue</, "><");
    // Health: the mutation of the sample landed.
    expect(dropped).not.toBe(TWO_COLUMN_BBOX);
    const verdict = await probeTranslateReadingOrder({
      extract: composite(async () => dropped),
      columns: TWO_COLUMN,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(
      expect.arrayContaining(["order_sent", "order_delivered", "source"]),
    );
  });

  it("a flow run that fails (bbox_failed) proves nothing: order and source fail", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: composite(async () => {
        throw new Error("stdout maxBuffer length exceeded");
      }),
      columns: TWO_COLUMN,
    });
    expect(verdict.failed).toEqual(
      expect.arrayContaining(["order_sent", "order_delivered", "source"]),
    );
  });

  it("a page whose -layout does not interleave proves nothing (the in-probe control)", async () => {
    // -layout already in order: flow and layout agree, every other check
    // passes, and only the control can say the page tested nothing.
    const inOrder = [
      "Quarterly Report",
      "",
      LEFT_COLUMN.join(" "),
      "",
      RIGHT_COLUMN.join(" "),
    ].join("\n");
    const extract = composeReadingOrderExtractor(
      async () => parseLayoutText(inOrder),
      async () => flowText(parseBboxFlow(TWO_COLUMN_BBOX)),
    );
    const verdict = await probeTranslateReadingOrder({
      extract,
      columns: TWO_COLUMN,
    });
    expect(verdict).toEqual({ ok: false, failed: ["control"] });
  });

  it("a provider that is never called fails health (and order_sent)", async () => {
    const silent: AiProvider = {
      id: "anthropic",
      model: "capability-probe",
      async complete() {
        return {
          ok: true,
          text: "x",
          model: "capability-probe",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const verdict = await probeTranslateReadingOrder({
      extract: composite(),
      columns: TWO_COLUMN,
      registry: (deps) =>
        new ProcessorRegistry().register(
          createTranslateProcessor({ ...deps, provider: silent }),
        ),
    });
    expect(verdict.failed).toEqual(
      expect.arrayContaining(["health", "order_sent", "order_delivered"]),
    );
  });

  it("a registry without translate fails at the stage, and every later check with it", async () => {
    const verdict = await probeTranslateReadingOrder({
      extract: composite(),
      columns: TWO_COLUMN,
      registry: () => new ProcessorRegistry(),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toEqual(
      expect.arrayContaining([
        "stage",
        "health",
        "order_sent",
        "order_delivered",
        "source",
        "control",
      ]),
    );
  });

  it("no extractor, or an extractor that throws, is a false verdict, never a throw", async () => {
    await expect(
      probeTranslateReadingOrder({ extract: undefined }),
    ).resolves.toEqual({ ok: false, failed: ["throw"] });
    const verdict = await probeTranslateReadingOrder({
      extract: async () => {
        throw new Error("boom");
      },
      columns: TWO_COLUMN,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed).toContain("stage");
  });
});

describe("provesTranslateReadingOrder(env)", () => {
  it("is false where this host has no pdftotext to wire (never a throw)", async () => {
    await expect(
      provesTranslateReadingOrder({
        PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdftotext-for-this-test",
      }),
    ).resolves.toBe(false);
  });
});

describe("proofCorpusShortfall — the proof's corpus may not shrink or widen", () => {
  const declared = ["two-column", "Arabic", "prose (300 pages)"];

  it("health/positive control: the set measured equal to the set declared gives nothing", () => {
    expect(proofCorpusShortfall(declared, [...declared])).toEqual([]);
  });

  it("a document dropped from the measurement is named", () => {
    expect(
      proofCorpusShortfall(declared, ["two-column", "prose (300 pages)"]),
    ).toEqual(["Arabic: declared in the corpus but not measured"]);
  });

  it("an empty measurement names every declared document (never a vacuous pass)", () => {
    expect(proofCorpusShortfall(declared, [])).toHaveLength(declared.length);
  });

  it("a stand-in or a double count is named too (widening is a defect)", () => {
    expect(
      proofCorpusShortfall(declared, [...declared, "extra", "Arabic"]),
    ).toEqual([
      "Arabic: measured 2 times",
      "extra: measured but not declared in the corpus",
    ]);
  });
});
