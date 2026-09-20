// @vitest-environment node
/**
 * Every figure in the homepage stats strip is derived from the thing it counts.
 *
 * ── THE ONE THAT WASN'T ─────────────────────────────────────────────────────
 *
 * Until 2026-09-20 the fourth cell read `{ value: "0", label: "Files stored
 * after processing" }`. It is the largest privacy claim on the site, set in
 * the largest type on the busiest page, and it was untrue: the output of a
 * worker job IS stored — until the download link expires, with the stored copy
 * erased by a daily rule after that — and a job record is kept for about a day.
 *
 * `src/lib/faq.ts` had already corrected this exact sentence and left the
 * reason beside it: the FAQ once said "permanently deleted within minutes …
 * nothing is retained", which was "three separate untruths the privacy page
 * already corrects — the link dying and the bytes dying are different events".
 * The correction reached the FAQ, the privacy page and eleven guides. It did
 * not reach the homepage.
 *
 * WHY IT SURVIVED, WHICH IS THE PART WORTH KEEPING. Every other cell is a
 * derived count, and the strip's own JSX comment says "the counts are derived
 * from the catalogue" — true of three of four. A typed `"0"` has no constant
 * to bind it to, so the numbers census, the honesty guards and every
 * interpolation check were structurally unable to see it. CLAUDE.md rule 3:
 * "A constant has no relationships to constrain." The fix for that is not a
 * better ban list, it is to leave no literal for a ban list to have to find.
 *
 * So this asserts the SHAPE — no numeric literal may be a cell's value — which
 * holds for figures nobody has thought of yet, and then binds each cell to the
 * source it claims to come from.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";

const FILE = "src/components/sections/stats-band.tsx";
const SOURCE = readFileSync(path.join(process.cwd(), FILE), "utf8");
const CODE = withoutComments(SOURCE);

/** The `value:` expressions in the `stats` array, as written. */
function cellValues(source: string): string[] {
  const start = source.indexOf("const stats = [");
  if (start === -1) return [];
  const end = source.indexOf("];", start);
  if (end === -1) return [];
  return [...source.slice(start, end).matchAll(/value:\s*([^,\n]+)/g)].map(
    (m) => m[1]!.trim(),
  );
}

describe("the homepage stats strip", () => {
  const values = cellValues(CODE);

  it("was actually parsed (health check)", () => {
    // Without this, a parser that found nothing would report the strongest
    // possible pass on the assertion below — `[] ⊆ X` is vacuously true, and
    // a strip with no cells is not a strip that is honest.
    expect(values.length, "no stats cells parsed from " + FILE).toBe(4);

    // Positive control THROUGH the parser: it can see a literal when there is
    // one, which is the state this file exists to catch.
    expect(
      cellValues('const stats = [\n{ value: "0", label: "x" },\n];'),
    ).toEqual(['"0"']);
  });

  it("states no figure as a literal", () => {
    const literals = values.filter((v) => /^["'`]?[\d.,]+["'`]?$/.test(v));
    expect(
      literals,
      "a typed figure on this strip cannot be bound to the thing it counts, " +
        "which is exactly how `0 files stored after processing` outlived the " +
        "correction that removed it everywhere else: " +
        literals.join(", "),
    ).toEqual([]);
  });

  it("takes the retention figure from the policy the FAQ and guides quote", () => {
    // Not "contains the number 60" — that would pass for a 60 typed by hand,
    // and would go red for the wrong reason the day the policy changes.
    expect(CODE).toContain("DEFAULT_RETENTION.outputTtlMinutes");
    expect(CODE).toContain('from "@/lib/jobs/types"');
  });

  it("makes no claim that nothing is stored", () => {
    // The retired sentence, and the shapes it would come back as. Matched on
    // the rendered LABELS, not the whole file, so the docblock above — which
    // quotes the untruth in order to record it — does not trip its own guard.
    const labels = [...CODE.matchAll(/label:\s*"([^"]+)"/g)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(labels.length, "no labels parsed").toBe(4);

    const BANNED = [
      /\bstored after\b/,
      /\bnothing (is |was )?(retained|stored|kept)\b/,
      /\bnever (stored|retained|kept)\b/,
      /\bzero files\b/,
      /\bfiles (stored|retained|kept)\b/,
    ];
    const offenders = labels.filter((l) => BANNED.some((re) => re.test(l)));
    expect(
      offenders,
      "this strip is where the retired retention claim lived: " +
        offenders.join(", "),
    ).toEqual([]);

    // Every pattern must catch some shipped sentence — the corpus in both
    // directions, CLAUDE.md rule 1. These are the exact wordings the product
    // has used, so a pattern that matches none of them is decoration.
    const SHIPPED = [
      "files stored after processing",
      "nothing is retained",
      "files never stored",
      "zero files kept",
    ];
    for (const re of BANNED) {
      expect(
        SHIPPED.some((s) => re.test(s)),
        "pattern " + String(re) + " catches nothing the product ever shipped",
      ).toBe(true);
    }
  });
});
