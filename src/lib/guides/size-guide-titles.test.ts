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

/**
 * THE GATE FOR ANY FUTURE PER-SIZE URL (audit #2, 2026-11-17).
 *
 * The size guides answer every size from ONE page per tool, with a table;
 * there is no page per size. Google's spam policies call pages "created to
 * rank for specific, similar search queries" doorways, and one page per size,
 * differing only in the number, is that shape.
 *
 * The subjects are every guide whose TITLE names a size, plus every guide
 * whose SLUG ends in one (`-300-kb`), so a templated page cannot slip in by
 * keeping the number out of its title. Each subject's structural signature is
 * its tools and its sorted section ids; two pages that differ only in the
 * number share both. A page with a genuinely different procedure (other tools
 * or other sections) gets a signature of its own and passes.
 *
 * The test enforces only the signature. The procedure for a per-size URL is
 * longer and is not enforced here: its PR must also argue a decision on the
 * title rule above (every sized title names every preset), and raise the
 * guide-count cap in catalog.test.ts with a written reason.
 */
const SIZE_IN_SLUG = /-\d+-(kb|mb)$/;

type GuideLike = Pick<
  (typeof guides)[number],
  "slug" | "title" | "tools" | "sections"
>;

function sizeSubjects<G extends GuideLike>(all: readonly G[]): G[] {
  return all.filter(
    (g) => SIZE_IN_TITLE.test(g.title) || SIZE_IN_SLUG.test(g.slug),
  );
}

const signature = (g: GuideLike) =>
  `${g.tools.join(",")}|${g.sections
    .map((s) => s.id)
    .sort()
    .join(",")}`;

/** The slugs whose signature an earlier subject already has. */
function duplicateSignatures(subjects: readonly GuideLike[]): string[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const g of subjects) {
    const sig = signature(g);
    if (seen.has(sig)) dupes.push(g.slug);
    else seen.set(sig, g.slug);
  }
  return dupes;
}

describe("no two size pages share a procedure", () => {
  const subjects = sizeSubjects(guides);

  it("finds the size guides (health check: at least 2)", () => {
    expect(subjects.length).toBeGreaterThanOrEqual(2);
  });

  it("every size page has a signature of its own", () => {
    expect(duplicateSignatures(subjects)).toEqual([]);
  });

  it("a per-size clone of the compress guide is caught (positive control)", () => {
    const compress = guides.find(
      (g) => g.slug === "how-to-compress-a-pdf-to-100-kb",
    )!;
    const clone = {
      ...compress,
      slug: "how-to-compress-a-pdf-to-300-kb",
      title: "How to compress a PDF to 300 KB",
    };
    // Found by its slug alone too: a clone that keeps the number out of
    // its title is still a subject.
    const untitled = { ...clone, title: "How to compress a PDF for a form" };
    expect(sizeSubjects([untitled])).toEqual([untitled]);
    expect(duplicateSignatures(sizeSubjects([...guides, clone]))).toEqual([
      clone.slug,
    ]);
  });
});

/**
 * Claims no size copy may make (audit #2, 2026-11-17): a 1–2 MB limit
 * attributed to email, and any "about N pages fit" figure, for which no
 * measured corpus exists in this codebase. The strongest audience claim
 * allowed is the JPG guide's hedge about application portals.
 *
 * House rule 1 says a pattern nothing exercises is decoration. No shipped
 * sentence ever had these shapes, so these patterns are exercised ONLY by
 * their positive controls below; this is a ban on a future sentence, not a
 * record of a past one.
 *
 * The corpus is every string in each size page's guide object, walked rather
 * than listed, so a field added later (a table's cells) is in it.
 */
const BANNED_SIZE_CLAIMS = [
  /\be-?mail\b/i,
  /\bpages? (?:fit|will fit)\b/i,
  /\babout \d+ pages\b/i,
];

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return [];
}

/** The banned patterns `text` matches, by source. */
function bannedClaims(text: string): string[] {
  return BANNED_SIZE_CLAIMS.filter((re) => re.test(text)).map(
    (re) => re.source,
  );
}

describe("size copy makes no claim it cannot back", () => {
  const corpus = sizeSubjects(guides).flatMap(strings).join("\n");

  it("reads the real text (health check: long, and holds the allowed hedge)", () => {
    expect(corpus.length).toBeGreaterThan(2_000);
    expect(corpus).toContain("Application portals for jobs, exams and visas");
  });

  it("each banned shape is caught (positive controls)", () => {
    expect(bannedClaims("Email limits are often 2 MB")).toEqual([
      BANNED_SIZE_CLAIMS[0]!.source,
    ]);
    expect(bannedClaims("about 40 pages fit under 1 MB")).toEqual([
      BANNED_SIZE_CLAIMS[1]!.source,
      BANNED_SIZE_CLAIMS[2]!.source,
    ]);
  });

  it("no size page makes one", () => {
    expect(bannedClaims(corpus)).toEqual([]);
  });
});
