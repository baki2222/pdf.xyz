import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type { ChatOptions } from "@/lib/jobs/chat-with-pdf";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import { bm25Scores, queryTermsFor } from "@/lib/pdf/page-retrieval";
import { runChatWithPdf, CHAT_ENGINE, type PdfTextExtractor } from "./engine";

const QUESTION: ChatOptions = { question: "What is the invoice total?" };
const INPUT = new Uint8Array([1, 2, 3, 4]);

/** Build an extractor whose pages carry per-page text (so citations are possible). */
function extractorForPages(pageTexts: string[]): PdfTextExtractor {
  const pages: ExtractedTextPage[] = pageTexts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const joined = pageTexts.filter((t) => t.trim().length > 0).join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: pageTexts.length,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: joined.trim().length > 0,
  };
  return vi.fn(async () => extracted);
}

/** Build an extractor with joined text but NO per-page metadata (grounded === false). */
function extractorForText(text: string, pageCount = 2): PdfTextExtractor {
  const trimmed = text.trim();
  const extracted: ExtractedPdfText = {
    pageCount,
    pages: [],
    text,
    characterCount: text.length,
    hasText: trimmed.length > 0,
  };
  return vi.fn(async () => extracted);
}

function providerReturning(
  result: AiCompletionResult,
): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return result;
    },
  };
}

const SUCCESS = (text: string): AiCompletionResult => ({
  ok: true,
  text,
  model: "claude-sonnet-5",
  usage: { inputTokens: 100, outputTokens: 20 },
});

