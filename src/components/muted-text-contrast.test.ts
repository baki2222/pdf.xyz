// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/a11y/contrast";
import { LIGHTEST_TEXT_BACKGROUND, SLATE } from "@/lib/a11y/palette";

/**
 * Muted text has to be readable, not merely quiet.
 *
 * `text-slate-500` was the product's tertiary tone in 209 places and
 * `text-slate-600` in 15 more. Measured in a real browser against the pixels
 * actually painted behind them, they came in at 3.44:1 and 2.66:1 — both below
 * the 4.5:1 that WCAG 2.1 AA asks of body text, on captions, helper text, form
 * placeholders, empty-state copy and status detail across every route.
 *
 * WHY THIS COMPUTES INSTEAD OF BANNING A STRING
 * `expect(source).not.toContain("text-slate-500")` would pass today and say
 * nothing about `text-slate-600`, which was broken the same way and by more,
 * or about `text-slate-700` if someone reaches for it next. This resolves each
 * `text-slate-N` the tree actually uses and applies the contrast formula, so
 * the guard encodes the REQUIREMENT rather than one instance of it. A step that
 * is not in the measured palette fails loudly rather than being skipped —
 * a checker that silently ignores what it cannot resolve is how the first
 * version of the audit script reported this very palette as clean.
 *
 * WOULD THIS BE GREEN IF THE FIX WERE ABSENT? No, and that is measured rather
 * than assumed: this rule was run over the pre-fix tree by reading every file
 * back out of git (`git show HEAD:<path>`) and it reports 224 offending
 * occurrences across 60 files — 209 `text-slate-500` and 15 `text-slate-600`,
 * which is the survey's "209 occurrences" plus the sibling it had not counted.
 * After the swap it reports 0, and `text-slate-400` clears the bar at 6.23:1.
 *
 * WHAT IT CANNOT DO
 * It reads class names, so it cannot see which surface a given element is
 * painted on; it assumes the dark theme and enumerates the exceptions below.
 * A NEW light-text step added inside the signature previews would therefore be
 * measured against the wrong backdrop and pass. `pnpm a11y:contrast` is the
 * check that has no such blind spot — it measures rendered pixels — and this
 * one exists because that one cannot reach surfaces that only render after a
 * job completes. Neither subsumes the other.
 *
 * SCOPE, DELIBERATELY
 * Only the slate ramp used as a TEXT colour. Slate fills and gradient stops
 * are a different rule with a different threshold (non-text contrast), and
 * since 2026-10-09 `raw-palette.test.ts` decides where any fill may name a
 * hue at all: only on the white page a tool draws, such as the page tile's
 * skeleton lines. (This note used to list three slate fill classes by name;
 * two had left the tree, and Tailwind generates any class a comment spells
 * whole, so the list kept shipping CSS for them.) Widening this to every
 * `text-*` utility would have to
 * distinguish colours from `text-xs`, `text-center` and `text-[11px]`, and a
 * guard that flags unrelated things is a guard the next person routes around.
 */

const ROOTS = [
  path.join(process.cwd(), "src", "components"),
  path.join(process.cwd(), "src", "app"),
];

/** WCAG 2.1 AA for body-sized text. Muted copy in this product is 11–14px. */
const REQUIRED_RATIO = 4.5;

const WHITE = { r: 255, g: 255, b: 255 };

/**
 * The product is dark everywhere except the signature previews, which render a
 * typed or drawn signature on `bg-white` paper. Dark slate text is correct
 * there and would be the bug anywhere else, so the exception is ENUMERATED
 * rather than inferred from "the file also mentions bg-white" — ten files
 * mention it, and only this one puts text on it.
 *
 * The exception is still measured: these steps are held to the same 4.5:1,
 * against white instead. Writing this run: `text-slate-900` on the signature
 * itself (17.6:1), and `text-slate-600` on the empty-state line — which was
 * `text-slate-400` at 2.63:1 until this guard pointed at it. That one was NOT
 * caused by the slate-500 sweep; it predates it, and it is the reason this
 * check resolves colours instead of banning a token.
 */
const LIGHT_SURFACES: { file: string; steps: number[] }[] = [
  {
    file: path.join("src", "components", "tools", "runner", "sign-runner.tsx"),
    steps: [600, 900],
  },
];

function isLightSurface(file: string, step: number): boolean {
  return LIGHT_SURFACES.some(
    (entry) => file.endsWith(entry.file) && entry.steps.includes(step),
  );
}

/** Matches any variant prefix too: `placeholder:`, `hover:`, `group-hover:`. */
const TEXT_SLATE = /text-slate-(\d{2,3})\b/g;

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
        ? [full]
        : [];
    });
  return ROOTS.flatMap(walk);
}

type Usage = { file: string; step: number; line: number };

