// @vitest-environment node
/**
 * The numbers-drift census: user-facing copy may not hand-write a figure the
 * code owns.
 *
 * The programme's most-repeated defect is copy claiming what code does not do.
 * Capabilities, prices, and focus-order have guards; NUMBERS drifted free: the
 * deleted pricing tier hard-coded "Files up to 100 MB each"
 * (JOB_LIMITS.maxFileBytes), the FAQ said "deleted within minutes" while the
 * panels derive "output N min" from DEFAULT_RETENTION, and
 * `use-workspace.ts` carries a comment admitting its 100 MB is "manually kept
 * in sync". When a constant changes, derived surfaces update and literal ones
 * lie — in the direction that always embarrasses this product.
 *
 * Two rules over every unit-bearing numeric literal in the user-facing copy:
 *
 *  1. **A literal equal to a constant's current value must derive instead.**
 *     `${formatBytes(JOB_LIMITS.maxFileBytes)}` never trips this — the number
 *     does not appear in source. A hand-written "100 MB" does, and it is a lie
 *     waiting for the next config change.
 *  2. **A unit-bearing literal matching NO constant is an unowned claim** —
 *     copy asserting a figure the code does not define, which nothing can keep
 *     true. Either derive it from a new constant or stop claiming it.
 *
 * v1 scope (the cry-wolf doctrine — narrow and true beats broad and weakened):
 * data sizes (MB/GB), durations (minutes/hours), and object counts
 * (files/tools/languages). CSS lengths, DPI, page geometry, percentages, and
 * key sizes are deliberately out of scope. `BASELINE` records what the census
 * found on first contact (2026-08-09) that is REPORTED and awaiting an owner
 * scoping decision — remove entries as they are fixed; never add to ship a new
 * literal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, JOB_LIMITS, RATE_LIMITS } from "@/lib/jobs/types";
import { MAX_OCR_LANGUAGES, OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { toolCount } from "@/lib/tools";
import { DEFAULT_JOB_TTL_SECONDS } from "@/lib/workers/queue/redis-config";
import { CLEANUP_EVIDENCE_AGE_DAYS } from "@/lib/workers/cleanup-evidence/types";
import {
  RETENTION_WINDOW_MINUTES,
  RETENTION_WINDOWS,
} from "@/lib/retention-windows";
import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES } from "./limits";
import { processingSplit } from "./processing-split";
import { copyFiles as sharedCopyFiles } from "./copy-surface";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 *  What the code owns (rendered the way copy would write it)
 * ------------------------------------------------------------------ */

const MB = 1024 * 1024;

/** value+unit pairs the code owns, in every spelling copy plausibly uses. */
const OWNED: { value: number; units: readonly string[]; source: string }[] = [
  {
    value: JOB_LIMITS.maxFileBytes / MB,
    units: ["mb"],
    source: "JOB_LIMITS.maxFileBytes",
  },
  {
    value: JOB_LIMITS.maxTotalBytes / MB,
    units: ["mb"],
    source: "JOB_LIMITS.maxTotalBytes",
  },
  {
    value: JOB_LIMITS.maxInputFiles,
    units: ["files", "file"],
    source: "JOB_LIMITS.maxInputFiles",
  },
  {
    value: DEFAULT_RETENTION.inputTtlMinutes,
    units: ["minutes", "minute", "min"],
    source: "DEFAULT_RETENTION.inputTtlMinutes",
  },
  {
    value: DEFAULT_RETENTION.outputTtlMinutes,
    units: ["minutes", "minute", "min"],
    source: "DEFAULT_RETENTION.outputTtlMinutes",
  },
  {
    value: toolCount,
    units: ["tools", "tool"],
    source: "toolCount",
  },
  {
    // The job record's lifetime — and so the filename's — which the privacy
    // page states. Owned by the queue's default key TTL since 2026-09-27.
    value: DEFAULT_JOB_TTL_SECONDS / 3600,
    units: ["hours", "hour"],
    source: "DEFAULT_JOB_TTL_SECONDS (queue key TTL, via RETENTION_WINDOWS)",
  },
  // The two answers to "how many tools run in my browser". Registered here on
  // 2026-08-22 so a hand-written one is reported with its OWNER rather than as
  // an anonymous unowned figure: three surfaces stated these counts and two of
  // them stated a different one, and the census could only ever have said "no
  // constant owns 29 tools" — true, unhelpful, and silent about which of the
  // two numbers the writer meant. Both are `tools`-unit figures, so a literal
  // was already a finding; what changes is that the message now names the
  // group and therefore the proposition.
  {
    value: processingSplit().neverUploads.length,
    units: ["tools", "tool"],
    source: "processingSplit().neverUploads (tools that never upload)",
  },
  {
    value: processingSplit().mayUpload.length,
    units: ["tools", "tool"],
    source: "processingSplit().mayUpload (tools that may upload)",
  },
  {
    // The edge between the cleanup-evidence age buckets the operations page
    // labels ("1–7 days", "Over 7 days"). Registered at the merge of
    // wave1/l06-copy-other, when the shared copy walk grew to reach
    // src/components/status and met labels this census could now read.
    value: CLEANUP_EVIDENCE_AGE_DAYS,
    units: ["days", "day"],
    source: "CLEANUP_EVIDENCE_AGE_DAYS (cleanup-evidence age buckets)",
  },
  {
    value: OCR_LANGUAGES.length,
    units: ["languages", "language"],
    source: "OCR_LANGUAGES.length",
  },
  {
    value: MAX_OCR_LANGUAGES,
    units: ["languages", "language"],
    source: "MAX_OCR_LANGUAGES",
  },
  {
    value: RATE_LIMITS.aiRunsPerDayPerClient,
    units: ["runs", "run"],
    source: "RATE_LIMITS.aiRunsPerDayPerClient",
  },
  {
    value: MAX_IMAGE_BYTES / MB,
    units: ["mb"],
    source: "MAX_IMAGE_BYTES (tools/limits, image → PDF per-image cap)",
  },
  {
    value: MAX_SOURCE_BYTES / MB,
    units: ["mb"],
    source: "MAX_SOURCE_BYTES (tools/limits, text/markdown source cap)",
  },
  // Every retention clock the policy pages state, registered by ITERATING the
  // derivation rather than by retyping its keys: a clock added there is owned
  // here the same day. They overlap on purpose — 1 day is the job record's TTL
  // AND the lifecycle rule's age — and a finding names every owner it equals,
  // because picking one would tell the writer which clock they meant.
  ...Object.entries(RETENTION_WINDOW_MINUTES).map(([clock, minutes]) => ({
    value: minutes,
    units: ["minutes", "minute", "min"] as const,
    source: `RETENTION_WINDOW_MINUTES.${clock}`,
  })),
];

