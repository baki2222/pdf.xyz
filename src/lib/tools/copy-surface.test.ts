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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  PENDING_COPY_ROOTS,
  copyFiles,
  definesAllowanceCopy,
  libSourceFiles,
  toolContentFiles,
  withoutComments,
} from "./copy-surface";
import { getAllToolSlugs } from "./index";

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
      // Added 2026-09-27: outside the walk until then, and each carries a
      // claim a visitor reads — the social card's in-browser chip, the
      // footer's "Privacy-first by architecture", the upload zone's caption.
      "src/lib/og.tsx",
      "src/components/layout/site-footer.tsx",
      "src/components/upload/upload-zone.tsx",
      // Added 2026-10-09: the workspace's tool suggestions ("JPG to PDF
      // handles both") are sentences a visitor reads beside their files, and
      // `src/lib/workspace` was the one copy-holding lib folder outside the
      // walk.
      "src/lib/workspace/suggestions.ts",
    ]) {
      expect(
        files,
        `the walk no longer reaches ${expected} — the guards are blind to it`,
      ).toContain(expected);
    }
  });

  it("reaches EVERY component file, so a new component folder cannot fall outside", () => {
    // Discovered, not listed: the walk used to take two of the component
    // folders (sections, tools) and miss layout, upload, status, legal and ui.
    const reached = new Set(copyFiles().map(rel));
    const components: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
          components.push(rel(full));
      }
    };
    walk(path.join(process.cwd(), "src", "components"));
    // Size floor: an empty directory read would make the check vacuous.
    expect(components.length).toBeGreaterThanOrEqual(60);
    // A member control: the drop zone's hand-off buttons, one of the files
    // the old two-folder walk missed.
    expect(components).toContain(
      "src/components/upload/staged-file-actions.tsx",
    );
    expect(components.filter((f) => !reached.has(f))).toEqual([]);
  });

  it("reaches every tool page's content file — the set the page consumes", () => {
    // The fifty authored content files (2026-09-27) sit under
    // `src/lib/tools/content/` and reach the walk by recursion. That is
    // asserted against the content INDEX, not the directory: the index is
    // what `page-copy.ts` hands the page, so a content file is on a page if
    // and only if it is in this set. The catalogue bounds its size, both ways.
    const content = toolContentFiles();
    expect([...content.keys()].sort()).toEqual(getAllToolSlugs().sort());
    const walked = new Set(copyFiles());
    expect(
      [...content.values()].filter((f) => !walked.has(f)).map(rel),
    ).toEqual([]);
  });

  it("positive control: the content derivation reads the index, not a guess", () => {
    // A derivation that returned nothing would make the test above pass
    // over an empty set; one that followed a type-only import would add a
    // module no page renders.
    const content = toolContentFiles();
    expect(rel(content.get("merge-pdf")!)).toBe(
      "src/lib/tools/content/merge-pdf.ts",
    );
    expect(content.has("types")).toBe(false);
    expect(content.has("index")).toBe(false);
  });

  it("never walks test files into the copy surface", () => {
    const tests = copyFiles().filter((f) => f.includes(".test."));
    expect(tests).toEqual([]);
  });

  it("is bounded both ways: the whole surface, and not a second checkout", () => {
    // 239 files on 2026-10-08, 245 with src/lib/workspace. The floor catches
    // a walk that quietly lost a root; the ceiling one that swallowed a
    // worktree or node_modules. Plausibility bounds, not measurements.
    const n = copyFiles().length;
    expect(n).toBeGreaterThanOrEqual(120);
    expect(n).toBeLessThanOrEqual(400);
  });

  it("a pending root is one that does not exist YET — stale entries fail", () => {
    // A pending root is walked from its first file without anyone
    // remembering to add it. Once it exists, the entry has done its job and
    // must go, or a typo'd root could hide behind it forever.
    const present = Object.keys(PENDING_COPY_ROOTS).filter((root) =>
      existsSync(path.join(process.cwd(), root)),
    );
    expect(
      present,
      "these pending roots exist now — move each into copyFiles()'s root list and delete its PENDING_COPY_ROOTS entry",
    ).toEqual([]);
  });
});

