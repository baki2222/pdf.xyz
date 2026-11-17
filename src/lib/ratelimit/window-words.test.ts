// @vitest-environment node
/**
 * THE PROPERTY: no sentence a reader gets about a rate limit names a calendar
 * reset, because no limit here has one.
 *
 * Every policy in `RATE_LIMIT_POLICIES` is a FIXED window of `windowSeconds`
 * stamped at the bucket's first charge (`./redis.ts`, `PEXPIRE` only while
 * `PTTL < 0`, so a later charge never moves it; `redis-window.test.ts` holds
 * the semantics). Observed 2026-11-17 on a real job: the `ai.characters` key
 * was created with a PTTL of about 86,367 s. Someone charged at 22:00 is
 * still refused the next morning, so "used up for today", "is left today",
 * "try again tomorrow" and "until the next day" each promise a reset that
 * does not come.
 *
 * KEPT, AND WHY (each a negative control below): "daily allowance", "resets
 * daily", "a day", "per day", "an hour", "the hourly limit". They name the
 * window's LENGTH, which is true, and no clock time.
 *
 * "IN A SINGLE DAY" WAS KEPT HERE, AND IT WAS FALSE (review, 2026-11-17).
 * Translate said a document over the whole allowance "cannot be translated
 * in a single day", and this list licensed it as a length. A window starts
 * at its first charge, so two can sit back to back: part A charged just
 * before one expires and part B just after are translated minutes apart.
 * "the day's allowance" reads as a calendar day in the same way. Both are
 * now banned, with what shipped as their corpus.
 *
 * THE BAN LIST HAS A CORPUS IN BOTH DIRECTIONS (CLAUDE.md rule 1): every
 * calendar-day sentence this product shipped, verbatim from git with the
 * interpolations as they rendered, is caught by some pattern, and every
 * pattern catches some shipped sentence. "midnight", "resets at", "each day
 * at" and "for the day" were never shipped, so they are not patterns: a
 * pattern nothing exercises is decoration.
 *
 * THE SURFACE IS DERIVED, never typed: (1) every non-test source file under
 * src/app, src/components and src/lib, comments stripped and phrases
 * flattened, which must contain the copy walk (`copyFiles()`) and every
 * refusal builder a route imports; (2) every sentence evaluated at runtime,
 * because a phrase broken by interpolation survives a source scan: the 429
 * for every policy (`rateLimitErrorResult`), both allowance scopes, every
 * tool's catalogue entry, facts, intro, steps and FAQ (the FAQPage JSON-LD is
 * these), every guide, the site FAQ, /privacy's limit disclosure, the batch
 * copy and Translate's delivery notices, in both arms of the undeclared
 * flag. Each set has a size health check.
 *
 * CORPUS MODULES are skipped by the source scan (merge with main after #351,
 * which added `translate-page-choice-claims.ts`, holding shipped history
 * verbatim): non-test files under src/lib that a test imports and nothing
 * else under src, scripts or e2e does, DERIVED from the import graph. Every
 * calendar-shaped string one exports must be a SHIPPED sentence, so the
 * exclusion hides only history.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  flattenForPhraseSearch,
  withoutComments,
} from "@/lib/tools/copy-surface";
import { allPolicies, policyFor } from "./policy";
import { RATE_LIMITED_MESSAGE, rateLimitErrorResult } from "./response";
import type { RateLimitDecision } from "./types";
import {
  AI_ALLOWANCE_REFUSED_WHOLE,
  AI_ALLOWANCE_USED_MESSAGE,
  aiAllowanceCopy,
} from "@/lib/jobs/ai-allowance";
import {
  AI_CEILING_PAUSE,
  AI_CEILING_REACHED_MESSAGE,
} from "@/lib/jobs/ai-spend-ceiling";
import {
  NOTHING_UNDERCOUNT_SENTENCE,
  WITHHELD_UNDERCOUNT_SENTENCE,
} from "@/lib/jobs/translate-withheld-copy";
import { RATE_LIMIT_DISCLOSURE } from "@/lib/privacy/rate-limits";
import {
  WORKER_BATCH_PAUSED,
  workerBatchEachFileSentence,
  workerBatchJobsSentence,
} from "@/lib/batch/worker-copy";
import { tools } from "@/lib/tools";
import { toolFacts } from "@/lib/tools/tool-facts";
import {
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "@/lib/tools/page-copy";
import { guides } from "@/lib/guides";
import { faqs } from "@/lib/faq";
import {
  nothingDeliverableMessage,
  withheldPagesMarker,
} from "@/lib/workers/translate/chunking";
import { deliveryConsequence } from "@/components/tools/delivery-notice";

const ROOT = process.cwd();
/** U+2014, built from its code point (house rule for non-ASCII in tests). */
const DASH = String.fromCharCode(0x2014);
/** U+2019, the typographic apostrophe, so "for today's date" is not a reset. */
const RSQUO = String.fromCharCode(0x2019);
const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, "/");

