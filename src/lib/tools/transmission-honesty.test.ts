// @vitest-environment node
/**
 * What a page says about SENDING the document must match what the engine does
 * with it.
 *
 * The privacy page said, of Chat with PDF, that "a follow-up does not resend the
 * whole document". Two surfaces one click away said the opposite — the panel
 * ("The PDF is re-sent and re-read each time") and the engine's own comment
 * ("The document is re-sent verbatim on every follow-up"). The engine and the
 * panel were right.
 *
 * This is not a wording defect. Whether a user's document reaches a third party
 * once or on every question is the fact a privacy-conscious reader opens that
 * paragraph to learn, and prompt caching does not change it: `cache_control`
 * marks a reusable prefix so a matching request is billed at roughly a tenth and
 * skips recomputation. It changes COST AND COMPUTE, NOT TRANSMISSION. The bytes
 * are in every request either way.
 *
 * THE PRECONDITION IS EXECUTED, NOT ASSERTED BY STRING. This file runs the real
 * engine twice — once cold, once with prior turns — and proves the document text
 * is in BOTH system prompts before it polices a single word of copy. A guard
 * anchored on a source comment would keep passing after the behaviour changed;
 * this one goes red the moment the engine stops re-sending, which is exactly
 * when the forbidden sentence would become true and the rule should be deleted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText, ExtractedTextPage } from "@/lib/pdf/text";
import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiProvider,
} from "@/lib/workers/ai/provider";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "./copy-surface";

const ROOT = process.cwd();

/** A phrase distinctive enough that finding it in a prompt proves the document went. */
const DOCUMENT_MARKER = "Sentinel clause 47B applies to the whole estate";

function extractor() {
  const pages: ExtractedTextPage[] = [
    {
      pageNumber: 1,
      text: `${DOCUMENT_MARKER}. Invoice total: $1,240.00.`,
      characterCount: 60,
    },
  ];
  const joined = pages[0]!.text;
  const extracted: ExtractedPdfText = {
    pageCount: 1,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
  return vi.fn(async () => extracted);
}

function recordingProvider(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return {
        ok: true,
        text: "The total is $1,240.00 [p.1].",
        model: "claude-sonnet-5",
        usage: { inputTokens: 40, outputTokens: 9 },
      } satisfies AiCompletionResult;
    },
  };
}

describe("the document really is re-sent on every turn", () => {
  it("puts the document in the FIRST and the FOLLOW-UP request", async () => {
    const provider = recordingProvider();
    const deps = { extract: extractor(), provider };

    await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      { question: "What is the total?" },
      deps,
    );
    // A follow-up: prior turns supplied, exactly as the panel supplies them.
    await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      {
        question: "And when is it due?",
        context: [
          { role: "user", content: "What is the total?" },
          { role: "assistant", content: "The total is $1,240.00 [p.1]." },
        ],
      },
      deps,
    );

    expect(provider.calls).toHaveLength(2);
    for (const [index, call] of provider.calls.entries()) {
      expect(
        call.system,
        `request ${index + 1} did not carry the document text — if this is a real behaviour change, DELETE the copy rule below rather than weakening this`,
      ).toContain(DOCUMENT_MARKER);
    }
  });

  it("asks for caching, which is a billing hint and not a substitute for sending", async () => {
    const provider = recordingProvider();
    await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      { question: "What is the total?" },
      { extract: extractor(), provider },
    );
    // Both facts hold at once, and conflating them is what produced the defect:
    // the request asks the provider to cache, AND carries the document in full.
    expect(provider.calls[0]?.cacheSystem).toBe(true);
    expect(provider.calls[0]?.system).toContain(DOCUMENT_MARKER);
  });
});

/**
 * Claims that a follow-up avoids sending the document again.
 *
 * NOTE these are phrased as negations on purpose, and this rule deliberately
 * does NOT use `marketing-honesty`'s denial classifier. There, the offence was a
 * promise and a negation made it innocent. Here the offence IS the negation —
 * running it through a "skip anything negated" filter would skip every single
 * one. Same repository, opposite polarity; a shared helper applied without
 * thinking would have emptied this guard on day one.
 */
export const FORBIDDEN = [
  /does\s?n'?t resend/i,
  /does not resend/i,
  /without resending/i,
  /never resent/i,
  /is not sent again/i,
  /only sent once/i,
  /sent (?:just |only )?once/i,
  /no need to resend/i,
];

/** Every forbidden transmission claim in `source`, near a chat/follow-up subject. */
function transmissionClaimsIn(source: string): string[] {
  const found: string[] = [];
  for (const pattern of FORBIDDEN) {
    for (const match of source.matchAll(new RegExp(pattern, "gi"))) {
      const at = match.index ?? 0;
      // Scoped to the conversational tools: a sentence about an upload being
      // sent once is about something else entirely.
      const near = source
        .slice(Math.max(0, at - 400), at + 400)
        .match(/chat|follow-?up|conversation|question/i);
      if (near) found.push(match[0]);
    }
  }
  return found;
}

describe("no page claims a follow-up avoids sending the document", () => {
  it("reads the copy files, so a move cannot quietly empty this rule", () => {
    expect(copyFiles().length).toBeGreaterThanOrEqual(10);
  });

  it("finds no such claim on any user-facing page", () => {
    const offenders: string[] = [];
    for (const file of copyFiles()) {
      // Flattened: a phrase search has a hole at every wrap point, and the
      // patterns below are multi-word. Proven 2026-08-11 — the banned
      // phrases sat in a walked file split across a line and this guard
      // passed. See `flattenForPhraseSearch`.
      const source = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      for (const claim of transmissionClaimsIn(source)) {
        offenders.push(`${path.relative(ROOT, file)}: "${claim}"`);
      }
    }
    expect(
      offenders,
      `these say a follow-up avoids re-sending the document, which the engine above disproves:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the rule can still fire — the sentence that was live is caught", () => {
    // POSITIVE CONTROL, and it is the real string. A rule that quietly stopped
    // matching would read as "no page claims this", which is how the sentence
    // survived in the first place.
    const wasLive =
      "the document's text is held briefly in the provider's cache between your questions, so a follow-up does not resend the whole document";
    expect(transmissionClaimsIn(wasLive).length).toBeGreaterThan(0);
  });
});
