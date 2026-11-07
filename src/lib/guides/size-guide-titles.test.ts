// @vitest-environment node
/**
 * A guide whose title promises a file size names EVERY size the panel offers.
 *
 * Audit search-demand#2 (2026-11-06): Compress PDF's Target size and JPG to
 * PDF's Max file size both offer 100 KB, 200 KB, 500 KB and 1 MB (one list,
 * `SIZE_PRESETS`), yet the only size guides were titled "…100 KB (or 200
 * KB)". Searches for 500 KB and 1 MB, which the panels serve with one click,
 * met no page whose title named them.
 *
 * The set is DISCOVERED, not typed: every guide whose title names a size in
 * KB or MB. Each must name every preset label, so a preset added to
 * `SIZE_PRESETS` fails here until the titles catch up — and the e2e title
 * ceiling (65 with the " — pdf.xyz" suffix) is checked here too, so that
 * catch-up cannot quietly overrun a results page.
 */
import { describe, expect, it } from "vitest";
import { MIN_TARGET_BYTES } from "@/lib/pdf/compress-target";
import { MIN_LIMIT_BYTES } from "@/lib/pdf/image-size-limit";
import { KB, MB, SIZE_PRESETS } from "@/lib/pdf/size-presets";
import { guides } from "./catalog";

const SIZE_IN_TITLE = /\b\d+ (KB|MB)\b/;
const SUFFIX = " — pdf.xyz";
const TITLE_MAX = 65;

/** The preset labels a title leaves out. */
function presetsNotNamed(title: string): string[] {
  return SIZE_PRESETS.map((p) => p.label).filter((l) => !title.includes(l));
}

describe("size guides name every size the panels offer", () => {
  const sized = guides.filter((g) => SIZE_IN_TITLE.test(g.title));

  it("finds both size guides (health check: an empty set passes vacuously)", () => {
    expect(sized.map((g) => g.slug).sort()).toEqual(
      expect.arrayContaining([
        "how-to-compress-a-pdf-to-100-kb",
        "how-to-convert-jpg-to-pdf-under-100-kb",
      ]),
    );
  });

  it("catches the titles this audit found (positive control)", () => {
    expect(
      presetsNotNamed("How to compress a PDF to 100 KB (or 200 KB)"),
    ).toEqual(["500 KB", "1 MB"]);
  });

  it.each(sized.map((g) => [g.slug, g.title]))(
    "%s names every preset",
    (_slug, title) => {
      expect(presetsNotNamed(title)).toEqual([]);
      expect((title + SUFFIX).length).toBeLessThanOrEqual(TITLE_MAX);
    },
  );
});

/**
 * The FAQ's "type the size in KB: N for LABEL" examples (2026-11-07 review):
 * each N must be LABEL in KB, LABEL must not already be a preset (the FAQ is
 * about sizes reached through Custom), and it must clear both panels' Custom
 * minimums, so the reader's typed value is accepted.
 */
const CUSTOM_EXAMPLE = /(\d+)(?: KB)? for (\d+) (KB|MB)\b/g;

function customExampleProblems(answer: string): string[] {
  const at = answer.indexOf("type the size in KB:");
  if (at < 0) return [];
  const problems: string[] = [];
  const presets = SIZE_PRESETS.map((p) => p.label);
  for (const m of answer.slice(at).matchAll(CUSTOM_EXAMPLE)) {
    const typedKb = Number(m[1]);
    const label = `${m[2]} ${m[3]}`;
    const bytes = Number(m[2]) * (m[3] === "MB" ? MB : KB);
    if (typedKb * KB !== bytes) problems.push(`${typedKb} is not ${label}`);
    if (presets.includes(label)) problems.push(`${label} is a preset`);
    if (bytes < Math.max(MIN_LIMIT_BYTES, MIN_TARGET_BYTES))
      problems.push(`${label} is below a Custom minimum`);
  }
  return problems;
}

describe("size guides' Custom examples", () => {
  const answers = guides
    .filter((g) => SIZE_IN_TITLE.test(g.title))
    .flatMap((g) => g.faq.map((f) => f.answer))
    .filter((a) => a.includes("type the size in KB:"));
  const examples = answers.flatMap((a) => [
    ...a.slice(a.indexOf("type the size in KB:")).matchAll(CUSTOM_EXAMPLE),
  ]);

  it("finds the examples (health check: 2 MB twice and 300 KB once)", () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
  });

  it("catches a wrong or preset example (positive control)", () => {
    expect(
      customExampleProblems("type the size in KB: 300 for 200 KB, 1 for 1 KB."),
    ).toEqual([
      "300 is not 200 KB",
      "200 KB is a preset",
      "1 KB is below a Custom minimum",
    ]);
  });

  it("every example is right, off-preset and accepted", () => {
    expect(answers.flatMap(customExampleProblems)).toEqual([]);
  });
});