const UNIT_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(MB|GB|minutes?|hours?|days?|weeks?|files?|tools?|languages?|runs?\b|min\b)/gi;

/**
 * A duration spelled in WORDS, which the digit pattern cannot see.
 *
 * Added 2026-09-27. The census matched digits only, so "lasts about a day"
 * (homepage security section) and "is kept for about a day" (FAQ) stated the
 * job record's lifetime — the queue's `DEFAULT_JOB_TTL_SECONDS` — with no
 * number for it to read. Every surface carrying the fact in digits was
 * derived; the two carrying it in words were free to drift.
 *
 * ANCHORED, because "a day" is also how this product states a RATE: "3 free
 * AI runs a day", "the amount translated in a day". A bare
 * `(an?|one) (minute|hour|day)` would flag those as the job TTL — a wrong
 * owner is worse than none. The anchor is the word that makes it a LENGTH OF
 * TIME: a hedge (about, around, roughly, ~), a bound (within, after, up to),
 * or a span (for, lasts). The corpus test below proves both directions.
 */
const WORD_DURATION_PATTERN =
  /(?:\b(?:about|around|roughly|approximately|nearly|almost|within|after|for|lasts?|up to)\s+|~\s*)(?:(?:about|around|roughly)\s+)?(an?|one)\s+(minute|hour|day|week)\b/gi;

/** Minutes per duration unit, so "a day", "24 hours" and "1440 minutes" meet. */
const MINUTES_PER: Record<string, number> = {
  min: 1,
  minute: 1,
  hour: 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
};

interface UnitLiteral {
  literal: string;
  value: number;
  /** Singular, lower-case: "mb", "minute", "day", "tool"… */
  unit: string;
}

/** Every unit-bearing figure in `source`, digit-spelled or word-spelled. */
function unitLiterals(source: string): UnitLiteral[] {
  const out: UnitLiteral[] = [];
  for (const [literal, num, unitRaw] of source.matchAll(UNIT_PATTERN)) {
    if (!literal || !num || !unitRaw) continue;
    out.push({
      literal,
      value: Number(num),
      unit: unitRaw.toLowerCase().replace(/s$/, ""),
    });
  }
  for (const [literal, , unitRaw] of source.matchAll(WORD_DURATION_PATTERN)) {
    if (!literal || !unitRaw) continue;
    out.push({ literal, value: 1, unit: unitRaw.toLowerCase() });
  }
  return out;
}