/* ------------------------------------------------------------------ *
 *  The ban list and its corpus.
 * ------------------------------------------------------------------ */

/** Calendar-reset shapes. Each must catch a SHIPPED sentence below. */
const CALENDAR_SHAPES: readonly { name: string; pattern: RegExp }[] = [
  // Not "for today's date" (Header & Footer's {date}), which is a date.
  {
    name: "for today",
    pattern: new RegExp(`\\bfor today\\b(?![${RSQUO}'\\w])`, "i"),
  },
  { name: "left today", pattern: /\bleft today\b/i },
  { name: "tomorrow", pattern: /\btomorrow\b/i },
  { name: "the next day", pattern: /\b(?:until|by|on) the next day\b/i },
  { name: "in a single day", pattern: /\bin a single day\b/i },
  {
    name: "the day's allowance",
    pattern: new RegExp(`\\bthe (?:whole )?day[${RSQUO}']s allowance\\b`, "i"),
  },
];

const shapesIn = (text: string) =>
  CALENDAR_SHAPES.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );

/**
 * Every calendar-day sentence shipped, with the commit that shipped it and
 * its interpolations as they rendered. Found by `git log -S` for each shape
 * over non-test sources (2026-11-17).
 */
const SHIPPED: readonly { commit: string; text: string }[] = [
  {
    commit: "d8e818a2",
    text: `You've used your 3 free AI runs for today. The allowance resets daily ${DASH} retry after the interval in the Retry-After header.`,
  },
  {
    commit: "6d6563fa",
    text: `The 3 free AI runs for today are used up. This allowance is currently shared across everyone using pdf.xyz, so it may not reflect your own usage ${DASH} it resets daily; retry after the interval in the Retry-After header.`,
  },
  {
    commit: "6d6563fa",
    text: "You have used your 3 free AI runs a day for today. The allowance resets daily; retry after the interval in the Retry-After header.",
  },
  {
    commit: "90a8104e",
    text: "The 30,774 free characters of AI text for this connection are used up for today. On a shared network that can include runs made by someone else.",
  },
  {
    commit: "885f2e13",
    text: "The free AI allowance for this connection is used up for today. It covers 30,774 free characters of AI text a day to translate, or 3 summaries or extractions, shared across the AI tools.",
  },
  {
    commit: "4a316d24",
    text: "The free AI allowance is used up for today, or too little of it is left for this document.",
  },
  {
    commit: "bcce4736",
    text: `AI features are temporarily unavailable ${DASH} the service has reached its daily processing limit. This is a limit on our side, not on your file or your account. Please try again tomorrow; every other PDF tool is unaffected.`,
  },
  {
    commit: "4a316d24",
    text: `AI features are temporarily unavailable ${DASH} the service has reached its daily processing limit. This is a limit on our side ${DASH} not a problem with your file, and not the free daily AI allowance. Please try again tomorrow; every other PDF tool is unaffected.`,
  },
  {
    commit: "0d655c18",
    text: "The allowance is charged when the job is created, just after the upload: a document needing more than is left today is refused whole with nothing charged rather than half translated.",
  },
  {
    commit: "57f5cee0",
    text: "The text sent for translation is charged against the free daily allowance when the job is created, so a document needing more than is left today is refused before it runs, with nothing charged, rather than half translated.",
  },
  {
    commit: "4a316d24",
    text: "And when pdf.xyz's own daily spending cap for AI is reached, every AI tool pauses until the next day, however much of the free allowance is left.",
  },
  {
    commit: "4a316d24",
    text: "Apart from that, a service-wide daily limit on AI processing can pause every AI tool until the next day.",
  },
  {
    commit: "4a316d24",
    text: "Separately, pdf.xyz's own daily AI processing limit can pause summaries for everyone until the next day.",
  },
  {
    commit: "a04fd656",
    text: "one over 30,774 characters, the whole day's allowance, cannot be translated in a single day.",
  },
  // The whole sentences, as served at 76af2dee (Translate slice 7, #351):
  // the intro and the "How much of my PDF" fact, each followed there by the
  // page-choice remedy. Kept by the merge, reworded by this branch.
  {
    commit: "76af2dee",
    text: "The allowance is charged when the job is created, just after the upload: a document needing more than is left today is refused whole with nothing charged rather than half translated, and one over 30,774 characters, the whole day's allowance, cannot be translated in a single day.",
  },
  {
    commit: "76af2dee",
    text: "The text sent for translation is charged against the free daily allowance when the job is created, so a document needing more than is left today is refused before it runs, with nothing charged, rather than half translated; one over 30,774 characters, the whole day's allowance, cannot be translated in a single day.",
  },
  // The split-first versions those replaced (a04fd656 removed them), whole;
  // they stand in `translate-page-choice-claims.ts` as history too.
  {
    commit: "0d655c18",
    text: "The allowance is charged when the job is created, just after the upload: a document needing more than is left today is refused whole with nothing charged rather than half translated, and one over 30,774 characters, the whole day's allowance, has to be split into smaller files first.",
  },
  {
    commit: "57f5cee0",
    text: "The whole document is charged against the free daily allowance when the job is created, so a document needing more than is left today is refused before it runs, with nothing charged, rather than half translated; one over 30,774 characters, the whole day's allowance, has to be split into smaller files.",
  },
  {
    commit: "8b24c50c",
    text: "The page checks the file for text before sending it, and when it finds none the question stops there and takes nothing from the day's allowance.",
  },
];

