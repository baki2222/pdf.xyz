// @vitest-environment node
/**
 * Page markers through the COMPOSED chain: stub extractor → `runTranslate` →
 * the ZIP at artifacts[0] and the PDF renderer's INPUT (a recording
 * `deps.pdf.render`). Not the units: `./page-map`'s corpus and the planner's
 * properties are proven elsewhere; this file proves the path through them
 * drops nothing and adds nothing.
 *
 * Two provider arms over every document:
 *
 *  - ECHO returns the segment between the `---` delimiters verbatim. The
 *    recorded segments carry the markers, the render input is one body per
 *    page headed "Page 1".."Page n", and `meta.pageMap.verified === marked`.
 *  - MARKER-STRIPPING returns the segment with every `separatorFor(n)` put
 *    back to `PAGE_JOIN` (built from `./page-markers`, never a typed
 *    pattern). The render input keeps one range body per chunk, and
 *    `fellBack.missing === marked`.
 *
 * For both, translation.md and translation.txt are byte-identical between
 * the arms (P3), translation.txt is main's shape — the delivered pages' sent
 * text joined by "\n\n" with the gaps written by main's `gapMarkdown` — and
 * neither file nor the typeset PDF text holds "pdfxyz" in its NFKC form (P5).
 *
 * The documents: the S3 reading-order pairs as one document (one chunk at the
 * shipped ceiling, several under a small one), and a 12-page document,
 * uncapped and under a cap that withholds pages.
 *
 * Plus the D2 request shapes (the marker instruction on a marked segment
 * with and without a part clause; main's literal on every other), and the D7
 * strip-then-judge rule for a reply of nothing but markers.
 */
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { PAGE_JOIN, type ExtractedPdfText } from "@/lib/pdf/text";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import {
  concatReadingOrderPairs,
  discoverReadingOrderPairs,
} from "@/tests/reading-order-pairs";
import {
  TRANSLATE_CHARS_PER_OUTPUT_TOKEN,
  TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  translateMaxInputChars,
} from "@/lib/jobs/translate-limits";
import type { AiPageMapMeta } from "@/lib/jobs/ai-results";
import { gapMarkdown } from "./assembly";
import { capPagesToDelivery, type DeliveryLimit } from "./chunking";
import {
  pageMarkerClause,
  runTranslate,
  type TranslateDeps,
  type TranslateRun,
} from "./engine";
import { markerFor, separatorFor } from "./page-markers";
import {
  composeReadingOrderExtractor,
  translatePageBlocks,
  type TranslateExtractor,
} from "./reading-order";
import { pageRangeLabel, typesetText, type TypesetInput } from "./typeset";

const NL = String.fromCharCode(10);
const OPEN = `${NL}---${NL}`;
const CLOSE = `${NL}---`;
const OPTIONS = { targetLanguage: "fr", sourceLanguage: "auto" } as const;
const INPUT = new Uint8Array([1, 2, 3]);
const NOW = () => "2026-11-16T00:00:00.000Z";
/** Far above any page number a document here carries. */
const MAX_PAGE = 999;

const nfkcBrand = (text: string) => /pdfxyz/i.test(text.normalize("NFKC"));

function segmentOf(request: AiCompletionRequest): string {
  const content = request.messages[0]!.content;
  const open = content.indexOf(OPEN);
  const close = content.lastIndexOf(CLOSE);
  if (open < 0 || close <= open) throw new Error("no delimited segment");
  return content.slice(open + OPEN.length, close);
}

/** Every separator put back to the PAGE_JOIN it replaced, from separatorFor. */
function stripSeparators(segment: string): string {
  let out = segment;
  for (let n = 1; n <= MAX_PAGE; n += 1)
    out = out.split(separatorFor(n)).join(PAGE_JOIN);
  return out;
}

type Recording = AiProvider & { calls: AiCompletionRequest[] };

function providerAnswering(
  answer: (segment: string, i: number) => AiCompletionResult,
): Recording {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return answer(segmentOf(request), calls.length - 1);
    },
  };
}