/**
 * COPY REACH: a file a visitor reads from must be inside the walk, wherever it
 * lives — proven by DISCOVERY, not by naming files. Two predicates, because
 * copy reaches a page two ways.
 *
 * 1. JSX text. Every non-test `.tsx` under `src` with text between tags. All
 *    of them are reached today (the component and app roots cover them), so
 *    this one guards the next `.tsx` landing in a new folder.
 * 2. Phrase modules. A `.ts` under `src/lib` that EXPORTS words for a reader:
 *    an exported binding whose name says it is copy (…Message, …Label, …Note,
 *    …Copy, …Answer, …Phrase, …Evidence, hintFor, …) and whose declaration
 *    holds a sentence. The redesign adds several (an origin phrase, evidence
 *    lines, remedy labels, hints), and the JSX predicate cannot see any of
 *    them: it passed vacuously over `.ts` (addendum, WP-01 item 7).
 *
 * Predicate 2, run for the first time on 2026-10-09, found 28 such modules —
 * and 24 of them OUTSIDE the walk: the engine and worker messages a visitor
 * reads in an error note. They are recorded below rather than walked, and the
 * record can only shrink. Walking them was measured the same day, as part of
 * a wider set (55 modules, from a looser first draft of this predicate): four
 * honesty checks failed. One finding was TRUE — "not on your file or your
 * account", on a product with no accounts, fixed in the message itself. The
 * rest were engine code the prose guards were not built for: "pages behind a
 * sign-in" (a third-party site's), an operator billing record and a "$4.20"
 * number-format example read as prices, and the translate ceiling sentence,
 * which ai-ceiling-surfaces wants wired into its per-tool checks first. (A
 * regex replacement token "$1" read as a price too, in a telemetry module
 * this tighter predicate does not select.)
 */
