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
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, JOB_LIMITS, RATE_LIMITS } from "@/lib/jobs/types";
import { MAX_OCR_LANGUAGES, OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { toolCount } from "@/lib/tools";
import { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES } from "./limits";
import { processingSplit } from "./processing-split";

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
];

const UNIT_PATTERN =
  /\b(\d+(?:\.\d+)?)\s*(MB|GB|minutes?|hours?|files?|tools?|languages?|runs?\b|min\b)/gi;

/* ------------------------------------------------------------------ *
 *  The copy surface (same walk as pricing-honesty + the workspace UI)
 * ------------------------------------------------------------------ */

function copyFiles(): string[] {
  const roots = [
    path.join(ROOT, "src", "components", "sections"),
    path.join(ROOT, "src", "components", "tools"),
    path.join(ROOT, "src", "app"),
    // WALKED, not listed, since 2026-08-10: this census kept its own list of
    // three files here (catalog, tool-facts, faq) while the shared copy walk
    // had already been converted for exactly this reason — a list is the thing
    // that drifts. `limits.ts` landed in this directory owning two of the caps
    // the copy states, outside the list, and nothing would have said so. The
    // reach-proof below pins the members that must stay in view.
    path.join(ROOT, "src", "lib", "tools"),
  ];
  const out: string[] = [
    // Outside every walked root — the reason a list entry is allowed at all.
    path.join(ROOT, "src", "lib", "faq.ts"),
    // The AI allowance sentence, which left `tool-facts.ts` on 2026-08-11 for
    // the lowest layer its six call sites could all import. This census is the
    // one guard that caught the unowned `500 runs` in the reach measurement,
    // so losing it here loses the only reader of that figure. Listed rather
    // than walking `src/lib/jobs`, for the reason recorded at `copyFiles()` in
    // `copy-surface.ts`; the discovery proof there covers a future move.
    path.join(ROOT, "src", "lib", "jobs", "ai-allowance.ts"),
  ];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  for (const dir of roots) if (statSync(dir).isDirectory()) walk(dir);
  return out.filter((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
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
  {
    // The privacy page's "24 hours"/"~24 hours" job-record window: the real TTL
    // is the queue's env-configured jobTtlSeconds with no compile-time
    // constant, and inventing one so a page can derive from it would be a
    // constant that exists to satisfy a test rather than to govern behaviour
    // (owner ruling, 2026-08-10). If a real default is ever exported, derive
    // and delete this entry.
    file: "src/app/privacy/page.tsx",
    literal: /^24 hours?$/i,
    reason: "queue job TTL is env-configured; no compile-time owner exists yet",
  },
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
    for (const match of source.matchAll(UNIT_PATTERN)) {
      const [literal, num, unitRaw] = match;
      if (!literal || !num || !unitRaw) continue;
      const unit = unitRaw.toLowerCase().replace(/s$/, "");
      const value = Number(num);
      if (
        ALLOWED.some(
          (a) => a.file === relative(file) && a.literal.test(literal.trim()),
        )
      )
        continue;
      const owner = OWNED.find(
        (o) =>
          o.value === value &&
          o.units.some((u) => u.replace(/s$/, "") === unit),
      );
      if (owner) {
        findings.push({
          file: relative(file),
          literal,
          rule: "must-derive",
          detail: `equals ${owner.source} — derive it so the next config change cannot turn this into a lie`,
        });
      } else if (
        [
          "mb",
          "gb",
          "minute",
          "hour",
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
});