const ok = (text: string): AiCompletionResult => ({
  ok: true,
  text,
  model: "claude-sonnet-5",
  usage: { inputTokens: 10, outputTokens: 5 },
});
const echo = () => providerAnswering((segment) => ok(segment));
const stripping = () =>
  providerAnswering((segment) => ok(stripSeparators(segment)));

/** A renderer that records its input and prints nothing. */
function recordingPdf() {
  const inputs: TypesetInput[] = [];
  const pdf: NonNullable<TranslateDeps["pdf"]> = {
    languages: () => new Set(["fr"]),
    render: async ({ input }) => {
      inputs.push(input);
      return { ok: true, bytes: new Uint8Array([37, 80, 68, 70]), pages: 1 };
    },
  };
  return { pdf, inputs };
}

async function zipText(run: TranslateRun) {
  if (!run.ok) throw new Error(`run failed: ${run.kind} ${run.message}`);
  const zip = await JSZip.loadAsync(run.output);
  return {
    md: await zip.file("translation.md")!.async("string"),
    txt: await zip.file("translation.txt")!.async("string"),
  };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function invariants(map: AiPageMapMeta) {
  const f = map.fellBack;
  expect(map.marked + f.collision + f.budget).toBe(map.multiPageChunks);
  expect(map.verified + f.missing + f.order + f.empty + map.unanswered).toBe(
    map.marked,
  );
}

interface Doc {
  readonly name: string;
  readonly extract: TranslateExtractor;
  readonly limits: TranslateDeps["limits"];
}

const PAIRS = discoverReadingOrderPairs();
const PAIRS_DOC = concatReadingOrderPairs(PAIRS);
const pairsExtract = composeReadingOrderExtractor(
  async () => PAIRS_DOC.layout,
  async () => PAIRS_DOC.flow,
);

/** Twelve pages, each holding words unique to it, ~1,500 characters each. */
function twelvePages(): ExtractedPdfText {
  const pages = Array.from({ length: 12 }, (_, i) => {
    const words = Array.from(
      { length: 190 },
      (_, w) => `p${i + 1}w${w}${w % 11 === 10 ? "." : ""}`,
    );
    const text = words.join(" ");
    return { pageNumber: i + 1, text, characterCount: text.length };
  });
  const text = pages.map((p) => p.text).join(PAGE_JOIN);
  return {
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}
const TWELVE = twelvePages();
const twelveExtract: TranslateExtractor = async () => TWELVE;
const firstNine = TWELVE.pages
  .slice(0, 9)
  .reduce((n, p) => n + p.text.length, 0);

const DOCS: readonly Doc[] = [
  { name: "S3 pairs, shipped ceiling", extract: pairsExtract, limits: {} },
  {
    name: "S3 pairs, ~1,000-character ceiling",
    extract: pairsExtract,
    limits: {
      maxOutputTokens: Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN),
    },
  },
  { name: "12 pages, uncapped", extract: twelveExtract, limits: {} },
  {
    name: "12 pages, a cap that withholds pages 10-12",
    extract: twelveExtract,
    // Enough slack over nine pages for every marker they need.
    limits: { delivery: { characters: firstNine + 400 } },
  },
];

/** What the engine plans, from the same inputs: the oracle for page-sets. */
async function planFor(doc: Doc) {
  const extracted = await doc.extract(INPUT);
  const { blocks } = translatePageBlocks(extracted.pages);
  const ceiling = translateMaxInputChars(
    doc.limits?.maxOutputTokens ?? TRANSLATE_DEFAULT_MAX_OUTPUT_TOKENS,
  );
  const limit: DeliveryLimit = doc.limits?.delivery ?? {
    characters: Number.POSITIVE_INFINITY,
  };
  const capped = capPagesToDelivery(blocks, ceiling, limit);
  const sent = new Map(blocks.map((b) => [b.pageNumber, b.send ?? b.text]));
  return { capped, sent, limit };
}

/**
 * main's translation.txt for a job with no empty reply: the delivered pages'
 * sent text joined by "\n\n", and the withheld gap (when there is one) by
 * main's `gapMarkdown`. Written from the plan's page lists, never from a body.
 */
function mainShape(plan: Awaited<ReturnType<typeof planFor>>): string {
  const pages = plan.capped.plan.chunks.flatMap((c) => c.pages);
  const bodies = pages.map((n) => plan.sent.get(n)!).join(NL + NL);
  const withheld = plan.capped.withheldPages;
  if (withheld.length === 0) return bodies;
  return (
    bodies +
    NL +
    NL +
    gapMarkdown({
      kind: "gap",
      reason: "withheld",
      pages: withheld,
      boundBy: plan.capped.boundBy!,
      limit: plan.limit,
    })
  );
}

describe("page markers through runTranslate, the ZIP and the render input", () => {
  it("health: the S3 pairs are discovered and every document plans a marked chunk", async () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(12);
    for (const doc of DOCS) {
      const { capped } = await planFor(doc);
      expect(
        capped.plan.chunks.some((c) => c.marked),
        `${doc.name}: no marked chunk`,
      ).toBe(true);
      expect(capped.plan.oversize, doc.name).toHaveLength(0);
    }
    const withheld = await planFor(DOCS[3]!);
    expect(withheld.capped.withheldPages).toEqual([10, 11, 12]);
  });

  for (const doc of DOCS) {
    it(`${doc.name}: echo heads page by page, stripping heads by range, and the ZIP is main's either way`, async () => {
      const plan = await planFor(doc);
      const chunks = plan.capped.plan.chunks;
      const marked = chunks.filter((c) => c.marked).length;

      const echoed = echo();
      const echoPdf = recordingPdf();
      const viaEcho = await runTranslate(INPUT, OPTIONS, {
        extract: doc.extract,
        provider: echoed,
        now: NOW,
        limits: doc.limits,
        pdf: echoPdf.pdf,
      });
      const stripped = stripping();
      const stripPdf = recordingPdf();
      const viaStrip = await runTranslate(INPUT, OPTIONS, {
        extract: doc.extract,
        provider: stripped,
        now: NOW,
        limits: doc.limits,
        pdf: stripPdf.pdf,
      });
      expect(viaEcho.ok && viaStrip.ok, doc.name).toBe(true);
      if (!viaEcho.ok || !viaStrip.ok) return;

      // The wire: one call per chunk, and the marked segments carry their
      // markers, in order.
      expect(echoed.calls).toHaveLength(chunks.length);
      for (const [i, chunk] of chunks.entries()) {
        const segment = segmentOf(echoed.calls[i]!);
        expect(segment, `${doc.name} #${i}`).toBe(chunk.text);
        for (const page of chunk.pages.slice(1))
          expect(segment.includes(markerFor(page)), `${doc.name} #${i}`).toBe(
            chunk.marked,
          );
      }

      // The meta.
      expect(viaEcho.meta.pageMap.marked).toBe(marked);
      expect(viaEcho.meta.pageMap.verified).toBe(marked);
      expect(viaStrip.meta.pageMap.marked).toBe(marked);
      expect(viaStrip.meta.pageMap.verified).toBe(0);
      expect(viaStrip.meta.pageMap.fellBack.missing).toBe(marked);
      invariants(viaEcho.meta.pageMap);
      invariants(viaStrip.meta.pageMap);

      // The render input: echo is one body per delivered page; stripping is
      // one body per chunk.
      const delivered = chunks.flatMap((c) => c.pages);
      const headings = (input: TypesetInput) =>
        input.parts
          .filter((p) => p.kind === "body")
          .map((p) => pageRangeLabel(p.pages));
      expect(echoPdf.inputs).toHaveLength(1);
      expect(stripPdf.inputs).toHaveLength(1);
      expect(headings(echoPdf.inputs[0]!)).toEqual(
        delivered.map((n) => `Page ${n}`),
      );
      expect(headings(stripPdf.inputs[0]!)).toEqual(
        chunks.map((c) => pageRangeLabel(c.pages)),
      );
      // Each page's body is its own sent text: nothing moved across a page.
      for (const part of echoPdf.inputs[0]!.parts)
        if (part.kind === "body")
          expect(part.text).toBe(plan.sent.get(part.pages[0]!));
      expect(
        echoPdf.inputs[0]!.parts.filter((p) => p.kind === "gap").length,
      ).toBe(plan.capped.withheldPages.length > 0 ? 1 : 0);

      // P3: the ZIP is main's, and the same under both arms.
      const a = await zipText(viaEcho);
      const b = await zipText(viaStrip);
      expect(sha(a.txt)).toBe(sha(b.txt));
      expect(sha(a.md)).toBe(sha(b.md));
      expect(a.txt).toBe(mainShape(plan));
      expect(a.md.includes(a.txt)).toBe(true);

      // P5 (this document holds no "pdfxyz"): no reader sees a marker.
      for (const text of [
        a.txt,
        a.md,
        b.txt,
        b.md,
        typesetText(echoPdf.inputs[0]!),
        typesetText(stripPdf.inputs[0]!),
      ])
        expect(nfkcBrand(text), doc.name).toBe(false);
    });
  }
});