/** Kept phrases: each names a length, not a clock time. Must match nothing. */
const KEPT = [
  `30,774 free characters of AI text a day, shared by everyone using pdf.xyz ${DASH} the allowance resets daily.`,
  "This job reserved enough of the daily allowance for 1,200 characters of text, and the document holds more.",
  "However long the document, at least 3 summaries fit in a day if nothing else draws on it.",
  "How many PDFs can I summarize per day?",
  "Each file counts as one of the 60 server jobs an hour that every visitor shares.",
  "Paused: the hourly limit was reached.",
  // Its replacement, which says what is true at any time (review, 2026-11-17).
  "and one needing more than 30,774 characters, the whole daily allowance, is refused even when none of it has been used.",
  // "today" as "currently" and as a date, which the patterns must not read
  // as a reset.
  "Today every visitor's requests are counted together, in shared counters that hold no identifier.",
  "{date} for today's date, written the way your device writes dates.",
  `{date} for today${RSQUO}s date, with a typographic apostrophe.`,
  `Every one of the 60 tools is free to use today ${DASH} no card and no trial clock.`,
] as const;

/* ------------------------------------------------------------------ *
 *  The surfaces, derived.
 * ------------------------------------------------------------------ */

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
  for (const root of ["app", "components", "lib"])
    walk(path.join(ROOT, "src", root));
  return out;
}