/** Every owner whose figure equals this literal's, durations compared in minutes. */
function ownersOf({ value, unit }: UnitLiteral): string[] {
  const inMinutes = (n: number, u: string) =>
    u.replace(/s$/, "") in MINUTES_PER
      ? n * MINUTES_PER[u.replace(/s$/, "")]!
      : undefined;
  const mine = inMinutes(value, unit);
  const sources = OWNED.filter((o) =>
    mine !== undefined
      ? o.units.some((u) => inMinutes(o.value, u) === mine)
      : o.value === value && o.units.some((u) => u.replace(/s$/, "") === unit),
  ).map((o) => o.source);
  return [...new Set(sources)];
}

/* ------------------------------------------------------------------ *
 *  The copy surface (same walk as pricing-honesty + the workspace UI)
 * ------------------------------------------------------------------ */

/**
 * The shared copy walk, IMPORTED since 2026-09-27. This census kept its own
 * copy of the root list (sections, tools, app, lib/tools, lib/guides + two
 * listed files), and when the shared walk was found to skip the site footer,
 * the upload zone and the social card, this copy was blind to the same files
 * — plus `site.ts`, which the shared walk had carried all along. Two lists of
 * one surface is how the census and the other guards came to read different
 * pages; importing the walk is the mechanical version of "the same surface".
 */
function copyFiles(): string[] {
  return sharedCopyFiles();
}

/** Source with comments removed — a docblock citing a figure is not a claim. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

interface Finding {
  file: string;
  literal: string;
  rule: "must-derive" | "unowned";
  detail: string;
}

function relative(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

/**
 * Literals that are true, deliberate, and NOT owned by a constant — each with
 * the reason it may stay literal, scoped to ONE file. The file scope is
 * load-bearing: an unscoped `/^24 hours?$/` would let ANY page claim a
 * 24-hour window about anything and pass. Keep this list short; growth is
 * drift.
 */
const ALLOWED: { file: string; literal: RegExp; reason: string }[] = [
  // EMPTY since 2026-09-27. Its one entry let the privacy page hand-write the
  // job record's "24 hours"/"~24 hours", because the queue TTL had no exported
  // default and inventing one to satisfy a test was ruled out (owner ruling,
  // 2026-08-10). The entry's own exit condition — "if a real default is ever
  // exported, derive and delete this entry" — was met: `DEFAULT_JOB_TTL_SECONDS`
  // is the value the queue parser falls back to, now exported, and the page
  // reads it through `RETENTION_WINDOWS.jobRecord`. It is registered in OWNED
  // above, so a hand-written "24 hours" is now a must-derive finding.
  //
  // THE ENTRY'S REASON WAS FALSE WHEN WRITTEN. It said "no compile-time owner
  // exists yet" on 2026-08-09; `DEFAULT_JOB_TTL_SECONDS = 86_400` had existed
  // in redis-config.ts since 2026-07-02, five weeks earlier — private, not
  // absent. The exit condition named the MECHANISM ("exported") rather than
  // the PROPERTY ("a default exists"), which is rule 2. And it was scoped to
  // the one file that said it in digits: the homepage ("lasts about a day")
  // and the FAQ ("kept for about a day") said the same thing in words the
  // digit pattern could not read. Both now derive, and WORD_DURATION_PATTERN
  // reads that spelling.
  //
  // What deriving cannot prove: that production runs the DEFAULT.
  // `PDFXYZ_QUEUE_JOB_TTL_SECONDS` can override it and no page can read it, so
  // every stated window is true only while production leaves it unset.
  // `src/app/job-record-window.test.tsx` holds the operator docs to that.
];

/**
 * EMPTY, and kept that way on purpose (owner ruling, 2026-08-10): the three
 * first-contact findings (25 MB, 2 MB ×2 — caps doubled by inline magic
 * numbers in their own runners) were fixed by giving each runner one owning
 * const that both the size check and the copy derive from. A census that
 * ships with inherited debt teaches the next person that entries are
 * furniture; one that ships empty makes the first entry anyone adds a
 * deliberate act they have to justify.
 */
const BASELINE: { file: string; literal: string }[] = [];

function censusFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const file of copyFiles()) {
    const source = withoutComments(readFileSync(file, "utf8"));
    for (const found of unitLiterals(source)) {
      const { literal, unit } = found;
      if (
        ALLOWED.some(
          (a) => a.file === relative(file) && a.literal.test(literal.trim()),
        )
      )
        continue;
      const owners = ownersOf(found);
      if (owners.length > 0) {
        findings.push({
          file: relative(file),
          literal,
          rule: "must-derive",
          detail: `equals ${owners.join(" = ")} — derive it so the next config change cannot turn this into a lie`,
        });
      } else if (
        [
          "mb",
          "gb",
          "minute",
          "hour",
          "day",
          "week",
          "file",
          "tool",
          "language",
          "run",
          "min",
        ].includes(unit)
      ) {
        findings.push({
          file: relative(file),
          literal,
          rule: "unowned",
          detail:
            "no constant owns this figure — derive it from one, or stop claiming it",
        });
      }
    }
  }
  return findings;
}