// ── the requests (D2) ────────────────────────────────────────────────────────

/** A plain extractor over these page texts. */
function pagesOf(texts: readonly string[]): TranslateExtractor {
  const pages = texts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const text = texts.join(PAGE_JOIN);
  return async () => ({
    pageCount: pages.length,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  });
}

const SHORT = ["Alder one.", "Birch two.", "Cedar three."];

async function requestsFor(
  extract: TranslateExtractor,
  extra: Partial<TranslateDeps> = {},
  options: Parameters<typeof runTranslate>[1] = OPTIONS,
) {
  const provider = echo();
  const run = await runTranslate(INPUT, options, {
    extract,
    provider,
    now: NOW,
    ...extra,
  });
  return { run, contents: provider.calls.map((c) => c.messages[0]!.content) };
}

describe("the marker instruction (D2): only on a marked segment, and main's literal on every other", () => {
  it("a multi-page document that fits ONE chunk (no part clause) carries the instruction", async () => {
    const { contents } = await requestsFor(pagesOf(SHORT));
    expect(contents).toEqual([
      `Translate the following document.${pageMarkerClause(2)}${NL}${NL}---${NL}` +
        `Alder one.${separatorFor(2)}Birch two.${separatorFor(3)}Cedar three.${NL}---`,
    ]);
    expect(pageMarkerClause(2)).toBe(
      ` Lines such as ${markerFor(2)} mark where a page of the original begins: copy each one exactly as it is, on a line of its own, in the same place, and do not translate it.`,
    );
  });

  it("a marked segment of a MANY-part job carries it after the part clause, naming its own first marked page", async () => {
    // Nine ~260-character pages under a ~1,000-character ceiling: 3 parts.
    const texts = Array.from({ length: 9 }, (_, i) =>
      `Page ${i + 1} words `.repeat(20).trim(),
    );
    const limits = {
      maxOutputTokens: Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN),
    };
    const { run, contents } = await requestsFor(pagesOf(texts), { limits });
    expect(run.ok).toBe(true);
    expect(contents.length).toBeGreaterThan(1);
    let markedSeen = 0;
    for (const [i, content] of contents.entries()) {
      const part = ` (This is part ${i + 1} of ${contents.length} of one document; translate only the text given, and do not add any note about it being a part.)`;
      const segment = content.slice(
        content.indexOf(OPEN) + OPEN.length,
        content.lastIndexOf(CLOSE),
      );
      const first = Array.from({ length: 9 }, (_, n) => n + 1).find((n) =>
        segment.includes(separatorFor(n)),
      );
      if (first === undefined) {
        expect(content).toBe(
          `Translate the following document.${part}${NL}${NL}---${NL}${segment}${NL}---`,
        );
      } else {
        markedSeen += 1;
        expect(content).toBe(
          `Translate the following document.${part}${pageMarkerClause(first)}${NL}${NL}---${NL}${segment}${NL}---`,
        );
      }
    }
    expect(markedSeen, "health: a marked part").toBeGreaterThan(1);
  });

  it("a one-page document: main's literal", async () => {
    const { contents } = await requestsFor(pagesOf(["Alder one."]));
    expect(contents).toEqual([
      `Translate the following document.${NL}${NL}---${NL}Alder one.${NL}---`,
    ]);
  });

  it("a collision segment (a page quoting a marker): main's literal, joined by PAGE_JOIN", async () => {
    const quoted = `Our docs show ${markerFor(2)} as an example.`;
    const { run, contents } = await requestsFor(
      pagesOf(["Alder one.", quoted]),
    );
    expect(contents).toEqual([
      `Translate the following document.${NL}${NL}---${NL}Alder one.${PAGE_JOIN}${quoted}${NL}---`,
    ]);
    // Its reply is untouched: the echo carries the document's own marker.
    if (!run.ok) throw new Error("run failed");
    expect(run.meta.pageMap.fellBack.collision).toBe(1);
    expect((await zipText(run)).txt).toBe(`Alder one.${PAGE_JOIN}${quoted}`);
  });

  it("instructions that hold the brand: every multi-page chunk is main's literal (collision)", async () => {
    const { run, contents } = await requestsFor(
      pagesOf(SHORT),
      {},
      {
        ...OPTIONS,
        instructions: "Keep the word PDFXYZ as it is",
      },
    );
    expect(contents).toEqual([
      `Translate the following document.${NL}${NL}---${NL}${SHORT.join(PAGE_JOIN)}${NL}---`,
    ]);
    if (!run.ok) throw new Error("run failed");
    expect(run.meta.pageMap.fellBack.collision).toBe(1);
    expect(run.meta.pageMap.marked).toBe(0);
  });

  it("a budget-fallback segment: main's literal", async () => {
    const total = SHORT.reduce((n, t) => n + t.length, 0);
    // The whole document fits the cap, and 20 characters of slack pay for
    // no marker (the cheapest costs 21).
    const { run, contents } = await requestsFor(pagesOf(SHORT), {
      limits: { delivery: { characters: total + 20 } },
    });
    expect(contents).toEqual([
      `Translate the following document.${NL}${NL}---${NL}${SHORT.join(PAGE_JOIN)}${NL}---`,
    ]);
    if (!run.ok) throw new Error("run failed");
    expect(run.meta.pageMap.fellBack.budget).toBe(1);
    expect(run.meta.delivery).toBeUndefined();
  });

  it("an unchunked document (no page structure): main's literal", async () => {
    const text = "Alder one. Birch two.";
    const { contents } = await requestsFor(async () => ({
      pageCount: 2,
      pages: [],
      text,
      characterCount: text.length,
      hasText: true,
    }));
    expect(contents).toEqual([
      `Translate the following document.${NL}${NL}---${NL}${text}${NL}---`,
    ]);
  });
});