const resolveFile = (base: string): string | null => {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    try {
      if (!/\.tsx?$/.test(candidate)) continue;
      readFileSync(candidate);
      return path.resolve(candidate);
    } catch {
      // next candidate
    }
  }
  return null;
};

/** Every module `file` names in an import, re-export or dynamic import. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)"([^"]+)"/gm,
  )) {
    const spec = m[1]!;
    const base = spec.startsWith("@/")
      ? path.join(ROOT, "src", spec.slice(2))
      : spec.startsWith(".")
        ? path.join(path.dirname(file), spec)
        : null;
    const resolved = base ? resolveFile(base) : null;
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * CORPUS MODULES: non-test files under src/lib that some test imports and no
 * non-test file under src imports (`translate-page-choice-claims.ts` and its
 * kind). They hold shipped history verbatim for a guard to read, so they
 * carry the very words banned here, and a reader cannot reach them. DERIVED
 * from the import graph, never typed; what they hold is checked separately
 * below (every calendar-shaped string in one is a SHIPPED sentence), so the
 * exclusion cannot hide a reader-facing one.
 */
function corpusModules(files: readonly string[]): string[] {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:tsx?|mjs|js)$/.test(entry.name)) all.push(full);
    }
  };
  // Importers: src, scripts (the worker's entry points and the probes'
  // runners live there) and e2e, never only src (house rule 4).
  for (const root of ["src", "scripts", "e2e"]) walk(path.join(ROOT, root));
  const byProduct = new Set<string>();
  const byTest = new Set<string>();
  for (const file of all) {
    const isTest =
      /\.(?:test|spec)\./.test(file) || rel(file).startsWith("e2e/");
    const into = isTest ? byTest : byProduct;
    for (const target of importsOf(file)) into.add(target);
  }
  return files.filter((f) => {
    const abs = path.resolve(f);
    return (
      rel(abs).startsWith("src/lib/") && byTest.has(abs) && !byProduct.has(abs)
    );
  });
}

const resolveAlias = (spec: string): string | null => {
  if (!spec.startsWith("@/")) return null;
  const base = path.join(ROOT, "src", spec.slice(2));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
};

/**
 * Follow a barrel: when `file` only re-exports `name` (`export { name } from
 * "./x"`), the words live in `./x`. Followed to a fixed point.
 */
function throughReExports(file: string, name: string): string {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/export\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    const names = m[1]!.split(",").map((n) =>
      n
        .trim()
        .split(/\s+as\s+/)
        .pop(),
    );
    if (!names.includes(name)) continue;
    const spec = m[2]!;
    const target = spec.startsWith(".")
      ? resolveAlias(
          "@/" +
            path
              .relative(
                path.join(ROOT, "src"),
                path.join(path.dirname(file), spec),
              )
              .replace(/\\/g, "/"),
        )
      : resolveAlias(spec);
    if (target && target !== file) return throughReExports(target, name);
  }
  // `export * from "./x"`: the star target that DEFINES `name`.
  const defines = new RegExp(`export\\s+(?:const|function)\\s+${name}\\b`);
  if (!defines.test(source)) {
    for (const m of source.matchAll(/export\s*\*\s*from\s*"(\.[^"]+)"/g)) {
      const target = resolveAlias(
        "@/" +
          path
            .relative(
              path.join(ROOT, "src"),
              path.join(path.dirname(file), m[1]!),
            )
            .replace(/\\/g, "/"),
      );
      if (target && defines.test(readFileSync(target, "utf8")))
        return throughReExports(target, name);
    }
  }
  return file;
}

/**
 * The modules that hold a refusal's words: every identifier a route (or the
 * API's shared `_lib`) hands to `apiError` as its message, and every
 * `...ErrorResult` builder it calls, resolved through that file's own imports.
 */
