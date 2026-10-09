// @vitest-environment node
/**
 * The allowance sentence says what the limiter does — and says it once.
 *
 * It read *"3 free AI runs a day, shared across everyone using pdf.xyz right
 * now"*, which was TRUE when written: `identity.ts` handed every caller
 * `SHARED_BUCKET_TOKEN`, so there was one bucket for the whole product. Then the
 * limiter was fixed and the copy was not. Production reports
 * `remote-configured`, not `remote-configured-shared`; each visitor has their own
 * three runs; and the product went on telling them a stranger might have spent
 * them. The refusal even said *"it may not reflect your own usage"*, sending
 * someone who had spent nothing looking for somebody to blame.
 *
 * TWO PROPERTIES, and the second is the durable one:
 *  1. the words match the enforced policy;
 *  2. **there is one copy of them.** The sentence existed in six places — four
 *     literal duplicates, the constant those four ignored, and a third
 *     independent copy in a different module. A constant used by one of its six
 *     call sites is not a source of truth; it is a seventh copy.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_ALLOWANCE_CLAUSE,
  AI_ALLOWANCE_FACT,
  AI_ALLOWANCE_RUNS,
  AI_ALLOWANCE_USED_MESSAGE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  aiAllowanceFactFor,
} from "@/lib/jobs/ai-allowance";
import { flattenForPhraseSearch, withoutComments } from "./copy-surface";

const ROOT = process.cwd();

/** Every non-test source file, walked. A list is the thing that drifts. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  return out.filter((f) => statSync(f).isFile());
}

describe("the words match the enforced policy", () => {
  it("does not claim the allowance is shared", () => {
    // The exact claim that went stale. `policy.ts` has said `per client per day`
    // in a comment the whole time; nothing made the copy read it.
    for (const text of [
      AI_ALLOWANCE_FACT,
      AI_ALLOWANCE_USED_MESSAGE,
      AI_ALLOWANCE_CLAUSE,
      AI_ALLOWANCE_RUNS,
    ]) {
      expect(text.toLowerCase()).not.toContain("shared across everyone");
      expect(text.toLowerCase()).not.toContain("may not reflect your own");
    }
  });

  it("the stale claim appears nowhere in the source tree", () => {
    // The one assertion here that can fail against the shipped code: the exact
    // words were in six files. Asserted over the WALKED tree rather than the
    // constants, because the constants are new and a test that can only pass is
    // not evidence of anything.
    // Comments stripped first: the docblock explaining this defect quotes the
    // very sentence it forbids, and a guard that cries wolf is a guard the
    // next person weakens. Only what a user can read counts.
    // Flattened first: the phrase is long enough that prettier splits it across
    // lines as `"…everyone " + "using pdf.xyz…"`, and a literal search walks
    // straight past that. Demonstrated 2026-08-11 — this assertion stayed green
    // with the banned sentence sitting in a walked file, split at a space.
    const offenders = sourceFiles().filter((file) =>
      /shared across everyone using pdf\.xyz/.test(
        flattenForPhraseSearch(withoutComments(readFileSync(file, "utf8"))),
      ),
    );
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "These still say the AI allowance is shared across all visitors. It is " +
        "per client — `policy.ts` says `per client per day`, production reports " +
        "`remote-configured` rather than `remote-configured-shared`, and every " +
        "action derives its bucket from the same `deriveClientToken`.",
    ).toEqual([]);
  });

  it("attributes the allowance to the connection, and derives the number", () => {
    // NOT "your own three runs" — that shipped for one commit and was a claim
    // about the reader's conduct. The counter keys on a forwarded address, so
    // the connection is the largest thing it can honestly name. The banned
    // shapes and their corpus live in `ratelimit/allowance-copy.test.ts`.
    expect(AI_ALLOWANCE_FACT).toContain("connection");
    expect(AI_ALLOWANCE_USED_MESSAGE).toContain("connection");
    // AMENDED TWICE, and the second time is the instructive one.
    //
    // The unit moved from runs to characters when chunking made a run a
    // variable amount of spend. But the assertion underneath was
    // `toContain(String(3))` — a ONE-CHARACTER substring — and the first
    // character budget was 37,024, which contains a "3". So this guard passed
    // for the wrong reason across a commit that changed the sentence entirely,
    // and only failed when the number became 61,548.
    //
    // A `toContain` on a single digit is satisfiable by accident by almost any
    // number. It now derives the whole rendered figure, which cannot be.
    //
    // AMENDED A THIRD TIME: it derived the whole figure, and derived it from
    // the wrong one. `AI_CHARACTER_ALLOWANCE` is the limiter's bucket in
    // worker-extracted characters; this sentence is read by someone holding a
    // document, who can only count what the browser counts. Deriving is not
    // sufficient — the constant also has to be in the reader's unit.
    expect(AI_ALLOWANCE_FACT).toContain(
      AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US"),
    );
    expect(AI_ALLOWANCE_FACT).toMatch(/characters/i);
  });

  it("promises no isolation and no availability", () => {
    // A separate internal spend ceiling exists as a circuit breaker, is never
    // published, and can stop AI for everyone. These sentences say what the
    // allowance IS; claiming it is guaranteed or private would be a promise the
    // product cannot keep, and the opposite failure to the one just fixed.
    const both =
      `${AI_ALLOWANCE_FACT} ${AI_ALLOWANCE_USED_MESSAGE}`.toLowerCase();
    for (const overclaim of [
      "guarantee",
      "guaranteed",
      "always available",
      "private to you",
      "only you",
      "nobody else",
    ]) {
      expect(
        both,
        `the allowance copy must not promise "${overclaim}"`,
      ).not.toContain(overclaim);
    }
  });

  it("keeps the offer and the refusal distinct, sharing the quantity", () => {
    // One string serving both surfaces is how the refusal came to carry a hedge
    // that only made sense while the bucket was shared. What they must share is
    // the NUMBER and what it counts — not the cadence: an offer states a rate,
    // a refusal states an exhausted quantity, and gluing "a day" into the
    // refusal produced "your 3 free AI runs a day for today".
    expect(AI_ALLOWANCE_FACT).not.toBe(AI_ALLOWANCE_USED_MESSAGE);
    expect(AI_ALLOWANCE_FACT).toContain(AI_ALLOWANCE_CLAUSE);
    expect(AI_ALLOWANCE_CLAUSE).toContain(AI_ALLOWANCE_RUNS);
    expect(AI_ALLOWANCE_USED_MESSAGE).toContain(AI_ALLOWANCE_RUNS);
  });
});

describe("there is exactly one copy of the sentence", () => {
  it("no source file writes the allowance sentence out by hand", () => {
    // Walked, not listed. The duplicates were in three different modules and a
    // list of the ones we knew about is what let the fourth through.
    const offenders = sourceFiles().filter((file) => {
      // Comments stripped, like its sibling above and for the same reason: the
      // rule that history stays in a comment and the rule that the sentence
      // exists once will otherwise fight, and the guard loses — `copy-surface.ts`
      // records the sentence it MEASURED the guards against, which is evidence,
      // not a second copy. A commented-out duplicate renders to nobody; a real
      // one is still code and still caught.
      const source = withoutComments(readFileSync(file, "utf8"));
      const isTheSource = file
        .replace(/\\/g, "/")
        .endsWith("jobs/ai-allowance.ts");
      if (isTheSource) return false;
      // `free AI runs`, not `free AI runs a day`: the refusal drops the cadence,
      // so a hand-written refusal would have slipped a phrase-anchored net —
      // the same way `You have used your` slipped a ban on `you've used your`.
      return /free AI runs\b/.test(source);
    });

    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "These write the allowance sentence out instead of importing it from " +
        "@/lib/jobs/ai-allowance. It lived in six places once, and five of them " +
        "went stale together when the limiter changed underneath.",
    ).toEqual([]);
  });

  it("the panels reach the sentence through the shared source", async () => {
    // Reach, not membership: the re-exports must actually resolve to the same
    // string, or "one copy" is true of the source and false of what renders.
    //
    // INVERTED 2026-09-27, history kept. This asserted
    // `AI_DAILY_ALLOWANCE_NOTE === AI_ALLOWANCE_FACT` — one note for four
    // panels — and so pinned the defect: that sentence is translate's
    // character figure, and Summarize, Chat and Extract are charged per run.
    // "One copy" is still the rule; it is now one FUNCTION, keyed by tool, and
    // the panel note must be exactly what the tool's own fact line says.
    //
    // A sibling lane had meanwhile split the note in two
    // (`AI_DAILY_ALLOWANCE_NOTE` for translate, `AI_PER_CALL_ALLOWANCE_NOTE`
    // for the per-call tools) and asserted each equal to its source. Since the
    // merge that per-call sentence is the head of every per-call tool's own
    // fact, so its reach is asserted per tool below, through the pricing map
    // the route charges by.
    const { aiDailyAllowanceNote } =
      await import("@/lib/workers/ai-tool-availability");
    const { AI_ALLOWANCE_FACT: fromTools, toolFacts } =
      await import("./tool-facts");
    const { AI_PER_CALL_ALLOWANCE_FACT } =
      await import("@/lib/jobs/ai-allowance");
    const { AI_RUN_PRICING } = await import("@/lib/jobs/delivery-cap");
    const { AI_ALLOWANCE_USED_MESSAGE: fromRateLimit } =
      await import("@/lib/ratelimit/response");
    const { tools } = await import("./index");
    const { capabilityForMode } = await import("@/lib/jobs/capabilities");

    const ai = tools.filter((t) => capabilityForMode(t.processing) === "ai");
    expect(ai.length, "no AI tool in the catalogue — blind").toBeGreaterThan(0);
    const perCall = ai.filter((t) => AI_RUN_PRICING[t.slug] === "per-call");
    expect(perCall.length, "no per-call AI tool — blind").toBeGreaterThan(0);
    for (const tool of ai) {
      const fact = toolFacts(tool.slug).find(
        (f) => f.label === "Free allowance",
      );
      expect(fact, `${tool.slug} publishes no allowance fact`).toBeDefined();
      expect(aiDailyAllowanceNote(tool.slug)).toBe(fact!.value);
      expect(fact!.value).toBe(aiAllowanceFactFor(tool.slug));
      if (AI_RUN_PRICING[tool.slug] === "per-call") {
        expect(
          fact!.value.startsWith(AI_PER_CALL_ALLOWANCE_FACT),
          `${tool.slug}'s panel does not reach the per-call sentence`,
        ).toBe(true);
      } else {
        expect(fact!.value.startsWith(AI_ALLOWANCE_FACT)).toBe(true);
      }
    }
    expect(fromTools).toBe(AI_ALLOWANCE_FACT);
    expect(fromRateLimit).toBe(AI_ALLOWANCE_USED_MESSAGE);
  });
});

describe("the refusal speaks to a reader, about every AI tool", () => {
  /**
   * Until 2026-09-28 the served refusal ended *"On a shared network that can
   * include text translated by someone else. The allowance resets daily; retry
   * after the interval in the Retry-After header."* Summarize, Chat and AI Data
   * Extraction spend the same bucket, and the panel renders this string
   * verbatim — so a reader refused after three extractions was told about
   * somebody's translations and pointed at an HTTP header.
   *
   * INTEGRATED (wave1/l01-page-leak onto integrate/wave1-seo). This lane wrote
   * the refusal to name NO tool's work and to append its own "It resets in
   * about N hours." The branch it merged into had already fixed the same
   * sentence the other way — naming EVERY AI tool's unit, so it is true on each
   * page (`ratelimit/allowance-copy.test.ts`: all of them or none) — and says
   * the wait in words in the browser, from the same `Retry-After` seconds
   * (`@/lib/workers/read-error`), for every 429 rather than this one. The two
   * checks below keep what this lane pinned: never ONE tool's work, and never a
   * header, with the wait stated in words where the reader receives it.
   */
  it("names every AI tool's work or none — never one", async () => {
    // Derived from the catalog: the verb of every AI tool, as a stem, so
    // "translated", "summarised" and "extracting" are all caught.
    const { tools } = await import("./index");
    const { capabilityForMode } = await import("@/lib/jobs/capabilities");
    const aiTools = tools.filter(
      (tool) => capabilityForMode(tool.processing) === "ai",
    );
    expect(aiTools.length).toBeGreaterThanOrEqual(4);
    const STEMS: Record<string, RegExp> = {
      "translate-pdf": /translat/i,
      "summarize-pdf": /summar/i,
      "ai-extract": /extract/i,
      "chat-with-pdf": /\bchat/i,
    };
    // Every AI tool has a stem, so a fifth tool fails here until it is added.
    expect(Object.keys(STEMS).sort()).toEqual(
      aiTools.map((tool) => tool.slug).sort(),
    );
    const named = (sentence: string) =>
      Object.entries(STEMS)
        .filter(([, stem]) => stem.test(sentence))
        .map(([slug]) => slug);
    const served = named(AI_ALLOWANCE_USED_MESSAGE);
    expect(
      served.length === 0 || served.length === Object.keys(STEMS).length,
      `the refusal names only ${served.join(", ")}'s work`,
    ).toBe(true);
    // Positive control: the sentence that shipped names exactly one.
    expect(
      named(
        "On a shared network that can include text translated by someone else.",
      ),
    ).toEqual(["translate-pdf"]);
  });

  it("states the wait in words where it is read, and never names a header", async () => {
    const { readWorkerError, describeWait } =
      await import("@/lib/workers/read-error");
    expect(AI_ALLOWANCE_USED_MESSAGE).not.toMatch(/header|retry-after/i);
    for (const seconds of [1, 59, 60, 61, 3599, 3600, 3601, 86_400]) {
      // The refusal as the browser client reads it off the wire: the served
      // body, and the `Retry-After` the same decision filled.
      const read = await readWorkerError(
        {
          status: 429,
          json: async () => ({
            error: {
              code: "rate_limited",
              message: AI_ALLOWANCE_USED_MESSAGE,
            },
          }),
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "retry-after" ? String(seconds) : null,
          },
        },
        "fallback",
      );
      expect(read.message.startsWith(AI_ALLOWANCE_USED_MESSAGE)).toBe(true);
      expect(read.message).toBe(
        `${AI_ALLOWANCE_USED_MESSAGE} Try again in ${describeWait(seconds)}.`,
      );
      expect(read.message).not.toMatch(/header|retry-after/i);
    }
    // Rounded UP: a reader told a time at which the refusal still stands comes
    // back early and is refused again.
    expect(describeWait(30)).toBe("about 30 seconds");
    expect(describeWait(60)).toBe("about 1 minute");
    expect(describeWait(3 * 3600 + 1)).toBe("about 3 h 1 min");
    expect(describeWait(86_400)).toBe("about 24 hours");
  });
});
