// @vitest-environment node
/**
 * A read-bound AI job reads no more than the route charged it for.
 *
 * THE DEFECT (2026-09-28): `POST /api/jobs` reserves `deliveryCapFor(...)`
 * characters of the daily allowance and hands that cap to the worker as
 * `ProcessorInput.delivery`. Translate's processor read it; Summarize, Chat
 * and AI Data Extraction never did, and read up to 500,000 characters whatever
 * was reserved. A job that declared ONE character was read in full.
 *
 * WHY NOTHING CAUGHT IT: `delivery-cap.chain.test.ts` and the translate tests
 * pinned the cap where it was enforced, and nothing asked where it was NOT.
 * A field consumed by one of four processors is this codebase's recurring
 * shape, not a smaller version of the feature.
 *
 * WHAT IS READ: the text the PROVIDER receives, not the processor's own meta —
 * a sentinel placed past the cap must not reach the model. The corpus is the
 * real processor registry, resolved for every AI tool in the catalog.
 *
 * INTEGRATED: this lane enforced the cap with `processor/read-cap.ts`; the
 * branch it merged into already enforced it with `./read-cap-limit.ts`, which
 * the worker's start-up proof (`read-cap-proof.ts`) runs and the route's
 * pricing trusts. The lane's module was not kept; this file is kept as a
 * second, independent reader of the property, over the processors that ship.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { AI_RUN_PRICING } from "@/lib/jobs/delivery-cap";
import { createProcessorRegistry } from "./index";
import type { ProcessorInput } from "./types";

/**
 * The tools priced per call, whose processors read a prefix under the cap —
 * from the pricing table the route charges by. (Written against this lane's
 * own list in `ai-read-declaration.ts`; that module was subsumed at the
 * integration of wave1/l01-page-leak, and the processors it drives here are
 * the ones `./read-cap-limit.ts` bounds.)
 */
const READ_BOUND_AI_TOOLS = Object.entries(AI_RUN_PRICING)
  .filter(([, pricing]) => pricing === "per-call")
  .map(([slug]) => slug)
  .sort();

/** Past the cap every test uses, so reaching the model means over-reading. */
const SENTINEL = "ZQXJ-PAST-THE-RESERVATION";
const CAP = 400;
const BEFORE =
  "The invoice total is 1200 euros and payment is due in thirty days. ";
const TEXT = (BEFORE.repeat(12) + SENTINEL + " " + BEFORE.repeat(4)).trim();

const extract = async (): Promise<ExtractedPdfText> => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: TEXT, characterCount: TEXT.length }],
  text: TEXT,
  characterCount: TEXT.length,
  hasText: true,
});

/** Records what the model was actually sent. */
function recordingProvider() {
  const sent: string[] = [];
  const provider: AiProvider = {
    id: "openai",
    model: "gpt-test",
    async complete(request: AiCompletionRequest) {
      sent.push(
        [request.system, ...request.messages.map((m) => m.content)].join("\n"),
      );
      return {
        ok: true,
        text: '{"total": 1200}',
        model: "gpt-test",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  return { provider, sent };
}

/** The minimal valid options for each tool this file drives. */
const OPTIONS: Record<string, Record<string, unknown>> = {
  "summarize-pdf": {},
  "chat-with-pdf": { question: "What is the total?" },
  "ai-extract": { mode: "prompt", prompt: "Extract the total." },
};

async function run(slug: string, delivery?: unknown) {
  const { provider, sent } = recordingProvider();
  const deps = { extract, provider };
  const registry = createProcessorRegistry({
    summarize: deps,
    translate: deps,
    aiExtract: deps,
    chatWithPdf: deps,
  });
  const processor = registry.resolve(slug);
  if (!processor) throw new Error(`no processor resolves ${slug}`);
  const input: ProcessorInput = {
    tool: slug,
    options: OPTIONS[slug] ?? {},
    inputs: [
      {
        fileId: "f_abc123def456",
        filename: "in.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
    ...(delivery !== undefined
      ? { delivery: delivery as ProcessorInput["delivery"] }
      : {}),
  };
  const result = await processor.process(input);
  return { result, sent };
}

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .map((tool) => tool.slug);

describe("the corpus", () => {
  it("every read-bound tool is a catalog AI tool with a registered processor", () => {
    // Derived in one direction from the catalog, typed in the other: a
    // read-bound name the catalog does not have is decoration, and the check
    // below would pass vacuously over it.
    expect(READ_BOUND_AI_TOOLS.length).toBeGreaterThanOrEqual(3);
    for (const slug of READ_BOUND_AI_TOOLS) {
      expect(AI_TOOLS, `${slug} is not an AI tool in the catalog`).toContain(
        slug,
      );
    }
    // And every catalog AI tool is either read-bound or the one output-bound
    // tool, whose cap is chunk-shaped and pinned in `translate/`. A fifth AI
    // tool must be classified here before it ships.
    const unclassified = AI_TOOLS.filter(
      (slug) =>
        !(READ_BOUND_AI_TOOLS as readonly string[]).includes(slug) &&
        slug !== "translate-pdf",
    );
    expect(unclassified).toEqual([]);
  });

  it("health: the sentinel really sits past the cap, and the text really fits without one", () => {
    expect(TEXT.indexOf(SENTINEL)).toBeGreaterThan(CAP);
    expect(TEXT.length).toBeLessThan(10_000);
  });
});

describe.each(READ_BOUND_AI_TOOLS.map((slug) => [slug] as const))(
  "%s — the reservation is enforced",
  (slug) => {
    it("reads no further than the delivery cap", async () => {
      const { result, sent } = await run(slug, { characters: CAP });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(sent.length, "the provider was never called").toBe(1);
      expect(
        sent[0],
        `${slug} sent text past its ${CAP}-character reservation to the model — ` +
          "the charge is decorative",
      ).not.toContain(SENTINEL);
      // And it says so: the window the panel renders records the cut.
      const window = result.ok ? result.results?.ai?.truncation : undefined;
      expect(window?.truncated).toBe(true);
      expect(window?.charactersSent).toBe(CAP);
    });

    it("POSITIVE CONTROL: with no cap the same document reaches the model whole", async () => {
      // Without this, "the sentinel is absent" could mean the extractor or the
      // prompt never carried it at all.
      const { result, sent } = await run(slug);
      expect(result.ok).toBe(true);
      expect(sent[0]).toContain(SENTINEL);
    });

    it("a cap larger than the document cuts nothing", async () => {
      const { result, sent } = await run(slug, { characters: 1_000_000 });
      expect(result.ok).toBe(true);
      expect(sent[0]).toContain(SENTINEL);
      const window = result.ok ? result.results?.ai?.truncation : undefined;
      expect(window?.truncated).toBe(false);
    });

    it("fails CLOSED on a malformed cap, before the provider is paid", async () => {
      for (const broken of [{ characters: 0 }, { pages: 2 }, "lots", 7]) {
        const { result, sent } = await run(slug, broken);
        expect(
          result.ok,
          `${slug} ran a job whose cap was ${JSON.stringify(broken)}`,
        ).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("internal_error");
        expect(sent).toEqual([]);
      }
    });
  },
);