function refusalBuilders(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ts$/.test(entry.name) && !entry.name.includes(".test."))
        files.push(full);
    }
  };
  walk(path.join(ROOT, "src", "app", "api"));
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const imported = new Map<string, string>();
    for (const m of source.matchAll(
      /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*"([^"]+)"/g,
    )) {
      for (const name of m[1]!.split(",")) {
        const local = name
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .trim();
        if (local) imported.set(local, m[2]!);
      }
    }
    const used = [
      ...[
        ...source.matchAll(/apiError\(\s*"[a-z_]+"\s*,\s*([A-Za-z_]\w*)/g),
      ].map((m) => m[1]!),
      ...[...source.matchAll(/\b(\w+ErrorResult)\(/g)].map((m) => m[1]!),
    ];
    for (const name of used) {
      const spec = imported.get(name);
      const resolved = spec ? resolveAlias(spec) : null;
      if (resolved) found.add(throughReExports(resolved, name));
    }
  }
  return [...found];
}

/** Every string reachable inside `value` (objects, arrays, functions skipped). */
function stringsIn(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value))
    for (const item of value) stringsIn(item, out, depth + 1);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) stringsIn(item, out, depth + 1);
  return out;
}

const denied = (action: RateLimitDecision["action"]): RateLimitDecision => ({
  allowed: false,
  action,
  policyId: action,
  provider: "local-memory",
  enforced: true,
  retryAfterSeconds: 60,
  retryAfterBucket: "1-5m",
});

/** Every sentence evaluated at runtime, labelled by where a reader meets it. */
function evaluatedSentences(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const add = (where: string, value: unknown) => {
    for (const text of stringsIn(value)) out.push({ where, text });
  };
  for (const policy of allPolicies()) {
    const result = rateLimitErrorResult(denied(policy.action));
    add(`429 for ${policy.id}`, result.body.error.message);
  }
  add("ceiling 503", AI_CEILING_REACHED_MESSAGE);
  for (const scope of ["connection", "everyone"] as const) {
    const copy = aiAllowanceCopy(scope);
    add(`allowance (${scope})`, {
      fact: copy.fact,
      perCallFact: copy.perCallFact,
      usedMessage: copy.usedMessage,
      whoShares: copy.whoShares,
    });
    for (const tool of tools)
      add(`allowance (${scope}) ${tool.slug}`, copy.factFor(tool.slug));
  }
  for (const tool of tools) {
    add(`catalogue ${tool.slug}`, tool);
    add(`facts ${tool.slug}`, toolFacts(tool.slug));
    add(`intro ${tool.slug}`, pageIntro(tool));
    add(`use cases ${tool.slug}`, pageUseCases(tool));
    add(`steps ${tool.slug}`, pageSteps(tool).map(stepText));
    add(`faq ${tool.slug}`, pageFaq(tool));
  }
  for (const guide of guides) add(`guide ${guide.slug}`, guide);
  add("site faq", faqs);
  add("privacy", RATE_LIMIT_DISCLOSURE);
  add("batch", [
    WORKER_BATCH_PAUSED,
    workerBatchEachFileSentence(),
    workerBatchJobsSentence(3),
  ]);
  // Both arms of the undeclared flag (declared: the panel; undeclared: an
  // API caller or an OCR scan), which pick different words.
  for (const undeclared of [false, true])
    for (const bound of ["characters", "pages"] as const) {
      const arm = undeclared ? "undeclared" : "declared";
      const limit = {
        characters: 9,
        pages: 2,
        ...(undeclared ? { undeclared: true as const } : {}),
      };
      add(
        `delivery notice ${arm} ${bound}`,
        deliveryConsequence({
          deliveredPages: 2,
          withheldPages: 1,
          boundBy: bound,
          // The result's flag is positive (review, 2026-11-17).
          ...(undeclared ? {} : { counted: true as const }),
        }),
      );
      for (const chosen of [null, [[2, 3]] as [number, number][]]) {
        add(
          `package marker ${arm} ${bound}`,
          withheldPagesMarker([3], bound, limit, chosen),
        );
        add(
          `nothing deliverable ${arm} ${bound}`,
          nothingDeliverableMessage(bound, limit, chosen !== null),
        );
      }
    }
  return out;
}

