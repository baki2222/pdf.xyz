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
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

/** The operator docs: top-level `docs/*.md` — the docs-integrity surface. */
export function operatorDocs(): string[] {
  const dir = path.join(ROOT, "docs");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name));
}
