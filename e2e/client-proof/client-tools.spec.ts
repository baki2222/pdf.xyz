import { expect, test } from "@playwright/test";
import { getRunnerKind, supportedToolSlugs } from "../../src/lib/pdf/registry";
import { processingSplit } from "../../src/lib/tools/processing-split";
import { attachConsoleGuard } from "../helpers";
import { expectMagic } from "./artifacts";
import {
  CASES,
  PROOF_LIMITS,
  UNPROVEN,
  VARIANTS,
  expectControlRejected,
  type CaseContext,
  type ToolCase,
} from "./cases";

/**
 * Proof that the in-browser tools actually work — one parameterised suite over
 * a DERIVED set, not a hand-written spec per tool.
 *
 * Why this file exists. Every readiness surface in this codebase is
 * presence-only: `ready` means a dependency is wired, not that it can run, and
 * on 2026-08-01 that hid five worker tools failing 100% of their jobs while the
 * unit suite stayed green. The worker side answered that with real jobs
 * (`pnpm worker:prove-tools`). The in-browser side had nothing equivalent: its
 * engines are unit-tested in Node, where pdf.js, WebAssembly, canvas, the
 * production CSP and the real download path do not exist. Both browser-only
 * defects this programme has shipped — the pdfjs `wasmUrl` blank-image bug and
 * the `cMapUrl` blank-CJK bug — were invisible to the entire unit suite and
 * would have been invisible to a spec that only asserted "a download button
 * appeared". So every case here reads the bytes the browser actually
 * downloaded, and asserts content that changes when the engine is wrong.
 *
 * Four structural properties, each enforced below rather than asserted in
 * prose:
 *
 *  1. THE SET IS DERIVED, NEVER TYPED. It comes from `supportedToolSlugs` —
 *     the same registry `/tools/[slug]` dispatches on to decide whether to
 *     mount a runner at all. Adding a runner therefore adds a required proof.
 *  2. THE SET IS BOUND BY A SECOND, INDEPENDENT ARTIFACT. The catalogue's own
 *     `processing` claim (`client` | `hybrid`) must name exactly the same
 *     slugs. One list shrinking silently needs the other to shrink in lockstep,
 *     which a single edit cannot do.
 *  3. THE SET'S SIZE IS BOUNDED IN BOTH DIRECTIONS. `[] ⊆ X` is vacuously
 *     true, so a registry that collapsed to two entries would otherwise report
 *     the strongest possible pass; and a floor under the number of PROVEN tools
 *     stops a red case being "fixed" by moving its slug into `UNPROVEN`.
 *  4. EVERY CASE CARRIES A POSITIVE CONTROL. Each assertion is re-run against
 *     bytes it must REJECT, in the same test. A proof that cannot fail is not a
 *     proof, and this is the always-on version of that check.
 */

/* ------------------------------------------------------------------ *
 *  The derived set
 * ------------------------------------------------------------------ */

/**
 * The set under proof. `supportedToolSlugs` is `Object.keys(RUNNERS)`, and
 * `RUNNERS` is what `src/app/tools/[slug]/page.tsx` calls `getRunnerKind`
 * against before it mounts `<ToolRunner>`. A slug that is not in here renders
 * the placeholder panel and has no in-browser engine to prove; a slug that is
 * in here ships an engine to users. Re-pointing that dispatch moves this set
 * with it.
 */
const DERIVED = [...supportedToolSlugs].sort();

/**
 * The second, independent bound: the tool catalogue's own processing claim.
 * `client` runs entirely in the browser, `hybrid` (compress-pdf) analyses in
 * the browser and offers an optional worker step — both ship an in-browser
 * engine. `server` and `ai` do not, and are proven by `worker:prove-tools`.
 *
 * A constant has no relationships to constrain, and neither does a single list.
 * These two are written by different people for different reasons and must
 * agree exactly.
 *
 * `hasBrowserPath` is the named union for that question — "does a local path
 * exist", which is what this proof drives — as opposed to `neverUploads`, the
 * question the privacy surfaces count. Spelling the filter out here a second
 * time is how the two answers came to be confused on the marketing pages; the
 * union carries its own name so this one cannot quietly become that one.
 */
const CATALOGUE_IN_BROWSER = processingSplit()
  .hasBrowserPath.map((tool) => tool.slug)
  .sort();

/**
 * Plausibility floor. Deliberately a number and not a derivation: its whole job
 * is to be an outside opinion about how big this set should be, so that BOTH
 * lists collapsing together — the one failure the cross-check above cannot see —
 * still trips something. 25 is well under today's 30 (room for a tool to be
 * retired) and far above any accidental collapse.
 */
const SET_SIZE_FLOOR = 25;

