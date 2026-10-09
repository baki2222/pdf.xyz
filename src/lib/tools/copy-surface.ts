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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Walked roots that do not exist YET, each with the package that creates it.
 * A pending root is walked from its first file, so the phrase code planned
 * for it is under the copy guards the day it lands — nobody has to remember
 * to add it. Once the folder exists `copy-surface.test.ts` fails until the
 * root is moved into `copyFiles()`'s own root list and its entry here is
 * deleted, so a typo'd root cannot hide here.
 */
export const PENDING_COPY_ROOTS: Record<string, string> = {
  "src/lib/intent":
    "the redesign's intent layer (WP-03 creates it: formats, search, and later evidence, hints and the ticket) — user-facing phrase modules by design",
};

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
 *
 * ALL of `src/components` since 2026-09-27, replacing the two component roots
 * (`sections`, `tools`) — the eighth appearance. The docblock above promised
 * "every user-facing source file", and the walk skipped the site footer
 * ("Privacy-first by architecture, not by policy."), the upload zone, the
 * status and legal components, and the shared social card. That card
 * (`src/lib/og.tsx`, now listed) carried an unhedged "Runs in your browser"
 * chip while roughly two in five tools upload to a worker, and every
 * honesty guard was blind to it. A component folder is user-facing by
 * construction, so the whole directory is walked; `copy-surface.test.ts`
 * requires every component file to be reached, so a new folder cannot fall
 * outside it.
 *
 * `src/lib/workspace` joined on 2026-10-09 — the ninth appearance, found by
 * the redesign's survey rather than by a defect: the workspace's tool
 * suggestions are sentences a visitor reads beside their files, and the folder
 * was the one copy-holding lib directory outside the walk. The same day the
 * walk stopped being the only proof: `copy-surface.test.ts` now DISCOVERS
 * every `src/lib` module that exports words (copy reach) and every `.tsx` with
 * JSX text, and requires each to be walked or recorded with a reason.
 */
export function copyFiles(): string[] {
  const roots = [
    path.join(ROOT, "src", "components"),
    path.join(ROOT, "src", "app"),
    path.join(ROOT, "src", "lib", "tools"),
    // The guides catalogue: long-form instructional prose a visitor reads at
    // /guides/[slug], shipped to crawlers as HowTo + FAQPage JSON-LD. Joined
    // 2026-09-17, BEFORE the first guide was written — the tool-facts lesson
    // applied in order. A directory root, not a listed file, so a second
    // guides module cannot land outside the wall. Its files must not carry
    // trailing unit comments (`// 100 MB`): only full-line comments are
    // stripped, by design — see withoutComments.
    path.join(ROOT, "src", "lib", "guides"),
    // The workspace's suggestions and file classification (see above). Same
    // rule: no trailing unit comments in its files.
    path.join(ROOT, "src", "lib", "workspace"),
    ...Object.keys(PENDING_COPY_ROOTS).map((root) => path.join(ROOT, root)),
  ];
  const out: string[] = [
    path.join(ROOT, "src", "lib", "faq.ts"),
    path.join(ROOT, "src", "lib", "site.ts"),
    path.join(ROOT, "src", "lib", "jobs", "ai-allowance.ts"),
    // The shared social card, painted on every link to a page without its
    // own image. Outside every walked root; listed for that reason.
    path.join(ROOT, "src", "lib", "og.tsx"),
  ];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
        out.push(full);
    }
  };
  for (const dir of roots) {
    // Only a PENDING root may be absent; any other missing root throws here,
    // so a renamed folder cannot quietly empty the walk.
    const pending = Object.keys(PENDING_COPY_ROOTS).some(
      (root) => path.join(ROOT, root) === dir,
    );
    if (pending && !existsSync(dir)) continue;
    if (statSync(dir).isDirectory()) walk(dir);
  }
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

/**
 * The tool-page content files — DERIVED from what the page consumes, not from
 * a directory listing: every `./<slug>` module `src/lib/tools/content/index.ts`
 * imports, keyed by slug. A file in that directory nobody imports is not on
 * any page (and `content.test.ts` fails it); an import is on a page by
 * construction, because the page reads the index through `page-copy.ts`.
 *
 * The honesty guards walk `src/lib/tools` recursively, so these files were in
 * their corpus the day they landed. This is how each guard PROVES it, rather
 * than trusting a recursive walk nobody asserted: a guard that asserts it
 * reads every entry of this map cannot quietly lose a content file to a
 * narrowed root, a renamed directory, or a list.
 */
export function toolContentFiles(): Map<string, string> {
  const dir = path.join(ROOT, "src", "lib", "tools", "content");
  const index = readFileSync(path.join(dir, "index.ts"), "utf8");
  const out = new Map<string, string>();
  for (const match of index.matchAll(/^import \w+ from "\.\/([^"]+)";$/gm)) {
    out.set(match[1]!, path.join(dir, `${match[1]!}.ts`));
  }
  return out;
}