/* ------------------------------------------------------------------ *
 *  The tests.
 * ------------------------------------------------------------------ */

describe("the bucket-to-window table, derived from the policies", () => {
  it("every policy has a window, and the AI buckets are a day", () => {
    const table = Object.fromEntries(
      allPolicies().map((p) => [p.id, p.windowSeconds]),
    );
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(11);
    for (const seconds of Object.values(table))
      expect(seconds).toBeGreaterThan(0);
    expect(table["ai.characters"]).toBe(86_400);
    expect(table["ai.spend"]).toBe(86_400);
  });

  it("the length phrases agree with the window they describe (a second bound)", () => {
    // "resets daily" is said of ai.characters; "for up to a day" of ai.spend.
    // Change either window and these must be rewritten with it.
    expect(policyFor("ai.characters").windowSeconds).toBe(86_400);
    expect(AI_ALLOWANCE_USED_MESSAGE).toContain("The allowance resets daily.");
    expect(policyFor("ai.spend").windowSeconds).toBe(86_400);
    expect(AI_CEILING_PAUSE).toBe("for up to a day");
  });
});

describe("the ban list has a corpus in both directions", () => {
  it("every shipped calendar-day sentence is caught by some pattern", () => {
    const holes = SHIPPED.filter(({ text }) => shapesIn(text).length === 0);
    expect(holes).toEqual([]);
  });

  it("every pattern catches some shipped sentence", () => {
    const decorative = CALENDAR_SHAPES.filter(
      ({ pattern }) => !SHIPPED.some(({ text }) => pattern.test(text)),
    ).map(({ name }) => name);
    expect(decorative).toEqual([]);
  });

  it("health: the corpus is the size it was built at", () => {
    // 15 at this branch's last commit; 19 after the merge with main after
    // #351 (two slice-7 sentences, two split-first sentences they replaced).
    expect(SHIPPED.length).toBe(19);
    expect(CALENDAR_SHAPES.length).toBe(6);
  });

  it("positive control: a planted deferral is caught", () => {
    // The advertisement capability-hedges.test.ts plans for Translate page
    // ranges, which this guard must stop before it ships.
    expect(
      shapesIn(
        "Enter a page range and translate the rest tomorrow, with no splitting.",
      ),
    ).toEqual(["tomorrow"]);
  });

  it("negative controls: the kept length phrases match nothing", () => {
    expect(KEPT.flatMap((text) => shapesIn(text))).toEqual([]);
  });

  it("negative controls: the new sentences match nothing", () => {
    for (const text of [
      AI_ALLOWANCE_USED_MESSAGE,
      AI_CEILING_REACHED_MESSAGE,
      AI_ALLOWANCE_REFUSED_WHOLE,
      AI_CEILING_PAUSE,
      WITHHELD_UNDERCOUNT_SENTENCE,
      NOTHING_UNDERCOUNT_SENTENCE,
      RATE_LIMITED_MESSAGE,
    ])
      expect(shapesIn(text), text).toEqual([]);
  });
});

