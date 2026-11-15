import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  SUMMARY_LENGTHS,
  type SummarizeOptions,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import { AI_SPEND_CEILING } from "@/lib/jobs/ai-spend-ceiling";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "../ai/provider";
import {
  LENGTH_PLAN,
  runSummarize,
  SUMMARIZE_ENGINE,
  type PdfTextExtractor,
} from "./engine";

const OPTIONS: SummarizeOptions = { length: "standard", format: "paragraphs" };
const INPUT = new Uint8Array([1, 2, 3, 4]);

function extractorFor(text: string, pageCount = 3): PdfTextExtractor {
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

/** A deterministic provider that returns a fixed summary and records the request. */
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

describe("runSummarize — honest failures", () => {
  it("fails `unsupported` when no text extractor is wired", async () => {
    const run = await runSummarize(INPUT, OPTIONS, {
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  });

  it("fails `ai_unconfigured` with operator requirements when NO provider is configured", async () => {
    const extract = extractorFor("Plenty of real document text here.");
    const run = await runSummarize(INPUT, OPTIONS, { extract });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("ai_unconfigured");
      expect(run.retryable).toBe(false);
      expect(run.message).toContain("PDFXYZ_AI_PROVIDER");
      expect(run.message).toContain("PDFXYZ_AI_API_KEY");
    }
    // Honesty: with no provider we never even call a model, and never fabricate output.
    expect(extract).not.toHaveBeenCalled();
  });

  it("fails `no_text` (pointing at OCR) when the PDF has no selectable text", async () => {
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: extractorFor("   "),
      provider: providerReturning(SUCCESS("x")),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.kind).toBe("no_text");
      expect(run.message).toMatch(/OCR/i);
    }
  });

  it("fails `too_large` when input exceeds the byte limit", async () => {
    const run = await runSummarize(new Uint8Array(1000), OPTIONS, {
      extract: extractorFor("text"),
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
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
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
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
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
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: extractorFor("real text"),
      provider: providerReturning({
        ok: false,
        kind: "too_long",
        message: "big",
        retryable: false,
      }),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("too_large");
    // Audit #50 (summarize-pdf#6, 2026-11-06): the advice was "Try a shorter
    // PDF or a briefer summary". The length option sets only the OUTPUT
    // budget; the input that overflowed the context is the same at every
    // length, so a briefer summary reruns the same failure, charged again.
    if (!run.ok) {
      expect(run.message).not.toMatch(/summary/i);
      expect(run.message).toMatch(/shorter PDF/);
      expect(run.message).toMatch(/split/i);
    }
  });
});

describe("runSummarize — provider-injected deterministic success", () => {
  it("packages the model's REAL summary and never fabricates one", async () => {
    const provider = providerReturning(
      SUCCESS("This is the real model summary."),
    );
    const run = await runSummarize(
      INPUT,
      { length: "brief", format: "bullets", focus: "risks" },
      {
        extract: extractorFor(
          "A genuine document about quarterly results and risks.",
          5,
        ),
        provider,
        now: () => "2026-07-15T00:00:00.000Z",
      },
    );

    expect(run.ok).toBe(true);
    if (!run.ok) return;

    // The summary that ships is EXACTLY the provider's text — nothing invented.
    const zip = await JSZip.loadAsync(run.output);
    expect(await zip.file("summary.txt")!.async("string")).toBe(
      "This is the real model summary.",
    );
    expect(await zip.file("summary.md")!.async("string")).toContain(
      "This is the real model summary.",
    );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.provider).toBe("anthropic");
    expect(manifest.model).toBe("claude-sonnet-5");
    expect(manifest.options).toEqual({
      length: "brief",
      format: "bullets",
      focus: "risks",
    });

    // The system prompt constrains the model to the provided text (anti-hallucination).
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.system).toContain(
      "ONLY the content of the document",
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      "quarterly results and risks",
    );

    // Content-free meta carries counts, provider/model — never the document text.
    expect(run.meta).toMatchObject({
      engine: SUMMARIZE_ENGINE,
      provider: "anthropic",
      model: "claude-sonnet-5",
      length: "brief",
      pageCount: 5,
      truncated: false,
      summaryCharacters: "This is the real model summary.".length,
    });
  });

  it("truncates over-long input (never silently) and flags it in meta + manifest", async () => {
    const provider = providerReturning(SUCCESS("summary"));
    const longText = "word ".repeat(50);
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: extractorFor(longText),
      provider,
      limits: { maxInputChars: 20 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(true);
    // The prompt only carried the first 20 characters.
    expect(provider.calls[0]!.messages[0]!.content).toContain(
      longText.slice(0, 20),
    );
    const zip = await JSZip.loadAsync(run.output);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.source.truncatedToCharacters).toBe(20);
  });

  it("clamps the generation budget to the configured max output tokens", async () => {
    const provider = providerReturning(SUCCESS("s"));
    await runSummarize(
      INPUT,
      { length: "detailed", format: "paragraphs" },
      {
        extract: extractorFor("real text"),
        provider,
        limits: { maxOutputTokens: 512 },
      },
    );
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

function longExtractor(): PdfTextExtractor {
  const pages = LONG_PAGES.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const joined = LONG_PAGES.join("\n\n");
  const extracted: ExtractedPdfText = {
    pageCount: LONG_PAGES.length,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
  return vi.fn(async () => extracted);
}

describe("a short window is disclosed — to the model and to the job record", () => {
  it("tells the model it is seeing only part, and names the last COMPLETE page", async () => {
    const provider = providerReturning(SUCCESS("A summary."));
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);

    const system = provider.calls[0]?.system ?? "";
    // Not merely "some of the document was cut": the instruction that PRODUCED
    // the defect has to be revoked. For a summarizer that instruction is
    // "produce a summary" — its wrong claim is a summary of the first pages
    // presented as the summary of the document.
    expect(system).toMatch(
      /Never describe it as a summary of the whole document/,
    );
    expect(system).toMatch(/covers only pages 1-2 of 6/);
    expect(system).toMatch(/pages 1-2 of 6/);
    expect(system).toMatch(/mid-page/);
    // And NOT chat's revocation. A summarizer told "do not say the document
    // does not contain it" is being answered a question it never asked; the
    // shared helper used to hand that sentence to every tool.
    expect(system).not.toMatch(/do NOT say the document does not contain it/);
  });

  it("reports the window on meta so the panel can state it without the model", async () => {
    const provider = providerReturning(SUCCESS("A summary."));
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 500 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.window).toEqual({
      truncated: true,
      charactersSent: 500,
      charactersTotal: 1210,
      totalPages: 6,
      lastCompletePage: 2,
      cutMidPage: true,
    });
    expect(run.meta.truncationNotice).toMatch(/pages 1–2 of 6/);
  });

  it("says nothing at all when the whole document fits", async () => {
    const provider = providerReturning(SUCCESS("A summary."));
    const run = await runSummarize(INPUT, OPTIONS, {
      extract: longExtractor(),
      provider,
      limits: { maxInputChars: 100_000 },
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.truncated).toBe(false);
    expect(run.meta.truncationNotice).toBeNull();
    // A notice on an untruncated document would be its own false claim.
    expect(provider.calls[0]?.system ?? "").not.toMatch(/ONLY PART/);
  });
});

// ---------------------------------------------------------------------------
// The Detailed budget is the per-run output figure (audit summarize-pdf#2)
// ---------------------------------------------------------------------------

/** The `maxOutputTokens` a request of `length` actually SENDS, with no override. */
async function sentBudget(length: SummaryLength): Promise<number> {
  const provider = providerReturning(SUCCESS("s"));
  await runSummarize(
    INPUT,
    { length, format: "paragraphs" },
    { extract: extractorFor("real text"), provider },
  );
  expect(provider.calls).toHaveLength(1);
  return provider.calls[0]!.maxOutputTokens;
}

describe("the Detailed output budget is the per-run figure the daily ceiling is derived from", () => {
  it("SENDS AI_SPEND_CEILING.outputTokensPerFullRun for Detailed with no limits override", async () => {
    // Through behaviour, not the table: the value on the request is the one
    // the provider bills against, so that is the one pinned.
    const sent = await sentBudget("detailed");
    expect(sent).toBe(AI_SPEND_CEILING.outputTokensPerFullRun);
    // Positive control: the same assertion against a deliberately wrong
    // figure must fail, or the line above could not tell 8,000 from anything.
    expect(() => expect(sent).toBe(9_000)).toThrow();
  });

  it("orders the lengths Brief < Standard < Detailed <= outputTokensPerFullRun", async () => {
    // A second bound, independent of the equality above: a Detailed budget
    // that equals the ceiling but undercuts Standard is still wrong.
    const brief = await sentBudget("brief");
    const standard = await sentBudget("standard");
    const detailed = await sentBudget("detailed");
    expect(brief).toBeLessThan(standard);
    expect(standard).toBeLessThan(detailed);
    expect(detailed).toBeLessThanOrEqual(
      AI_SPEND_CEILING.outputTokensPerFullRun,
    );
    // The table and the wire agree for every length the options accept.
    expect(SUMMARY_LENGTHS.length).toBe(3);
    for (const length of SUMMARY_LENGTHS) {
      expect(await sentBudget(length)).toBe(LENGTH_PLAN[length].tokens);
    }
  });

  it("names the ceiling in the source, never a numeric literal (catches a literal 8000)", () => {
    // The behavioural test above cannot see `tokens: 8000`: the number is the
    // same today. This scan DISCOVERS LENGTH_PLAN's detailed entry in the
    // source and asserts it references the imported figure, so a literal
    // that would silently stop following the ceiling goes red now.
    const source = readFileSync(
      fileURLToPath(new URL("./engine.ts", import.meta.url)),
      "utf8",
    );
    const start = source.indexOf("export const LENGTH_PLAN");
    expect(start, "LENGTH_PLAN definition not found").toBeGreaterThan(-1);
    const end = source.indexOf("\n};", start);
    expect(end, "LENGTH_PLAN has no closing brace").toBeGreaterThan(start);
    const plan = source.slice(start, end);
    const tokensOf = (length: string): string => {
      const entry = plan.indexOf(`${length}: {`);
      expect(entry, `no ${length} entry in LENGTH_PLAN`).toBeGreaterThan(-1);
      const m = /tokens:\s*([^,\n]+),/.exec(plan.slice(entry));
      expect(m, `no tokens field on ${length}`).not.toBeNull();
      return m![1]!.trim();
    };
    // Health check: the scan reads real values. Brief IS a literal today, so
    // a scanner that returned nothing (or the wrong entry) fails here.
    expect(tokensOf("brief")).toMatch(/^[\d_]+$/);
    expect(tokensOf("detailed")).toBe(
      "AI_SPEND_CEILING.outputTokensPerFullRun",
    );
  });
});

// ---------------------------------------------------------------------------
// incomplete_output: honest words, and the spend travels (CLAUDE.md rule 3)
// ---------------------------------------------------------------------------

const DETAILED: SummarizeOptions = { length: "detailed", format: "paragraphs" };

/** What the provider returns when the model ran into `max_tokens`. */
const hitLimit = (limit: number): AiCompletionResult => ({
  ok: false,
  kind: "incomplete_output",
  retryable: false,
  message:
    "The AI model reached its output limit before finishing, so the answer would have been cut off. Try a shorter document or a briefer output.",
  usage: { inputTokens: 120_000, outputTokens: limit },
});

describe("incomplete_output names the limit it hit and carries what it spent", () => {
  it("is non-retryable, carries usage + window, delivers nothing, and does not advise a briefer output", async () => {
    const limit = AI_SPEND_CEILING.outputTokensPerFullRun;
    const provider = providerReturning(hitLimit(limit));
    const run = await runSummarize(INPUT, DETAILED, {
      extract: extractorFor("A very long report."),
      provider,
    });

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.retryable).toBe(false);
    // The failure that burned the most budget must carry its token counts.
    expect(run.usage?.outputTokens).toBe(limit);
    expect(run.usage?.calls).toBe(1);
    expect(run.usage?.model).toBe("claude-sonnet-5");
    expect(run.window).toBeDefined();
    // No artifact: a cut-off summary is a wrong answer, not a short one.
    expect(run).not.toHaveProperty("output");

    expect(run.message).toContain(limit.toLocaleString("en-US"));
    expect(run.message).toContain("Standard");
    expect(run.message).not.toMatch(/briefer output/i);
    expect(run.message).not.toMatch(/shorter document/i);
  });

  it("names the limit actually SENT when an operator limit is lower than the plan", async () => {
    // `plan.tokens` and the sent limit differ here; the model ran into the
    // lower one, so naming the plan's figure would be a false number.
    const lower = 3_000;
    expect(lower).toBeLessThan(LENGTH_PLAN.detailed.tokens);
    const provider = providerReturning(hitLimit(lower));
    const run = await runSummarize(INPUT, DETAILED, {
      extract: extractorFor("A very long report."),
      provider,
      limits: { maxOutputTokens: lower },
    });

    expect(provider.calls[0]!.maxOutputTokens).toBe(lower);
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.message).toContain("3,000-token");
    expect(run.message).not.toContain(
      LENGTH_PLAN.detailed.tokens.toLocaleString("en-US"),
    );
    expect(run.usage?.outputTokens).toBe(lower);
  });

  /**
   * The lengths a message tells the user to try. Reads the advice the way a
   * reader does: "Try <Length> length".
   */
  const recommended = (message: string): string[] =>
    [...message.matchAll(/Try (\w+) length/g)].map((m) => m[1]!);

  /** What the advice must satisfy for the length that just ran. */
  const adviceViolations = (length: SummaryLength, message: string) => {
    const problems: string[] = [];
    for (const named of recommended(message)) {
      const key = named.toLowerCase() as SummaryLength;
      if (!SUMMARY_LENGTHS.includes(key)) {
        problems.push(`recommends unknown length ${named}`);
      } else if (key === length) {
        problems.push(`recommends ${named}, the length that just ran`);
      } else if (LENGTH_PLAN[key].tokens >= LENGTH_PLAN[length].tokens) {
        problems.push(`recommends ${named}, which asks for no less output`);
      }
    }
    return problems;
  };

  it("never advises rerunning the length that just ran, for every length (review 2026-11-15)", async () => {
    // Until this review the message said "Try Standard length" whatever ran,
    // so a Standard run that hit 1,600 was told to send the identical request
    // again: it truncates identically and is charged again (audit #50 shape).
    // Every earlier test here used DETAILED only, so nothing could see it.
    expect(SUMMARY_LENGTHS.length).toBe(3);
    const messages = new Map<SummaryLength, string>();
    for (const length of SUMMARY_LENGTHS) {
      const sent = LENGTH_PLAN[length].tokens;
      const provider = providerReturning(hitLimit(sent));
      const run = await runSummarize(
        INPUT,
        { length, format: "paragraphs" },
        { extract: extractorFor("A very long report."), provider },
      );
      expect(run.ok).toBe(false);
      if (run.ok) return;
      expect(run.retryable).toBe(false);
      expect(run.usage?.outputTokens).toBe(sent);
      expect(run.message).toContain(`${sent.toLocaleString("en-US")}-token`);
      expect(run.message).toMatch(/split the PDF/);
      expect(run.message).not.toMatch(/briefer output|shorter document/i);
      expect(adviceViolations(length, run.message)).toEqual([]);
      messages.set(length, run.message);
    }

    // Health check: the reader sees the advice. Detailed and Standard name a
    // shorter length; Brief, the shortest, names none and says so.
    expect(recommended(messages.get("detailed")!)).toEqual(["Standard"]);
    expect(recommended(messages.get("standard")!)).toEqual(["Brief"]);
    expect(recommended(messages.get("brief")!)).toEqual([]);
    expect(messages.get("brief")).toContain("already the shortest length");

    // The names the advice uses are the words the length picker shows, so a
    // reader can find the option the message tells them to pick.
    const panel = readFileSync(
      fileURLToPath(
        new URL(
          "../../../components/tools/summarize-worker-panel.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    for (const length of SUMMARY_LENGTHS) {
      const name = length.charAt(0).toUpperCase() + length.slice(1);
      expect(panel).toContain(`{ value: "${length}", label: "${name} — `);
    }

    // Positive control: the message this branch shipped before the review
    // must fail the predicate for Standard, or the loop above proves nothing.
    const shipped =
      "The summary reached its 1,600-token output limit before it finished, so nothing was delivered rather than a summary missing its end. Try Standard length, or split the PDF and summarize a part.";
    expect(adviceViolations("standard", shipped)).toEqual([
      "recommends Standard, the length that just ran",
    ]);
    expect(adviceViolations("brief", shipped.replace("1,600", "700"))).toEqual([
      "recommends Standard, which asks for no less output",
    ]);
  });
});
