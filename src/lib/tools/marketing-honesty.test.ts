// @vitest-environment node
/**
 * Drift guard between what the MARKETING copy promises and what an engine says
 * about itself in the same repository.
 *
 * The homepage said a user could "translate a brochure while keeping its
 * layout". One click away, the tool panel said "It produces translated text (not
 * a layout-preserving PDF)", and `translate/engine.ts` opens with a scope note
 * saying the same. Every honest surface was honest; the page that sells the
 * product was not, and it is the one a visitor reads first.
 *
 * This is the same shape as the malware claim removed in #33: a promise written
 * next to a picture rather than next to the code, with nothing tying the two
 * together. `output-honesty.test.ts` ties `Tool.outputs` to what the engine
 * WRITES; this ties the prose to what the engine SAYS IT CANNOT DO.
 *
 * Deliberately narrow. It does not attempt to judge marketing language in
 * general — it enforces one rule: where an engine explicitly disclaims a
 * capability, no user-facing copy may promise it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFiles, withoutComments } from "./copy-surface";

const ROOT = process.cwd();

/**
 * One disclaimed capability: where the engine denies it, how the denial reads,
 * and the phrases that would amount to promising it anyway.
 */
const DISCLAIMED = [
  {
    capability: "layout-preserving translation",
    engine: "src/lib/workers/translate/engine.ts",
    /** Proof the engine really does disclaim it — if this moves, the rule is stale. */
    denial: "not a\n * layout-preserving re-typeset PDF",
    /** A promise only counts when it is about translation, hence the pairing. */
    subject: /translat/i,
    promises: [
      /keeping its layout/i,
      /keeps? the layout/i,
      /preserv\w* (?:the )?(?:original )?layout/i,
      /same layout/i,
      /layout[- ]preserving/i,
    ],
  },
] as const;

/**
 * Words that turn a capability phrase into a DENIAL of that capability.
 *
 * Added 2026-08-11, when the copy walk was widened to `src/components/tools`
 * and this guard immediately flagged `translate-worker-panel.tsx` for the
 * phrase "layout-preserving" — inside the sentence "It produces translated text
 * (not a layout-preserving PDF)". That is the sentence THIS FILE'S OWN DOCBLOCK
 * quotes as the honest one.
 *
 * The predicate was giving a correct answer to a different question: it asked
 * "does the phrase appear near 'translate'?" while claiming to ask "does any
 * page PROMISE this?". A guard that cannot tell "not X" from "X" pushes the
 * next person to reword an honest denial, which is fixing the sentence instead
 * of the product.
 */
const NEGATIONS =
  /\b(?:not|never|no|without|cannot|can't|isn'?t|aren'?t|does\s?n'?t|do\s?n'?t|won'?t|rather than|instead of)\b/i;

/**
 * True when the phrase at `index` sits inside a denial rather than a promise.
 *
 * It looks back only to the start of the enclosing clause — a sentence, a
 * parenthesis, a dash or a JSX boundary — because a negation three sentences
 * earlier does not negate this one. `isDenialLookback` is exported to the
 * health check below: a classifier this guard trusts has to be shown, not
 * assumed, to sort the two real strings correctly.
 */
export function isDenialLookback(source: string, index: number): boolean {
  const from = Math.max(0, index - 120);
  const before = source.slice(from, index);
  // Start of the clause: after the last sentence end, opening bracket, dash or tag.
  const clauseStart = Math.max(
    before.lastIndexOf(". "),
    before.lastIndexOf("("),
    before.lastIndexOf("—"),
    before.lastIndexOf(";"),
    before.lastIndexOf(">"),
  );
  const clause = clauseStart >= 0 ? before.slice(clauseStart) : before;
  return NEGATIONS.test(clause);
}

/**
 * Every promise of `subject`'s capability in `source` that is NOT a denial.
 *
 * Extracted so the rule and its positive control run the SAME code: a control
 * that exercises a second copy of the logic proves nothing about the first.
 */
function promisesIn(
  source: string,
  subject: RegExp,
  promises: readonly RegExp[],
): string[] {
  const found: string[] = [];
  if (!subject.test(source)) return found;
  for (const promise of promises) {
    // Every occurrence, not just the first: a file can deny the capability in
    // one paragraph and promise it in another, and a non-global `exec` would
    // stop at the denial and clear the whole file.
    for (const match of source.matchAll(new RegExp(promise, "gi"))) {
      const at = match.index ?? 0;
      // Only flag a promise made near the subject: a `translate-x-0.5` Tailwind
      // class in a file about something else is not a claim.
      if (!source.slice(Math.max(0, at - 400), at + 400).match(subject))
        continue;
      // "not a layout-preserving PDF" is the honest sentence, not the offence.
      if (isDenialLookback(source, at)) continue;
      found.push(match[0]);
    }
  }
  return found;
}

describe("the promise/denial classifier sorts the two real strings", () => {
  // A predicate that quietly stopped flagging anything would empty the rule
  // below and read as "no page promises this". These are the actual sentences:
  // the panel's denial (must be a denial) and the homepage promise this guard
  // was built to catch (must NOT be a denial).
  const DENIAL =
    "It produces translated text (not a layout-preserving PDF) and never fabricates a translation";
  const PROMISE =
    "Translate a brochure while keeping its layout, in seconds, for free.";

  it("reads the panel's parenthetical as a denial", () => {
    const at = DENIAL.indexOf("layout-preserving");
    expect(at).toBeGreaterThan(-1);
    expect(isDenialLookback(DENIAL, at)).toBe(true);
  });

  it("still reads the homepage sentence as a promise", () => {
    const at = PROMISE.indexOf("keeping its layout");
    expect(at).toBeGreaterThan(-1);
    expect(isDenialLookback(PROMISE, at)).toBe(false);
  });

  it("does not let a negation in a PREVIOUS sentence excuse a promise", () => {
    const sneaky =
      "The worker does not read scanned images. Translate a brochure while keeping its layout.";
    const at = sneaky.indexOf("keeping its layout");
    expect(isDenialLookback(sneaky, at)).toBe(false);
  });
});

describe("marketing copy does not promise what an engine disclaims", () => {
  it("reads the copy files, so a move cannot quietly empty this suite", () => {
    expect(copyFiles().length).toBeGreaterThanOrEqual(10);
  });

  it.each(DISCLAIMED)(
    "$engine still disclaims $capability",
    ({ engine, denial }) => {
      // If the engine gains the capability, this fails FIRST — and then the rule
      // below should be deleted, not the copy re-hedged.
      expect(readFileSync(path.join(ROOT, engine), "utf8")).toContain(denial);
    },
  );

  it.each(DISCLAIMED)(
    "no page promises $capability",
    ({ capability, subject, promises }) => {
      const offenders: string[] = [];
      for (const file of copyFiles()) {
        const source = withoutComments(readFileSync(file, "utf8"));
        for (const found of promisesIn(source, subject, promises)) {
          offenders.push(`${path.relative(ROOT, file)}: "${found}"`);
        }
      }
      expect(
        offenders,
        `these promise ${capability}, which the engine explicitly says it does not do:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    },
  );

  it.each(DISCLAIMED)(
    "the rule can still fire — a real promise in $capability copy is caught",
    ({ subject, promises }) => {
      // POSITIVE CONTROL. Skipping denials is the change that could turn this
      // rule into one that flags nothing and reads as "no page promises this".
      // The string is the homepage sentence this guard was built to catch.
      const caught = promisesIn(
        "<p>Translate a brochure while keeping its layout, in seconds.</p>",
        subject,
        promises,
      );
      expect(caught.length).toBeGreaterThan(0);
    },
  );
});