/**
 * How many in-browser tools may be entirely unproven. Currently ZERO: all 30
 * are driven end to end.
 *
 * Stated as a budget against the derived set rather than as a floor under the
 * proven count, because a bare number drifts out of contact with the thing it
 * is about — retire one tool and an absolute floor fails for a reason nobody
 * meant. This binds the two: however big the registry gets, at most this many
 * of its tools may sit in `UNPROVEN`. Raising it is a visible, arguable diff,
 * which is the point — otherwise the cheapest way to green a failing case is to
 * move its slug into `UNPROVEN` and the suite would applaud.
 *
 * Note that "proven" here means the tool produces a correct artifact on ONE
 * path through its runner. The modes each case does not reach are enumerated in
 * `PROOF_LIMITS`, and are not counted as gaps by this budget.
 */
const MAX_UNPROVEN = 0;

const PROVEN = DERIVED.filter((slug) => slug in CASES);
const GAPS = DERIVED.filter((slug) => slug in UNPROVEN);

/* ------------------------------------------------------------------ *
 *  Meta: the set itself is under test before any tool is
 * ------------------------------------------------------------------ */

test.describe("client tool proof — the derived set", () => {
  test("the registry and the catalogue name the same in-browser tools", () => {
    // Not a subset check in one direction: a subset relation is satisfied by
    // the empty set, and both halves have been silently wrong before.
    expect(
      DERIVED,
      "src/lib/pdf/registry.ts and src/lib/tools/catalog.ts disagree about which tools run in the browser — one of them is lying to users",
    ).toEqual(CATALOGUE_IN_BROWSER);
  });

  test("the derived set is not implausibly small", () => {
    expect(
      DERIVED.length,
      `only ${DERIVED.length} in-browser tools were derived. Either the registry collapsed, or the import above resolved to something other than the live registry. Both make every proof below vacuous.`,
    ).toBeGreaterThanOrEqual(SET_SIZE_FLOOR);
  });

  test("every derived slug still resolves through the live dispatch", () => {
    // Health check on the import itself: `supportedToolSlugs` and
    // `getRunnerKind` must be reading the same object.
    const unresolved = DERIVED.filter((slug) => !getRunnerKind(slug));
    expect(
      unresolved,
      "slugs in the set that the dispatch cannot resolve",
    ).toEqual([]);
  });

  test("every derived slug has exactly one disposition: proven, or a named gap", () => {
    const missing = DERIVED.filter(
      (slug) => !(slug in CASES) && !(slug in UNPROVEN),
    );
    expect(
      missing,
      "in-browser tools with neither a proof case nor a written reason they cannot be proven. A silent skip is the defect this suite exists to close.",
    ).toEqual([]);

    const both = DERIVED.filter((slug) => slug in CASES && slug in UNPROVEN);
    expect(both, "slugs claimed as both proven and unproven").toEqual([]);
  });

  test("no case or gap entry names a slug the registry no longer carries", () => {
    const stale = [...Object.keys(CASES), ...Object.keys(UNPROVEN)].filter(
      (slug) => !DERIVED.includes(slug),
    );
    expect(
      stale,
      "entries pointing at slugs that no longer have an in-browser runner — a proof of something that is not shipped, or a gap that closed itself",
    ).toEqual([]);
  });

  test("the harness proves a plausible share of the set", () => {
    // The `[] ⊆ X` trap, in its most likely local form: a CASES table that
    // emptied (bad merge, bad refactor) would leave the per-tool loop below
    // generating zero tests and the file reporting green.
    expect(PROVEN.length + GAPS.length).toBe(DERIVED.length);
    expect(
      GAPS.length,
      `unproven in-browser tools (${GAPS.join(", ") || "none"}) exceed the agreed budget of ${MAX_UNPROVEN}. Raising MAX_UNPROVEN is a decision someone signs; moving a slug into UNPROVEN to silence a red case is not.`,
    ).toBeLessThanOrEqual(MAX_UNPROVEN);
    // Absolute tripwire, independent of the two lists above: if the registry
    // AND the case table collapsed together, every relative check would still
    // be satisfied.
    expect(
      PROVEN.length,
      "tools with a proof case — implausibly few, so the derivation is broken rather than the tools",
    ).toBeGreaterThanOrEqual(SET_SIZE_FLOOR - MAX_UNPROVEN);
  });

  test("every case is pinned to the runner it was written against", () => {
    // A case drives one specific runner UI. If a slug is ever re-pointed at a
    // different runner, this fails instead of the proof silently exercising
    // the wrong engine and passing.
    const mismatched = Object.entries(CASES)
      .filter(([slug, proof]) => getRunnerKind(slug) !== proof.kind)
      .map(
        ([slug, proof]) =>
          `${slug}: case=${proof.kind} registry=${getRunnerKind(slug)}`,
      );
    expect(mismatched, "cases pinned to the wrong runner kind").toEqual([]);
  });

  test("every option variant names a live slug, its runner, and a reason per control", () => {
    // Variants are extra proofs along a non-default path (see VARIANTS in
    // cases.ts); a variant of a slug the registry no longer carries, or one
    // written against a different runner, proves nothing about what ships.
    const wrong = VARIANTS.filter(
      (v) => !DERIVED.includes(v.slug) || getRunnerKind(v.slug) !== v.kind,
    ).map(
      (v) =>
        `${v.slug} (${v.name}): case=${v.kind} registry=${getRunnerKind(v.slug)}`,
    );
    expect(wrong).toEqual([]);
    // Health: the four tools whose options they exist for each have one.
    expect(new Set(VARIANTS.map((v) => v.slug))).toEqual(
      new Set(["jpg-to-pdf", "png-to-pdf", "pdf-to-jpg", "pdf-to-png"]),
    );
    for (const v of VARIANTS)
      expect(
        v.rejectsBecause?.length ?? 0,
        `${v.slug} (${v.name})`,
      ).toBeGreaterThan(0);
  });

  test("every gap states a reason", () => {
    const empty = Object.entries(UNPROVEN)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([slug]) => slug);
    expect(
      empty,
      "gaps with no written reason — an enumerated gap is honest only while it says why",
    ).toEqual([]);
  });

  test("the per-tool limitations list cannot outlive its subject", () => {
    // A green tick per tool would otherwise read as "this tool is proven",
    // when each case proves ONE path through a runner that offers several.
    // PROOF_LIMITS says which paths are not covered; these checks stop it
    // rotting into a list of tools that no longer exist, or losing its text.
    const orphaned = Object.keys(PROOF_LIMITS).filter(
      (slug) => !(slug in CASES),
    );
    expect(
      orphaned,
      "limitations recorded for slugs that have no proof case at all",
    ).toEqual([]);

    const vague = Object.entries(PROOF_LIMITS)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([slug]) => slug);
    expect(vague, "limitations too short to tell anyone anything").toEqual([]);

    // Health check: an emptied table would report the strongest possible pass.
    expect(
      Object.keys(PROOF_LIMITS).length,
      "PROOF_LIMITS is empty or nearly so, which would claim every runner is covered in every mode",
    ).toBeGreaterThanOrEqual(12);
  });
});