describe("no reader-facing sentence names a calendar reset", () => {
  const files = sourceFiles();
  const corpora = new Set(corpusModules(files).map(rel));

  it("health: the corpus modules are derived, few, and hold only shipped history", async () => {
    // Positive member: the module that made this exclusion necessary (main's
    // Translate slice 7, #351). Bounded above, so a graph that stops
    // resolving product imports, and so excludes nearly everything, fails
    // here; bounded below, so one that stops resolving test imports does.
    expect([...corpora]).toContain(
      "src/lib/tools/translate-page-choice-claims.ts",
    );
    // 18 on 2026-11-17 (test-only fixtures, probes and claim corpora).
    expect(corpora.size).toBeGreaterThanOrEqual(5);
    expect(corpora.size).toBeLessThan(40);
    // Negative members: modules the product imports are never excluded.
    for (const product of [
      "src/lib/tools/translate-page-choice.ts",
      "src/lib/jobs/ai-allowance.ts",
      "src/lib/tools/tool-facts.ts",
    ])
      expect(corpora.has(product), product).toBe(false);
    // What they hold: every calendar-shaped string they export is a SHIPPED
    // sentence (or contains one), so the exclusion hides history only.
    const shipped = SHIPPED.map((s) => s.text);
    const unlisted: string[] = [];
    let strings = 0;
    for (const file of corpora) {
      const mod: unknown = await import(
        /* @vite-ignore */ path.join(ROOT, file)
      );
      for (const text of stringsIn(mod)) {
        strings += 1;
        if (
          shapesIn(text).length > 0 &&
          !shipped.some((s) => text === s || text.includes(s))
        )
          unlisted.push(`${file}: ${text.slice(0, 160)}`);
      }
    }
    expect(strings).toBeGreaterThan(10);
    expect(unlisted).toEqual([]);
  });

  it("health: the source walk contains the copy walk and every refusal builder", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files.length).toBeLessThan(5000);
    const walked = new Set(files.map(rel));
    const copy = copyFiles().map(rel);
    expect(copy.length).toBeGreaterThan(300);
    expect(copy.filter((f) => !walked.has(f))).toEqual([]);
    const builders = refusalBuilders().map(rel);
    // Seven on 2026-11-17; a resolver that stops following imports or barrels
    // collapses this, and the positive members below say which way.
    expect(builders.length).toBeGreaterThanOrEqual(5);
    expect(builders.length).toBeLessThan(40);
    expect(builders).toEqual(
      expect.arrayContaining([
        "src/lib/jobs/ai-spend-ceiling.ts",
        "src/lib/ratelimit/response.ts",
      ]),
    );
    expect(builders.filter((f) => !walked.has(f))).toEqual([]);
  });

  it("in any source file, outside comments", () => {
    const found: string[] = [];
    for (const file of files) {
      if (corpora.has(rel(file))) continue;
      const text = flattenForPhraseSearch(
        withoutComments(readFileSync(file, "utf8")),
      );
      for (const { name, pattern } of CALENDAR_SHAPES) {
        const global = new RegExp(pattern.source, "gi");
        for (const m of text.matchAll(global))
          found.push(
            `${rel(file)} [${name}]: ...${text.slice(Math.max(0, m.index - 60), m.index + 40)}...`,
          );
      }
    }
    expect(found).toEqual([]);
  });

  it("in any sentence evaluated at runtime", () => {
    const sentences = evaluatedSentences();
    // 6,625 on 2026-11-17: bounded both ways, so a walk that collapses or
    // balloons fails here rather than passing vacuously.
    expect(sentences.length).toBeGreaterThan(3000);
    expect(sentences.length).toBeLessThan(30000);
    // The refusal the guard exists for is a member, for every scope.
    expect(sentences.map((s) => s.text)).toContain(AI_ALLOWANCE_USED_MESSAGE);
    expect(sentences.filter((s) => s.where.startsWith("429 for ")).length).toBe(
      allPolicies().length,
    );
    // Both arms of the undeclared flag are members: each writes its own
    // words for a characters-bound withhold.
    const panel = (arm: string) =>
      sentences.find((s) => s.where === `delivery notice ${arm} characters`)
        ?.text ?? "";
    expect(panel("declared")).toContain(WITHHELD_UNDERCOUNT_SENTENCE);
    expect(panel("undeclared")).toMatch(/as a separate document\.$/);
    const found = sentences
      .filter(({ text }) => shapesIn(text).length > 0)
      .map(({ where, text }) => `${where}: ${text.slice(0, 160)}`);
    expect(found).toEqual([]);
  });
});
