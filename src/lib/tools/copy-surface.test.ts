// @vitest-environment node
/**
 * The shared walk reaches the files it exists to read — proven, not assumed.
 *
 * The corpus-proof idiom from the docs census, applied to the copy surface:
 * the walk's reach is its load-bearing part, and it failed silently twice
 * (marketing-honesty missing site.ts; then tool-facts.ts — the file holding
 * every tool page's facts, FAQ answers, and steps — landing outside the walk
 * in the very change built to close that class). A future copy file landing
 * outside the walk must collapse loudly here, not sit silently unread by the
 * three guards that import this walk.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFiles,
  definesAllowanceCopy,
  libSourceFiles,
} from "./copy-surface";

const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/");

describe("the copy surface reaches what the guards must read", () => {
  it("includes the load-bearing copy sources", () => {
    const files = copyFiles().map((f) =>
      path.relative(process.cwd(), f).replace(/\\/g, "/"),
    );
    for (const expected of [
      "src/lib/tools/tool-facts.ts",
      "src/lib/tools/catalog.ts",
      "src/lib/tools/categories.ts",
      "src/lib/tools/processing.ts",
      "src/lib/faq.ts",
      "src/lib/site.ts",
      // The tool panels. Added 2026-08-11 after a copy census found ten
      // whole-document claims living here — including the sentence a visitor
      // reads directly above the file picker, while deciding whether to upload
      // a 300-page report. Three of the four guards that import this walk could
      // not see any of them.
      "src/components/tools/summarize-worker-panel.tsx",
      "src/components/tools/translate-worker-panel.tsx",
      "src/components/tools/chat-with-pdf-worker-panel.tsx",
      "src/components/tools/ai-extract-worker-panel.tsx",
      // The guides catalogue — added with the /guides section on 2026-09-17,
      // before its first article was written. It ships HowTo + FAQPage JSON-LD,
      // the channel the pricing and retention lies once travelled.
      "src/lib/guides/catalog.ts",
    ]) {
      expect(
        files,
        `the walk no longer reaches ${expected} — the guards are blind to it`,
      ).toContain(expected);
    }
  });

  it("reaches every component, wherever it lives", () => {
    // Derived, not named: the walk used to take two component directories,
    // and the drop zone's hand-off buttons (`components/upload`) and the
    // header and footer (`components/layout`) sat outside it — copy a visitor
    // reads, which no honesty guard read.
    const walked = new Set(copyFiles().map(rel));
    const components: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name) && !entry.name.includes(".test."))
          components.push(rel(full));
      }
    };
    walk(path.join(process.cwd(), "src", "components"));
    // Health check: a walk that found nothing passes the ⊆ below.
    expect(components.length).toBeGreaterThan(60);
    expect(components).toContain(
      "src/components/upload/staged-file-actions.tsx",
    );
    expect(components.filter((f) => !walked.has(f))).toEqual([]);
  });

  it("never walks test files into the copy surface", () => {
    const tests = copyFiles().filter((f) => f.includes(".test."));
    expect(tests).toEqual([]);
  });
});

/**
 * The named list above cannot see a file it does not name — which is how the
 * allowance sentence left the surface. Moving it to `src/lib/jobs/ai-allowance.ts`
 * kept `tool-facts.ts` in the walk (the test above still passed) while the WORDS
 * went somewhere no guard read: the same sentence in the new home produced 30
 * passed / 0 failed, and in the old home 6 failures.
 *
 * So this block does not name a file. It finds every place under `src/lib` that
 * defines an allowance sentence and requires the walk to reach it — a
 * relationship, so the next move collapses loudly wherever it lands.
 */
describe("the copy surface reaches allowance copy wherever it lives", () => {
  const defining = () =>
    libSourceFiles().filter((f) =>
      definesAllowanceCopy(readFileSync(f, "utf8")),
    );

  it("finds at least one definition, so a blind predicate cannot read as clean", () => {
    // The health check. `[] ⊆ walk` is vacuously true, so without this a
    // predicate that matched nothing would report the strongest possible pass.
    expect(
      defining().map(rel),
      "no file under src/lib defines an allowance sentence — the predicate has " +
        "gone blind, which is not the same as the tree being clean",
    ).not.toEqual([]);
  });

  it("requires the walk to read every one of them", () => {
    const walked = new Set(copyFiles());
    const unread = defining()
      .filter((f) => !walked.has(f))
      .map(rel);
    expect(
      unread,
      "these files define copy a visitor reads and the honesty guards cannot " +
        "see them. Add each to `copyFiles()` — and to `numbers-honesty`'s own " +
        "walk, which is deliberately a different surface.",
    ).toEqual([]);
  });

  it("tells a definition from a re-export, proven both ways", () => {
    // The positive control. `ratelimit/response.ts` and
    // `workers/ai-tool-availability.ts` both put this sentence in front of
    // users without holding the words; demanding the walk reach them would
    // pull two engine directories into a copy guard for nothing.
    expect(
      definesAllowanceCopy(
        "export const AI_ALLOWANCE_FACT = `${N} free AI runs a day`;",
      ),
    ).toBe(true);
    expect(
      definesAllowanceCopy('export const SOME_ALLOWANCE_NOTE = "text";'),
    ).toBe(true);
    expect(definesAllowanceCopy("export { AI_ALLOWANCE_FACT };")).toBe(false);
    expect(
      definesAllowanceCopy(
        "export const AI_DAILY_ALLOWANCE_NOTE = AI_ALLOWANCE_FACT;",
      ),
    ).toBe(false);
    expect(definesAllowanceCopy('export const UNRELATED = "text";')).toBe(
      false,
    );
  });
});