/* ------------------------------------------------------------------ *
 *  The per-tool proofs
 * ------------------------------------------------------------------ */

/**
 * Raster and form paths spin up the pdfjs worker plus wasm and render real
 * pages; the default 30s is not enough for those under a loaded machine.
 */
const CASE_TIMEOUT_MS = 120_000;

if (PROVEN.length === 0) {
  // Never silently generate an empty suite. The describe block above explains
  // why; this makes sure the file cannot look like it ran.
  test("client tool proof — NO CASES WERE GENERATED", () => {
    throw new Error(
      "The derived set produced zero proof cases, so nothing below ran. Fix the derivation before trusting any green result from this file.",
    );
  });
}

const RUNS: { slug: string; title: string; proof: ToolCase }[] = [
  ...PROVEN.map((slug) => ({
    slug,
    title: `${slug} (${CASES[slug]!.kind}) — the downloaded artifact is correct`,
    proof: CASES[slug]!,
  })),
  ...VARIANTS.map((v) => ({
    slug: v.slug,
    title: `${v.slug} (${v.kind}) with ${v.name} — the downloaded artifact is correct`,
    proof: v,
  })),
];

for (const { slug, title, proof } of RUNS) {
  test(title, async ({ page }) => {
    test.setTimeout(CASE_TIMEOUT_MS);
    const guard = attachConsoleGuard(page);

    await page.goto(`/tools/${slug}`);

    // A runner that throws during render is swallowed by the tool-runner error
    // boundary, which would otherwise surface here as a confusing "control not
    // found" far from the cause.
    await expect(
      page.getByText(/this tool hit an unexpected snag/i),
      "the tool runner crashed on mount and the error boundary caught it",
    ).toHaveCount(0);

    const ctx: CaseContext = { page, data: {} };

    // 1. Drive the real UI and capture the bytes the browser downloaded.
    const artifact = await proof.run(ctx);
    expect(artifact.byteLength, "downloaded an empty artifact").toBeGreaterThan(
      0,
    );
    expectMagic(artifact, proof.artifact);

    // 2. The content assertion — what would change if the engine were wrong.
    await proof.assert(artifact, ctx);

    // 3. The positive control(s), run through the SAME assertion. If one
    //    passes, step 2 proved nothing about the property that control varies:
    //    it cannot tell a correct artifact from an incorrect one.
    const declared = await proof.control(ctx);
    const controls = Array.isArray(declared) ? declared : [declared];
    expect(
      controls.length,
      `"${slug}" declared no control bytes — its assertion has never been shown capable of failing`,
    ).toBeGreaterThan(0);
    //    Where the case says WHY each control must fail, the rejection must
    //    carry that check's message: any other throw means the check the
    //    control exists for never ran.
    for (const index of controls.keys()) {
      await expectControlRejected(slug, proof, controls, index, ctx);
    }

    // 4. The production CSP was in force throughout — a blocked worker, wasm
    //    fetch or blob URL surfaces here rather than as a mystery timeout.
    expect(guard.cspViolations(), guard.cspViolations().join("\n")).toEqual([]);
  });
}
