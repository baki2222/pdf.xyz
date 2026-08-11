/**
 * The surfaces the honesty guards read, defined once.
 *
 * Until 2026-08-10 each guard hand-copied the copy-file walk, and a comment
 * promised the copies could "never cover different pages". They already did:
 * the marketing guard's copy was missing `src/lib/site.ts`, which the pricing
 * guard had gained — the comment-enforced invariant drifted exactly the way
 * the prose those guards police does. Importing one function is the
 * mechanical version of the promise.
 *
 * Scope note: the numbers census and the legal-pages overclaim scan read
 * DIFFERENT, deliberate surfaces (the numbers census still walks its own
 * roots, which now overlap this one; the legal scan is narrower — the
 * FAQ-plus-sections block) and do not import this walk. A new guard that
 * wants the visitor-readable page surface imports it from here rather than
 * copying it.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Every user-facing source file whose text a visitor can read.
 *
 * `src/lib/tools` is WALKED, not listed, since 2026-08-10: the explicit list
 * drifted twice — marketing-honesty missed `site.ts`, and then the walk
 * itself missed `tool-facts.ts`, the file holding the facts, FAQ answers,
 * and steps for all fifty tool pages, in the very change built so that
 * class could not recur. A list is the thing that drifts; the walk also
 * picks up `categories.ts` and `processing.ts`, whose descriptions are
 * user-facing copy the list never carried. `faq.ts` and `site.ts` stay
 * listed because they live outside any walked root — each with this reason.
 *
 * `src/components/tools` joined on 2026-08-11, and the reason is the sixth
 * appearance of the same gap. A census of AI-scope claims found ten in the
 * tool panels — including the sentence a visitor reads directly above the
 * file picker while deciding whether to upload a 300-page report. Every one
 * of them sat outside this walk, so `marketing-honesty`, `pricing-honesty`
 * and `account-honesty` were blind to the panels entirely; only
 * `numbers-honesty` reached them, through a wider list of its own. The
 * earlier scope note said the runner surface "belongs to a different guard",
 * which was true of numbers and false of everything else — a page a visitor
 * reads is a page a copy guard should read, and where the component happens
 * to live is not a reason.
 *
 * `src/lib/jobs/ai-allowance.ts` joined on 2026-08-11, and it is the seventh
 * appearance: the AI allowance sentence was moved OUT of `tool-facts.ts` into
 * the lowest layer all six of its call sites could import — the right home for
 * the constant, and outside every walked root. Membership survived and
 * COVERAGE LEFT. Measured: the sentence *"Your own 3 free AI runs a day — sign
 * in to upgrade to Pro for $9 per month, or buy 500 runs."* in the new home
 * gave 30 passed / 0 failed; the identical sentence in the old home gave 6
 * failures (sign-in invitation, literal price, billing cadence, upgrade CTA,
 * upsell pitch, and the census's unowned `500 runs`).
 *
 * WHY A FILE AND NOT THE DIRECTORY, because a list is the thing that drifts and
 * this entry is one: walking `src/lib/jobs` was tried first and produces two
 * findings that are comments rather than copy — `types.ts` writes
 * `maxFileBytes: 100 * 1024 * 1024, // 100 MB`, and {@link withoutComments}
 * strips only FULL-LINE `//`. Buying the directory costs either two baseline
 * entries (which this census refuses on principle) or a change to the stripper
 * that would blind it wherever a string contains `//`. So the list entry stays
 * and the drift is closed a different way: `copy-surface.test.ts` DISCOVERS
 * every file under `src/lib` that defines an allowance sentence and requires
 * the walk to reach it, so moving the constant again collapses loudly wherever
 * it lands.
 */