function slateTextUsages(): Usage[] {
  const usages: Usage[] = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const match of text.matchAll(TEXT_SLATE)) {
        usages.push({
          file: path.relative(process.cwd(), file),
          step: Number(match[1]),
          line: index + 1,
        });
      }
    });
  }
  return usages;
}

describe("muted text meets WCAG AA on the app's own background", () => {
  const usages = slateTextUsages();

  it("the only slate text left is the enumerated signature paper", () => {
    // HISTORY, KEPT (inverted, not deleted — house rule):
    //
    // RE-ANCHORED 2026-08-16, deliberately, with the redesign that moved the
    // homepage, tool pages and workspace onto semantic tokens: `text-slate-*`
    // stopped being the product's muted idiom and became its LEGACY idiom.
    // The legacy count was 72 that day, and this check was a BAND —
    // `>= 60 && <= 72` — with the floor guarding against a walk that lost
    // half the corpus (a BFS bug once collapsed a call graph to TWO entries:
    // fewer, not none) and the ceiling against slate creeping back onto a
    // token surface. Its own text ordered: "when the count reaches the two
    // deliberate sign-runner steps, this check gets rewritten to enumerate
    // them."
    //
    // That day arrived 2026-08-16, same date, when the last legacy surfaces
    // (/status, /privacy, /terms, the error pages, and the status component
    // suite) converted to tokens. The 70 legacy usages are gone; what remains
    // is exactly LIGHT_SURFACES — the signature paper, where DARK slate text
    // on white is the correct rendering and a token role would be wrong. The
    // enumeration below is exhaustive both ways: every remaining usage must
    // be a LIGHT_SURFACES entry (slate may not come back as a text colour
    // anywhere else), and "exempts only light surfaces that genuinely exist"
    // below keeps every entry pointing at a real usage. Together they pin the
    // corpus at exactly its enumerated members, which is a tighter bound than
    // the band ever was — the walker-health floor is now the requirement that
    // the enumerated usages are FOUND, so an empty walk still fails.
    const unexpected = usages.filter(
      (usage) => !isLightSurface(usage.file, usage.step),
    );
    expect(
      unexpected.map((u) => `${u.file}:${u.line} text-slate-${u.step}`),
      "slate is the legacy idiom; new muted text uses the token roles (text-muted / text-faint)",
    ).toEqual([]);
    // The positive control: the walk still sees the enumerated members, so a
    // broken walker cannot report this suite green by finding nothing.
    expect(usages.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves every slate step that the tree uses", () => {
    const unknown = [...new Set(usages.map((u) => u.step))].filter(
      (step) => !(step in SLATE),
    );
    expect(unknown).toEqual([]);
  });

  it("clears 4.5:1 against the surface it is actually painted on", () => {
    const offenders = usages
      .map((usage) => {
        const color = SLATE[usage.step];
        if (!color) return `${usage.file}:${usage.line} unresolved step`;
        const light = isLightSurface(usage.file, usage.step);
        const backdrop = light ? WHITE : LIGHTEST_TEXT_BACKGROUND;
        const ratio = contrastRatio(color, backdrop);
        if (ratio + 1e-9 >= REQUIRED_RATIO) return null;
        return `${usage.file}:${usage.line} text-slate-${usage.step} on ${light ? "white" : "the dark theme"} (${ratio.toFixed(2)}:1)`;
      })
      .filter((entry): entry is string => entry !== null);

    expect(offenders).toEqual([]);
  });

  it("exempts only light surfaces that genuinely exist", () => {
    // An allowlist nobody uses is an allowlist that quietly grows. Every entry
    // must correspond to a real usage, so a stale one fails instead of sitting
    // there ready to excuse the next mistake.
    for (const entry of LIGHT_SURFACES) {
      for (const step of entry.steps) {
        expect(
          usages.some(
            (usage) => usage.file.endsWith(entry.file) && usage.step === step,
          ),
          `${entry.file} no longer uses text-slate-${step}`,
        ).toBe(true);
      }
    }
  });

  it("pins the ratios the decision was made on", () => {
    // If Tailwind's palette shifts under us, this fails and says so rather than
    // letting the guard above quietly start measuring different colours.
    const onDark = (step: number) =>
      Number(contrastRatio(SLATE[step]!, LIGHTEST_TEXT_BACKGROUND).toFixed(2));
    expect(onDark(600)).toBe(2.16);
    expect(onDark(500)).toBe(3.44);
    expect(onDark(400)).toBe(6.23);
    expect(onDark(300)).toBe(11.02);

    // And the light-surface pairing the exception rests on.
    expect(Number(contrastRatio(SLATE[400]!, WHITE).toFixed(2))).toBe(2.63);
    expect(Number(contrastRatio(SLATE[600]!, WHITE).toFixed(2))).toBe(7.58);
  });
});