// ── strip, then judge (D7) ──────────────────────────────────────────────────

describe("a reply of nothing but markers is unanswered, judged on the STRIPPED text", () => {
  const markersOnly = (segment: string) =>
    ok(
      Array.from({ length: MAX_PAGE }, (_, n) => n + 1)
        .filter((n) => segment.includes(separatorFor(n)))
        .map((n) => markerFor(n))
        .join(NL + NL),
    );

  it("a single marked call: the empty-translation failure, carrying pageMap with unanswered 1", async () => {
    const provider = providerAnswering((segment) => markersOnly(segment));
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagesOf(SHORT),
      provider,
      now: NOW,
    });
    expect(provider.calls).toHaveLength(1);
    // Health: the reply was not empty RAW.
    expect(markersOnly(segmentOf(provider.calls[0]!))).toMatchObject({
      text: `${markerFor(2)}${NL}${NL}${markerFor(3)}`,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toBe("The AI provider returned an empty translation.");
    expect(run.pageMap).toEqual({
      multiPageChunks: 1,
      marked: 1,
      verified: 0,
      unanswered: 1,
      fellBack: { collision: 0, budget: 0, missing: 0, order: 0, empty: 0 },
      markerCharacters: 42,
    });
  });

  it("one marked part of many: a hole (interrupted gap), never a heading over nothing", async () => {
    const texts = Array.from({ length: 9 }, (_, i) =>
      `Page ${i + 1} words `.repeat(20).trim(),
    );
    const { pdf, inputs } = recordingPdf();
    const provider = providerAnswering((segment, i) =>
      i === 0 ? markersOnly(segment) : ok(segment),
    );
    const run = await runTranslate(INPUT, OPTIONS, {
      extract: pagesOf(texts),
      provider,
      now: NOW,
      pdf,
      limits: {
        maxOutputTokens: Math.ceil(1_000 / TRANSLATE_CHARS_PER_OUTPUT_TOKEN),
      },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(segmentOf(provider.calls[0]!).includes(separatorFor(2))).toBe(true);
    expect(run.meta.pageMap.unanswered).toBe(1);
    invariants(run.meta.pageMap);
    const first = inputs[0]!.parts[0]!;
    expect(first.kind).toBe("gap");
    expect(first.kind === "gap" && first.reason).toBe("interrupted");
    expect(nfkcBrand(typesetText(inputs[0]!))).toBe(false);
  });
});

// ── a marker glued into text with no spaces (the composed chain) ────────────

describe("a marker glued into unspaced text: every word reaches the ZIP and the render input", () => {
  const cp = (...codes: number[]) => String.fromCodePoint(...codes);
  // Japanese and Thai page texts, from code points; no space between words.
  const ja1 = cp(
    0x3053,
    0x308c,
    0x306f,
    0x4e00,
    0x30da,
    0x30fc,
    0x30b8,
    0x3002,
  );
  const ja2 = cp(
    0x3053,
    0x308c,
    0x306f,
    0x4e8c,
    0x30da,
    0x30fc,
    0x30b8,
    0x3002,
  );
  const th1 = cp(0x0e2b, 0x0e19, 0x0e49, 0x0e32, 0x0e41, 0x0e23, 0x0e01);
  const th2 = cp(0x0e2b, 0x0e19, 0x0e49, 0x0e32, 0x0e2a, 0x0e2d, 0x0e07);
  const lenticular = (inner: string) => `${cp(0x3010)}${inner}${cp(0x3011)}`;

  for (const [name, first, second, glue] of [
    [
      "Japanese, re-bracketed in lenticular brackets",
      ja1,
      ja2,
      lenticular("PDFXYZ_PAGE_2"),
    ],
    ["Thai, brackets dropped", th1, th2, "PDFXYZ_PAGE_2"],
  ] as const) {
    it(`${name}: missing, and the second page's words survive`, async () => {
      // The model glues the marker to both neighbours: no whitespace at all.
      const provider = providerAnswering((segment) =>
        ok(segment.split(separatorFor(2)).join(glue)),
      );
      const { pdf, inputs } = recordingPdf();
      const run = await runTranslate(INPUT, OPTIONS, {
        extract: pagesOf([first, second]),
        provider,
        now: NOW,
        pdf,
      });
      // Health: the marker was sent, and the reply really is glued.
      expect(provider.calls).toHaveLength(1);
      const segment = segmentOf(provider.calls[0]!);
      expect(segment).toBe(`${first}${separatorFor(2)}${second}`);
      expect(run.ok).toBe(true);
      if (!run.ok) return;
      expect(run.meta.pageMap.fellBack.missing).toBe(1);
      invariants(run.meta.pageMap);
      const { md, txt } = await zipText(run);
      for (const body of [md, txt, typesetText(inputs[0]!)]) {
        expect(body).toContain(`${first}${second}`);
        expect(nfkcBrand(body)).toBe(false);
      }
    });
  }
});