describe("copy reach: every file that holds visitor-facing words is walked", () => {
  const ROOT = process.cwd();
  const SRC = path.join(ROOT, "src");

  const walkSrc = (dir: string, keep: (f: string) => boolean): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkSrc(full, keep);
      return keep(full) ? [full] : [];
    });

  describe("predicate 1: a .tsx with JSX text", () => {
    const JSX_TEXT = /\>[^<>{}]*[A-Za-z]{3,}[^<>{}]*</;
    const hasJsxText = (source: string) =>
      JSX_TEXT.test(withoutComments(source));
    /**
     * Files with JSX text that are not copy, each with the reason. EMPTY on
     * 2026-10-09: the one .tsx outside every root, `src/tests/app-router.tsx`
     * (a test helper), renders no text, so the planned exemption for it would
     * have been stale on its first run.
     */
    const EXEMPT: Record<string, string> = {};
    const withText = () =>
      walkSrc(SRC, (f) => f.endsWith(".tsx") && !f.includes(".test.")).filter(
        (f) => hasJsxText(readFileSync(f, "utf8")),
      );

    it("health check: the predicate sees the components", () => {
      expect(withText().length).toBeGreaterThanOrEqual(60);
    });

    it("every one is walked, or exempt with a reason that is still true", () => {
      const walked = new Set(copyFiles().map(rel));
      const found = withText().map(rel);
      expect(
        found.filter((f) => !walked.has(f) && !(f in EXEMPT)),
        "these .tsx files render text a visitor reads and no copy guard reads them — move them under a walked root",
      ).toEqual([]);
      expect(
        Object.keys(EXEMPT).filter((f) => !found.includes(f)),
        "an exemption names a file with no JSX text (or no file) — delete it",
      ).toEqual([]);
    });

    it("positive control: text between tags is copy; an expression slot is not", () => {
      expect(
        hasJsxText("export const A = () => <p>Merge your files</p>;"),
      ).toBe(true);
      expect(
        hasJsxText(
          "// <p>Commented out</p>\nexport const B = ({ c }) => <div>{c}</div>;",
        ),
      ).toBe(false);
    });
  });

  describe("predicate 2: a src/lib module that exports words", () => {
    /**
     * The name shapes that mark a binding as copy. Each must be EXERCISED —
     * match a real export the predicate discovers — or be FORWARD: named for
     * a module the redesign has planned, with the package that ships it. A
     * forward shape that starts matching shipped code must leave FORWARD.
     */
    const SHAPES: { shape: RegExp; forward?: string }[] = [
      { shape: /messages?$/i },
      { shape: /labels?$/i },
      { shape: /notes?$/i },
      { shape: /hints?$/i },
      { shape: /copy$/i },
      { shape: /sentences?$/i },
      { shape: /answers?$/i },
      { shape: /phrases?$/i },
      { shape: /evidence$/i, forward: "WP-04 renderEvidence()" },
      { shape: /remed(?:y|ies)$/i, forward: "WP-08 remedy labels" },
      {
        shape: /^(?:hint|remedy|label|phrase)For(?:[A-Z]\w*)?$/,
        forward: "WP-08 remedyFor(), WP-11 hintFor()",
      },
    ];
    const isCopyName = (name: string) => SHAPES.some((s) => s.shape.test(name));
    /** A string with three or more words: a sentence, not a key or a token. */
    const WORDS = /[A-Za-z]{2,}(?:[ ,]+[A-Za-z’']{2,}){2,}/;

    /** The copy-shaped exports of a source that hold words. */
    function phraseExports(file: string, source: string): string[] {
      const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const holdsWords = (node: ts.Node): boolean => {
        let found = false;
        const visit = (n: ts.Node) => {
          if (found) return;
          if (
            (ts.isStringLiteral(n) ||
              ts.isNoSubstitutionTemplateLiteral(n) ||
              ts.isTemplateHead(n) ||
              ts.isTemplateMiddle(n) ||
              ts.isTemplateTail(n)) &&
            WORDS.test(n.text)
          )
            found = true;
          else ts.forEachChild(n, visit);
        };
        visit(node);
        return found;
      };
      const out: string[] = [];
      for (const st of sf.statements) {
        const exported =
          ts.canHaveModifiers(st) &&
          ts
            .getModifiers(st)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (!exported) continue;
        if (
          ts.isFunctionDeclaration(st) &&
          st.name &&
          isCopyName(st.name.text) &&
          holdsWords(st)
        )
          out.push(st.name.text);
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations)
            if (
              ts.isIdentifier(d.name) &&
              isCopyName(d.name.text) &&
              d.initializer &&
              holdsWords(d.initializer)
            )
              out.push(d.name.text);
      }
      return out;
    }

    const discovered = () =>
      libSourceFiles()
        .map((f) => ({
          file: rel(f),
          names: phraseExports(f, readFileSync(f, "utf8")),
        }))
        .filter((m) => m.names.length > 0);

    const ENGINE =
      "an engine or worker message a visitor reads in an error note; the module is engine code, and walking it puts that code in front of prose guards built for page copy (measured 2026-10-09)";
    /**
     * Phrase modules outside the walk on 2026-10-09, each with its reason.
     * This record may only SHRINK: an entry that is walked, or no longer
     * exports words, fails as stale. A new module may not join it without a
     * reason in the diff — put new phrase code in a walked root
     * (`src/lib/intent`, `src/components`) or list the file in copyFiles().
     */
    const OUTSIDE_THE_WALK: Record<string, string> = {
      "src/lib/jobs/ai-extract.ts": ENGINE,
      "src/lib/jobs/ai-no-text.ts": ENGINE,
      "src/lib/jobs/ai-spend-ceiling.ts": `${ENGINE}. Walked, pricing-honesty reads its operator billing record ("monthly limit $100") as a price.`,
      "src/lib/jobs/pdf-office-export.ts": `${ENGINE}. Walked, pricing-honesty reads the number-format example "$4.20" as a price.`,
      "src/lib/jobs/responses.ts": ENGINE,
      "src/lib/jobs/translate-limits.ts": `${ENGINE}. Walked, ai-ceiling-surfaces requires its ceiling sentence to be wired into the per-tool checks first.`,
      "src/lib/pdf/encryption.ts": ENGINE,
      "src/lib/pdf/engine.ts": ENGINE,
      "src/lib/pdf/flatten.ts": ENGINE,
      "src/lib/pdf/font-packs.ts": ENGINE,
      "src/lib/pdf/grayscale.ts": ENGINE,
      "src/lib/pdf/image-to-pdf.ts": ENGINE,
      "src/lib/pdf/pdf-to-image.ts": ENGINE,
      "src/lib/pdf/unicode-font.ts": ENGINE,
      "src/lib/ratelimit/response.ts": ENGINE,
      "src/lib/uploads/pick-check.ts": ENGINE,
      "src/lib/workers/ai/provider.ts": ENGINE,
      "src/lib/workers/html-render/engine.ts": `${ENGINE}. Walked, account-honesty reads "pages behind a sign-in" (a third-party site's) as a sign-in invitation.`,
      "src/lib/workers/html-render/unbundled-assets.ts": ENGINE,
      "src/lib/workers/observability/snapshot.ts":
        "the operations snapshot's subsystem labels and proven-scope sentence, read on /status; the module is the worker's metrics engine",
      "src/lib/workers/ocr-engine-errors.ts": ENGINE,
      "src/lib/workers/pdf-archive/engine.ts": ENGINE,
      "src/lib/workers/pdf-security/engine.ts": ENGINE,
      "src/lib/workers/translate/chunking.ts": ENGINE,
    };

    it("health check: the predicate finds the phrase modules that exist", () => {
      // 28 on 2026-10-09. An empty discovery would make the walk check below
      // pass vacuously; this floor is what stops that.
      expect(discovered().length).toBeGreaterThanOrEqual(20);
    });

    it("every phrase module is walked, or recorded outside with a reason", () => {
      const walked = new Set(copyFiles().map(rel));
      expect(
        discovered()
          .filter((m) => !walked.has(m.file) && !(m.file in OUTSIDE_THE_WALK))
          .map((m) => `${m.file}: ${m.names.join(", ")}`),
        "these modules export words a visitor reads and no copy guard reads them. Put phrase code in a walked root (src/lib/intent, src/components) or list the file in copyFiles() — with no trailing // comments in it",
      ).toEqual([]);
    });

    it("the outside record only shrinks: walked or wordless entries are stale", () => {
      const walked = new Set(copyFiles().map(rel));
      const found = new Set(discovered().map((m) => m.file));
      expect(
        Object.keys(OUTSIDE_THE_WALK).filter(
          (f) => walked.has(f) || !found.has(f),
        ),
      ).toEqual([]);
    });

    it("every name shape catches a shipped export, or is forward with its package", () => {
      const names = discovered().flatMap((m) => m.names);
      const idle = SHAPES.filter((s) => !names.some((n) => s.shape.test(n)));
      expect(
        idle.filter((s) => !s.forward).map((s) => String(s.shape)),
        "a shape that catches nothing shipped is decoration (CLAUDE.md rule 1)",
      ).toEqual([]);
      expect(
        SHAPES.filter((s) => s.forward && !idle.includes(s)).map((s) =>
          String(s.shape),
        ),
        "a forward shape now catches shipped code — drop its `forward` note",
      ).toEqual([]);
    });

    it("positive control: the planned phrase modules are caught; keys, aliases and engines are not", () => {
      const caught = phraseExports(
        "fixture.ts",
        `export function originPhrase(o: { kind: string }) {
           return o.kind === "drop" ? "Loaded the file you dropped" : "From your workspace";
         }
         export const REMEDY_LABELS = { encrypted: "Unlock the PDF first" };
         export const hintFor = (slug: string) => \`Rotate the pages in \${slug} first\`;
         export function renderEvidence() { return "No selectable text on pages 1–3"; }
         export const BOOL_LABELS = ["true", "false"];
         export const PDF_ERROR_MESSAGE = OTHER_MESSAGE;
         export function extractText(page: string) { return page.trim(); }
         const PRIVATE_NOTE = "not exported so not a module export";`,
      );
      expect(caught).toEqual([
        "originPhrase",
        "REMEDY_LABELS",
        "hintFor",
        "renderEvidence",
      ]);
    });
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