describe("user-facing copy does not hand-write figures the code owns", () => {
  it("reads the copy files, so a move cannot quietly empty this census", () => {
    expect(copyFiles().length).toBeGreaterThanOrEqual(30);
  });

  it("reaches the sources that state or own the figures", () => {
    // A count alone cannot notice ONE file leaving the surface — the drift
    // that has now happened twice. Name the load-bearing members, so a source
    // of user-facing figures landing outside this walk collapses here instead
    // of being silently unread. (Same idiom as the shared copy walk's
    // reach-proof; these two surfaces are deliberately different, so each
    // proves its own.)
    const files = copyFiles().map((f) =>
      path.relative(ROOT, f).replace(/\\/g, "/"),
    );
    for (const expected of [
      "src/lib/tools/catalog.ts",
      "src/lib/tools/tool-facts.ts",
      "src/lib/tools/limits.ts",
      "src/lib/faq.ts",
      "src/lib/guides/catalog.ts",
    ]) {
      expect(
        files,
        `the census no longer reads ${expected} — figures stated or owned there are unchecked`,
      ).toContain(expected);
    }
  });

  it("every unit-bearing literal is derived, allowed, or in the reported baseline", () => {
    const baselineKey = (f: { file: string; literal: string }) =>
      `${f.file} :: ${f.literal}`;
    const known = new Set(BASELINE.map(baselineKey));
    const fresh = censusFindings().filter((f) => !known.has(baselineKey(f)));
    expect(
      fresh,
      `these figures are hand-written where the code owns (or does not own) them:\n  ${fresh
        .map((f) => `${f.file}: "${f.literal}" [${f.rule}] — ${f.detail}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  it("the baseline only shrinks (stale entries are removed as fixes land)", () => {
    const current = new Set(
      censusFindings().map((f) => `${f.file} :: ${f.literal}`),
    );
    const stale = BASELINE.map((f) => `${f.file} :: ${f.literal}`).filter(
      (k) => !current.has(k),
    );
    expect(
      stale,
      `these baseline entries no longer occur — remove them so the debt is visible:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("reads durations spelled in words, and not rates (corpus, both directions)", () => {
    // Rule 1: every shape shipped must be caught, and every pattern must
    // catch something shipped. The first two are the sentences that carried
    // the job record's lifetime past this census until 2026-09-27, verbatim.
    // Read as MINUTES, not as an owner: the pattern's job is to see the
    // figure, and pinning the owner here would fail for the wrong reason the
    // day a TTL changes. Ownership is checked relationally below.
    const caught: [sentence: string, minutes: number][] = [
      [
        "a job record — the file's name, never its contents — lasts about a day.",
        24 * 60,
      ],
      [
        "A job record — the file's name, never its contents — is kept for about a day.",
        24 * 60,
      ],
      ["it is kept for about 24 hours", 24 * 60],
      ["Downloads stop after an hour.", 60],
      ["we delete files within an hour", 60],
      ["the record is kept ~ a day", 24 * 60],
      ["the bytes are erased after one day", 24 * 60],
      ["the link lasts a minute", 1],
      ["kept for up to a week", 7 * 24 * 60],
    ];
    for (const [sentence, minutes] of caught) {
      const found = unitLiterals(sentence);
      expect(found, `not read as a figure: "${sentence}"`).toHaveLength(1);
      const { value, unit } = found[0]!;
      expect(value * MINUTES_PER[unit]!, sentence).toBe(minutes);
    }

    // And a literal reaches the constant it restates: the job record's
    // window, spelled the way the pages spell it, is owned by the queue TTL.
    const restated = unitLiterals(
      `kept for about ${RETENTION_WINDOWS.jobRecord}`,
    );
    expect(restated).toHaveLength(1);
    expect(ownersOf(restated[0]!).map((o) => o.split(" ")[0])).toContain(
      "DEFAULT_JOB_TTL_SECONDS",
    );

    // Rates and ordinals share the words and are not durations. A wrong
    // owner is worse than none: "3 free AI runs a day" is the allowance's
    // cadence, and calling it the job TTL would send a writer to the wrong
    // constant.
    for (const sentence of [
      "Your own 3 free AI runs a day — sign in for more",
      "And the amount translated in a day is bounded by the free allowance.",
      "stored copies are erased by a daily storage rule",
      "getting the list right the first time saves you a second pass",
      "before and after a resubmit, a week apart",
      "the allowance resets daily",
    ])
      expect(
        unitLiterals(sentence).filter((l) => l.unit !== "run"),
        `a rate or ordinal was read as a duration: "${sentence}"`,
      ).toEqual([]);
  });
});