export function copyFiles(): string[] {
  const roots = [
    path.join(ROOT, "src", "components", "sections"),
    path.join(ROOT, "src", "components", "tools"),
    path.join(ROOT, "src", "app"),
    path.join(ROOT, "src", "lib", "tools"),
  ];
  const out: string[] = [
    path.join(ROOT, "src", "lib", "faq.ts"),
    path.join(ROOT, "src", "lib", "site.ts"),
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

/**
 * Source with comments removed. These guards scan prose, and a docblock
 * explaining the defect a guard exists to prevent will contain the very
 * phrase it forbids — flagging those is a false positive, and a guard that
 * cries wolf is a guard the next person weakens. Only what a user can read
 * counts.
 *
 * `^\s*` IS LOAD-BEARING and stays: only full-line `//` comments are stripped,
 * so a TRAILING `// 100 MB` survives into the scan and reads as a claim. That
 * is a false positive, which errs toward over-reporting; dropping the anchor
 * would strip from the first `//` to end of line and silently eat the rest of
 * any line containing a URL, which errs toward a blind guard. Measured
 * 2026-08-11 on `src/lib/jobs/types.ts`, whose two trailing unit comments are
 * the reason that directory is not walked wholesale.
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Flatten source so a MULTI-WORD phrase can be searched for without the search
 * depending on where the formatter happened to break the line.
 *
 * **A line-based or literal phrase search has a hole at every wrap point**, and
 * this is the material where the holes matter: prose is reflowed to a column, and
 * long strings are split across lines by convention. Both were demonstrated on
 * 2026-08-11:
 *
 *  - The owner's `grep "circuit breaker"` returned two hits where there were
 *    three. In `ratelimit/policy.ts` the phrase straddled a wrap — `circuit` ended
 *    one line and `breaker` began the next — so a line-based search could not
 *    match it. Two hits was never "two copies"; it was "the copies where the
 *    phrase happens not to straddle a break".
 *  - The same hole was then found in OUR OWN guard. `ai-allowance-copy.test.ts`
 *    scans for `shared across everyone using pdf.xyz`; writing that sentence as
 *    `"…shared across everyone " + "using pdf.xyz…"` — ordinary, prettier-produced
 *    formatting — walked straight past it. Reproduced: the split literal in a
 *    walked file left the stale-claim assertion green.
 *
 * THREE EVASIONS, and they are genuinely different — the third was found by a
 * control that caught the author reproducing the wrong one:
 *
 *  1. **A real line break in the source.** A wrapped comment, or a template
 *     literal spanning lines. Closed by collapsing whitespace runs.
 *  2. **A concatenation join** — `"a " + "b"`, which prettier writes for you at
 *     80 columns. Closed by removing the join.
 *  3. **An ESCAPED break inside a string literal** — `"does\n  not resend"`. On
 *     disk that is a backslash and an `n`, not whitespace, so rule 1 cannot see
 *     it. Closed by treating `\n`/`\r`/`\t` escapes as spaces. This is the one
 *     the author's own reproduction actually used while believing it was case 1,
 *     which is why the control asserts the un-flattened miss as well as the
 *     flattened catch: without pinning the "before", a fix can appear to work on
 *     a mechanism it never touched.
 *
 * What is left is what a READER sees, which is the thing the guard is about.
 *
 * NOT CLOSED: a phrase broken by interpolation — `` `does not ${verb} the
 * document` `` — still passes every guard, because after flattening the source
 * still reads `does not ${verb} the document`. Closing it means evaluating
 * template expressions, which is a different instrument from a text scan, and
 * nothing in this codebase builds a user-facing claim out of runtime parts
 * today. Recorded as a known bound rather than left to be discovered.
 */
export function flattenForPhraseSearch(source: string): string {
  return source
    .replace(/(["'`])\s*\+\s*\1/g, "")
    .replace(/\\[nrt]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Every `.ts`/`.tsx` non-test source under `src/lib` — the search space for
 * "where did this constant go", not a guard surface of its own.
 */
export function libSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  walk(path.join(ROOT, "src", "lib"));
  return out;
}

/**
 * Does this source DEFINE an allowance sentence, as opposed to re-exporting
 * one?
 *
 * The distinction is the whole point. `ratelimit/response.ts` and
 * `workers/ai-tool-availability.ts` both surface the sentence to users, but
 * neither holds the words — they re-export (`export { X }`) or alias
 * (`export const Y = X`). Only an initialiser that OPENS A STRING is a place
 * the words can go stale, and only that place has to be inside the copy walk.
 * Exercised in both directions by `copy-surface.test.ts`.
 */
export function definesAllowanceCopy(source: string): boolean {
  return /export\s+const\s+\w*ALLOWANCE\w*\s*(?::[^=]+)?=\s*[`"']/.test(source);
}

/** The operator docs: top-level `docs/*.md` — the docs-integrity surface. */
export function operatorDocs(): string[] {
  const dir = path.join(ROOT, "docs");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name));
}