describe("runChatWithPdf — honest failures", () => {
  it("fails `unsupported` when no text extractor is wired", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails `ai_unconfigured` with operator requirements when NO provider is configured", async () => {
    const extract = extractorForPages(["Real document text."]);
    const run = await runChatWithPdf(INPUT, QUESTION, { extract });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("ai_unconfigured");
      expect(run.retryable).toBe(false);
      expect(run.message).toContain("PDFXYZ_AI_PROVIDER");
      expect(run.message).toContain("PDFXYZ_AI_API_KEY");
    }
    // Honesty: with no provider we never read the PDF and never fabricate an answer.
    expect(extract).not.toHaveBeenCalled();
  });

  it("fails `no_text` (pointing at OCR) when the PDF has no selectable text", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("   "),
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("no_text");
      expect(run.message).toMatch(/OCR/i);
    }
  });

  it("fails `too_large` when input exceeds the byte limit", async () => {
    const run = await runChatWithPdf(new Uint8Array(1000), QUESTION, {
      extract: extractorForText("text"),
      provider: providerReturning(SUCCESS("x")),
      limits: { maxInputBytes: 10 },
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("too_large");
      expect(run.limitBytes).toBe(10);
    }
  });

  it("maps a provider rate_limit to a retryable `rate_limited`", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning({
        ok: false,
        kind: "rate_limited",
        message: "slow",
        retryable: true,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok)
      expect(run).toMatchObject({ kind: "rate_limited", retryable: true });
  });

  it("maps a provider refusal to `content_filtered`", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning({
        ok: false,
        kind: "content_filtered",
        message: "no",
        retryable: false,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("content_filtered");
  });

  it("maps a provider too_long to `too_large`", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning({
        ok: false,
        kind: "too_long",
        message: "big",
        retryable: false,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
  });

  it("fails `failed` (never fabricates) when the model returns an empty answer", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider: providerReturning(SUCCESS("   ")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("runChatWithPdf — provider-injected deterministic success", () => {
  it("answers from ONLY the document text, grounds the prompt in page markers, and packages the real answer", async () => {
    const provider = providerReturning(
      SUCCESS("The invoice total is $1,200 [p.2]."),
    );
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages([
        "Cover page.",
        "Invoice INV-42, grand total $1,200.",
      ]),
      provider,
      now: () => "2026-07-16T00:00:00.000Z",
    });

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    // The shipped answer is EXACTLY the model's text — nothing invented.
    const answerTxt = await zip.file("answer.txt")!.async("string");
    expect(answerTxt).toContain("The invoice total is $1,200");
    const answerMd = await zip.file("answer.md")!.async("string");
    expect(answerMd).toContain("What is the invoice total?");
    expect(answerMd).toContain("The invoice total is $1,200");
    expect(await zip.file("README.txt")).not.toBeNull();

    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.schema).toBe("pdfxyz.chat/v1");
    expect(manifest.provider).toBe("anthropic");
    expect(manifest.model).toBe("claude-sonnet-5");
    expect(manifest.question).toBe("What is the invoice total?");
    expect(manifest.grounded).toBe(true);
    expect(manifest.answer.citedPages).toEqual([2]);
    // No secret leaks into the package.
    expect(JSON.stringify(manifest)).not.toContain("PDFXYZ_AI_API_KEY");

    // The system prompt constrains the model to the provided text and enables page citation.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toMatch(/ONLY/);
    expect(provider.calls[0]!.system).toContain("[Page 2]");
    expect(provider.calls[0]!.system).toContain("$1,200");
    // The question is the final user turn.
    const msgs = provider.calls[0]!.messages;
    expect(msgs[msgs.length - 1]).toEqual({
      role: "user",
      content: "What is the invoice total?",
    });
    // Deterministic QA: temperature pinned to 0.
    expect(provider.calls[0]!.temperature).toBe(0);

    expect(run.meta).toMatchObject({
      engine: CHAT_ENGINE,
      provider: "anthropic",
      model: "claude-sonnet-5",
      pageCount: 2,
      contextTurns: 0,
      citedPages: 1,
      grounded: true,
      truncated: false,
    });
  });

  // Audit #41 (chat-with-pdf#8, 2026-11-06): the citation reader matched only
  // the single "[p.N]" form, so a grouped "[p.3, p.5]" or a range "[pp. 1-2]"
  // was dropped from manifest.citedPages and the "Cited pages" line.
  it("counts grouped and ranged citations, within the page range", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(["one", "two", "three", "four", "five"]),
      provider: providerReturning(
        SUCCESS(
          "Totals are on [p.3, p.5]; the terms span [pp. 1-2]; see also [p. 4] and [p.9, 12].",
        ),
      ),
      now: () => "2026-11-06T00:00:00.000Z",
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    // 9 and 12 are past the 5-page document and are dropped, as before.
    expect(manifest.answer.citedPages).toEqual([1, 2, 3, 4, 5]);
    expect(run.meta).toMatchObject({ citedPages: 5 });
  });

  it("prepends the conversation context turns before the final question", async () => {
    const provider = providerReturning(SUCCESS("It is due on March 1 [p.1]."));
    const run = await runChatWithPdf(
      INPUT,
      {
        question: "And the due date?",
        context: [
          { role: "user", content: "What is the invoice number?" },
          { role: "assistant", content: "It is INV-42 [p.1]." },
        ],
      },
      { extract: extractorForPages(["Invoice INV-42 due March 1."]), provider },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(provider.calls[0]!.messages).toEqual([
      { role: "user", content: "What is the invoice number?" },
      { role: "assistant", content: "It is INV-42 [p.1]." },
      { role: "user", content: "And the due date?" },
    ]);
    expect(run.meta.contextTurns).toBe(2);
  });

  it("is explicit that answers are ungrounded when the extractor has no page metadata", async () => {
    const provider = providerReturning(SUCCESS("The answer is 42."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText(
        "The answer is 42 somewhere in this flat text.",
      ),
      provider,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.grounded).toBe(false);
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.grounded).toBe(false);
    expect(manifest.notice).toMatch(/without page-level citations/i);
    // No page markers when there is no page metadata to cite.
    expect(provider.calls[0]!.system).not.toContain("[Page 1]");
  });

  it("truncates over-long source text (never silently) and flags it in meta + manifest", async () => {
    const provider = providerReturning(SUCCESS("Answer."));
    const longText = "word ".repeat(50);
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText(longText),
      provider,
      limits: { maxInputChars: 20 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(true);
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.source.truncatedToCharacters).toBe(20);
  });

  it("clamps the generation budget to the configured max output tokens", async () => {
    const provider = providerReturning(SUCCESS("Answer."));
    await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForText("real text"),
      provider,
      limits: { maxOutputTokens: 512 },
    });
    expect(provider.calls[0]!.maxOutputTokens).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// Truncation disclosure (TASK-43)
// ---------------------------------------------------------------------------

/**
 * Six pages of 200 characters each, joined by a blank line: offsets 0, 202, 404,
 * 606, 808, 1010, total 1,210. A 500-character cap therefore lands 96 characters
 * INTO page 3 — so page 2 is the last complete page and the cut is mid-page.
 */
const LONG_PAGES = Array.from({ length: 6 }, (_, i) =>
  String.fromCharCode(97 + i).repeat(200),
);

/**
 * HISTORY (slice 3, audit #30, 2026-11-16): the three tests below and the
 * flat-text test above ("truncates over-long source text") were written for
 * a worker that always sent a prefix. Page retrieval did NOT invert them,
 * and their assertions are unchanged: they now pin the two branches where
 * retrieval must leave the request as main sent it. "truncates over-long
 * source text" is UNGROUNDED (no page metadata, so no page can be chosen);
 * these three are the NO-MATCH branch (QUESTION shares no term with
 * LONG_PAGES, so no page scores and the prefix goes byte-for-byte). The
 * health check "QUESTION scores 0 against LONG_PAGES" at the end of this
 * file keeps them that way: if QUESTION ever scored, they would silently
 * become relevance tests and stop pinning anything.
 */
describe("a short window is disclosed — to the model and to the job record", () => {
  /**
   * Chat grounds each page as "[Page N]\n<text>", so a page's chunk is longer
   * than its text. The expected numbers are DERIVED from that assembly here
   * rather than copied, because a hand-written constant that happens to match a
   * wrong implementation is exactly the failure mode this feature exists to fix.
   */
  const chunk = (n: number) => `[Page ${n}]\n${LONG_PAGES[n - 1]}`;
  const GROUNDING = LONG_PAGES.map((_, i) => chunk(i + 1)).join("\n\n");
  // Offsets: page 1 at 0, page 2 at chunk(1).length + 2, page 3 after that.
  const P2 = chunk(1).length + 2;
  const P3 = P2 + chunk(2).length + 2;
  const CAP = P3 + 10; // ten characters into page 3

  it("tells the model it is seeing only part, and names the last COMPLETE page", async () => {
    const provider = providerReturning(SUCCESS("An answer."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(LONG_PAGES),
      provider,
      limits: { maxInputChars: CAP },
    });
    expect(run.ok).toBe(true);

    const system = provider.calls[0]?.system ?? "";
    expect(system).toMatch(/do NOT say the document does not contain it/);
    expect(system).toMatch(/pages 1-2 of 6/);
    expect(system).toMatch(/mid-page/);
  });

  it("reports the window on meta so the panel can state it without the model", async () => {
    const provider = providerReturning(SUCCESS("An answer."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(LONG_PAGES),
      provider,
      limits: { maxInputChars: CAP },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.window).toEqual({
      truncated: true,
      charactersSent: CAP,
      charactersTotal: GROUNDING.length,
      totalPages: 6,
      lastCompletePage: 2,
      cutMidPage: true,
    });
    expect(run.meta.truncationNotice).toMatch(/pages 1–2 of 6/);
  });

  it("counts the DOCUMENT's pages, not just the ones carrying text", async () => {
    // Two blank pages among eight. "of 6" would be a number the user can go and
    // check against the file and find wrong.
    const withBlanks = [
      ...LONG_PAGES.slice(0, 3),
      "",
      ...LONG_PAGES.slice(3),
      "",
    ];
    const provider = providerReturning(SUCCESS("An answer."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(withBlanks),
      provider,
      limits: { maxInputChars: CAP },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.window.totalPages).toBe(8);
    expect(run.meta.truncationNotice).toMatch(/pages 1–2 of 8/);
  });

  it("says nothing at all when the whole document fits", async () => {
    const provider = providerReturning(SUCCESS("An answer."));
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(LONG_PAGES),
      provider,
      limits: { maxInputChars: 100_000 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(false);
    expect(run.meta.truncationNotice).toBeNull();
    expect(provider.calls[0]?.system ?? "").not.toMatch(/ONLY PART/);
  });
});

describe("the download can audit the caching bet", () => {
  it("carries all three token classes into the manifest", async () => {
    // §3 of the review: the bet is "turn one pays a write premium, a later turn
    // collects". Until 2026-08-11 the manifest showed two of three classes, so
    // the COST side was invisible and a zero read could not be told apart from
    // "never cached". Anthropic's `input` is the uncached remainder only.
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages([
        "Cover page.",
        "Invoice INV-42, grand total $1,200.",
      ]),
      provider: providerReturning({
        ok: true,
        text: "The invoice total is $1,200 [p.2].",
        model: "claude-sonnet-5",
        usage: {
          inputTokens: 20,
          outputTokens: 300,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 40_000,
        },
      }),
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(
      manifest.usage,
      "the download shows fewer token classes than the job record — the write " +
        "premium is the cost side of the caching bet and without it the " +
        "decision cannot be audited from the artefact",
    ).toEqual({ input: 20, output: 300, cachedInput: 0, cacheWrite: 40_000 });
    // Still v1: an optional additive field breaks no reader.
    expect(manifest.schema).toBe("pdfxyz.chat/v1");
  });

  it("omits cacheWrite entirely when the provider did not report it", async () => {
    // Absent means NOT MEASURED. Every manifest before this commit is in that
    // state and there is no back-fill, so a zero here would be a fabricated
    // measurement of history.
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages([
        "Cover page.",
        "Invoice INV-42, grand total $1,200.",
      ]),
      provider: providerReturning(
        SUCCESS("The invoice total is $1,200 [p.2]."),
      ),
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect("cacheWrite" in manifest.usage).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Page retrieval (slice 3, audit #30): pages chosen for THIS question
// ---------------------------------------------------------------------------

describe("the no-match pins stay no-match", () => {
  it("QUESTION scores 0 against LONG_PAGES", () => {
    const chunks = LONG_PAGES.map((text, i) => ({
      pageNumber: i + 1,
      text: `[Page ${i + 1}]\n${text}`,
    }));
    const scores = bm25Scores(chunks, queryTermsFor(QUESTION.question));
    // Health: every page is scored, so an all-zero map is a measurement.
    expect(scores.size).toBe(6);
    expect([...scores.values()]).toEqual([0, 0, 0, 0, 0, 0]);
    // Positive control: a term that IS on one page scores that page.
    const planted = bm25Scores(chunks, ["c".repeat(200)]);
    expect(planted.get(3)).toBeGreaterThan(0);
  });
});

const FILLER_WORDS =
  "alpha bravo cobalt delta ember fjord granite harbor island juniper kestrel lumen meadow nickel orchard pewter quarry russet saffron timber umber velvet willow xenon yarrow zinc".split(
    " ",
  );

/** 40 pages of seeded filler (~400 characters each), plants added by page. */
function contract(plants: Record<number, string> = {}): string[] {
  let a = 11;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 40 }, (_, i) => {
    const body = Array.from(
      { length: 60 },
      () => FILLER_WORDS[Math.floor(next() * FILLER_WORDS.length)]!,
    );
    if (plants[i + 1]) body.splice(30, 0, plants[i + 1]!);
    return body.join(" ");
  });
}

const CAP_3000 = { maxInputChars: 3_000 };
const PLANTED = contract({ 30: "Zephyrine" });
const ZEPHYRINE: ChatOptions = {
  question: "What does the Zephyrine clause say?",
};

/** The text between the DOCUMENT START and END lines of a system prompt. */
function documentBlock(system: string): string {
  const open = "--- DOCUMENT START ---\n";
  const start = system.indexOf(open);
  const end = system.indexOf("\n--- DOCUMENT END ---");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return system.slice(start + open.length, end);
}

async function manifestOf(output: Uint8Array) {
  const zip = await JSZip.loadAsync(output);
  return JSON.parse(await zip.file("manifest.json")!.async("string"));
}

describe("a question whose page lies past the prefix gets that page", () => {
  it("sends [Page 30] inside the document, names non-contiguous spans, and never claims pages 1-N", async () => {
    const provider = providerReturning(SUCCESS("It says [p.30]."));
    const run = await runChatWithPdf(INPUT, ZEPHYRINE, {
      extract: extractorForPages(PLANTED),
      provider,
      limits: CAP_3000,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const system = provider.calls[0]!.system ?? "";
    const doc = documentBlock(system);
    // INSIDE the [Page 30] chunk of the document block — the question also
    // carries the word, so "somewhere in the request" proves nothing.
    expect(doc).toMatch(/\[Page 30\]\n[^[]*Zephyrine/);
    expect(system).not.toMatch(/pages 1-\d+ of/);
    expect(system).toMatch(/of 40/);
    expect(system).toMatch(/do NOT say the document does not contain it/);
    // The relevance revocation, not main's: "may appear later" is false of a
    // page set with gaps. And the anchor arm, since pages 1.. were sent.
    expect(system).toContain("the answer may be on a page you were not given.");
    expect(system).not.toContain("may appear later in the document");
    expect(system).toMatch(
      /of 40: the opening pages and pages chosen by the words they share with the question; other pages were not sent/,
    );
    // The read bound: the document block plus the notice's page list is
    // within what the route charged.
    const list = /covers pages ([\d–, ]+) of 40/.exec(system)?.[1] ?? "";
    expect(list).toMatch(/\b30\b/);
    expect(doc.length + list.length).toBeLessThanOrEqual(3_000);

    expect(run.meta.selection).toBe("relevance");
    expect(run.meta.truncated).toBe(true);
    expect(run.meta.window.selection).toBe("relevance");
    expect(run.meta.window.lastCompletePage).toBeNull();
    expect(run.meta.window.charactersSent).toBe(doc.length);
    const spans = run.meta.window.pagesSent ?? [];
    expect(spans.some(([a, b]) => a <= 30 && 30 <= b)).toBe(true);
    // Not one opening run: the anchor and the chosen page are apart.
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(run.meta.truncationNotice).toMatch(/\b30\b/);
    expect(run.meta.truncationNotice).not.toMatch(/pages 1–\d+ of/);

    const manifest = await manifestOf(run.output);
    expect(manifest.source.selection).toBe("relevance");
    expect(
      (manifest.source.pagesSent as [number, number][]).some(
        ([a, b]) => a <= 30 && 30 <= b,
      ),
    ).toBe(true);
    expect(manifest.source.truncatedToCharacters).toBe(doc.length);
    expect(manifest.schema).toBe("pdfxyz.chat/v1");
    const readme = await (
      await JSZip.loadAsync(run.output)
    )
      .file("README.txt")!
      .async("string");
    expect(readme).toMatch(/Pages read: .*\b30\b/);
  });

  it("does not cache a relevance request's system prompt; whole and prefix still do", async () => {
    const relevance = providerReturning(SUCCESS("x"));
    await runChatWithPdf(INPUT, ZEPHYRINE, {
      extract: extractorForPages(PLANTED),
      provider: relevance,
      limits: CAP_3000,
    });
    const prefix = providerReturning(SUCCESS("x"));
    const prefixRun = await runChatWithPdf(
      INPUT,
      { question: "What is the governing currency?" },
      {
        extract: extractorForPages(PLANTED),
        provider: prefix,
        limits: CAP_3000,
      },
    );
    const whole = providerReturning(SUCCESS("x"));
    const wholeRun = await runChatWithPdf(INPUT, ZEPHYRINE, {
      extract: extractorForPages(PLANTED.slice(0, 3)),
      provider: whole,
    });
    expect(relevance.calls[0]!.cacheSystem).toBe(false);
    expect(prefix.calls[0]!.cacheSystem).toBe(true);
    expect(whole.calls[0]!.cacheSystem).toBe(true);
    // And each took the branch its name says.
    expect(prefixRun.ok && prefixRun.meta.selection).toBe("prefix");
    expect(wholeRun.ok && wholeRun.meta.selection).toBe("whole");
    expect(prefix.calls[0]!.system).not.toContain("[Page 30]");
    if (prefixRun.ok) expect(prefixRun.meta.window.selection).toBeUndefined();
  });

  it("sends a page the previous answer cited, outside the prefix, for a follow-up with no informative word", async () => {
    const provider = providerReturning(SUCCESS("x"));
    const run = await runChatWithPdf(
      INPUT,
      {
        question: "And the one after?",
        context: [
          { role: "user", content: "What is the opening term?" },
          { role: "assistant", content: "It is set out on [p.35]." },
        ],
      },
      { extract: extractorForPages(contract()), provider, limits: CAP_3000 },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(documentBlock(provider.calls[0]!.system ?? "")).toContain(
      "[Page 35]\n",
    );
    expect(run.meta.selection).toBe("relevance");
  });

  it("the selector seam forced to prefix sends main's prefix", async () => {
    const seamed = providerReturning(SUCCESS("x"));
    const run = await runChatWithPdf(INPUT, ZEPHYRINE, {
      extract: extractorForPages(PLANTED),
      provider: seamed,
      limits: CAP_3000,
      selectPages: () => ({ strategy: "prefix", reason: "no-signal" }),
    });
    expect(run.ok && run.meta.selection).toBe("prefix");
    expect(seamed.calls[0]!.system).not.toContain("[Page 30]");
    expect(seamed.calls[0]!.system).toMatch(/pages 1-\d+ of 40/);
  });
});

describe("a billed call that fails afterwards still reports what it spent", () => {
  // Rule 3: both branches returned after a billed provider call with neither
  // usage nor window, so the spend hook saw 0 tokens for a call that was paid.
  const SPENT = {
    inputTokens: 100,
    outputTokens: 20,
    calls: 1,
    model: "claude-sonnet-5",
  };

  it("the empty-answer branch carries usage and window", async () => {
    const run = await runChatWithPdf(INPUT, ZEPHYRINE, {
      extract: extractorForPages(PLANTED),
      provider: providerReturning(SUCCESS("   ")),
      limits: CAP_3000,
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("failed");
    expect(run.usage).toEqual(SPENT);
    expect(run.window?.selection).toBe("relevance");
  });

  it("the package-too-large branch carries usage and window", async () => {
    const run = await runChatWithPdf(INPUT, QUESTION, {
      extract: extractorForPages(["Cover page.", "Invoice total $1,200."]),
      provider: providerReturning(SUCCESS("The total is $1,200 [p.2].")),
      limits: { maxOutputBytes: 1 },
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toMatch(/exceeds the worker size limit/);
    expect(run.usage).toEqual(SPENT);
    expect(run.window).toMatchObject({ truncated: false, totalPages: 2 });
  });
});
