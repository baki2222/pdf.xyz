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
import { beforeAll, describe, expect, it } from "vitest";
import {
  PENDING_COPY_ROOTS,
  copyFiles,
  definesAllowanceCopy,
  libSourceFiles,
  toolContentFiles,
  withoutComments,
} from "./copy-surface";
import { getAllToolSlugs } from "./index";
import { CAPABILITY_DESCRIPTORS } from "@/lib/jobs/capabilities";
import { AI_CEILING_REACHED_MESSAGE } from "@/lib/jobs/ai-spend-ceiling";
import { CROP_KEEPS_CONTENT } from "@/lib/pdf/crop-disclosure";
import { RATE_LIMITED_MESSAGE } from "@/lib/ratelimit/response";
import { MALWARE_DETECTED_ERROR } from "@/lib/workers/executor/executor";
import {
  ACCOUNT_CLAIMS,
  PERSONAL_CONDUCT_CLAIMS,
} from "@/tests/identity-claims";

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
      // Added 2026-10-09, when copy reach began discovering by content: page
      // copy beside engine code that the name-only predicate could not see.
      "src/lib/structured-data.ts",
      "src/lib/jobs/capabilities.ts",
      "src/lib/jobs/ocr.ts",
      "src/lib/jobs/pdf-security.ts",
      "src/lib/pdf/crop-disclosure.ts",
      "src/lib/pdf/offered-kinds.ts",
      "src/lib/pdf/overlay.ts",
      "src/lib/workers/read-error.ts",
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

  it("reaches every intent module — the root guards itself by discovery", () => {
    // `src/lib/intent` holds the redesign's phrase code (answers, evidence,
    // hints). Dropping its root from copyFiles() must fail here, so the set
    // is read from disk rather than named, and bounded below so an empty or
    // renamed folder cannot pass vacuously.
    const reached = new Set(copyFiles().map(rel));
    const dir = path.join(process.cwd(), "src", "lib", "intent");
    const modules = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .map((f) => rel(path.join(dir, f)));
    expect(modules.length).toBeGreaterThanOrEqual(1);
    // Member control: the first module the root was created for.
    expect(modules).toContain("src/lib/intent/formats.ts");
    expect(modules.filter((f) => !reached.has(f))).toEqual([]);
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
 * COPY REACH: a file that holds words for a reader must be inside the walk,
 * wherever it lives — or be RECORDED outside it, with a reason, in a record
 * that can only shrink. Proven by DISCOVERY, not by naming files. Two
 * predicates, because copy reaches a page two ways.
 *
 * 1. JSX text. Every non-test `.tsx` under `src` with text between tags. All
 *    of them are reached today (the component and app roots cover them), so
 *    this one guards the next `.tsx` landing in a new folder.
 * 2. Phrase modules. A `.ts` or `.tsx` under `src/lib` that holds a SENTENCE
 *    — four or more words ending in `.`, `!`, `?` or `…` — in any string
 *    literal, template or JSX text, exported or not, whatever it is named.
 *    Second signal: an export whose NAME says it is copy (…Message, …Label,
 *    remedyFor, …) and whose value holds three or more words, which catches
 *    a table of short labels that has no full sentence in it.
 *
 * HISTORY, because predicate 2 was first written the other way round. On
 * 2026-10-09 it found its modules ONLY by the binding's name (eleven shapes),
 * and checked rule 1 in one direction: every shape caught something, but
 * nothing checked that every visitor sentence was caught by a shape. A review
 * found visitor copy it could not see — `CAPABILITY_DESCRIPTORS` ("Runs
 * entirely on your device…", served on /status), `CROP_KEEPS_CONTENT` (served
 * on the Crop page), `OVERLAY_LAYERS`, `OCR_OUTPUT_MODES`,
 * `PDF_ENCRYPTION_LEVELS`, the executor's `MALWARE_DETECTED_ERROR`, the
 * JSON-LD prose in `webApplicationSchema` — and proved the hole: a probe
 * module exporting `UPLOAD_ERROR = "Your files are uploaded to our servers and
 * kept for a year."` left every copy guard green; renamed `UPLOAD_MESSAGE`, it
 * went red. A test titled "every file that holds visitor-facing words is
 * walked" certified a property it did not check.
 *
 * Discovered by content, the set went from 28 modules to 233 (2026-10-09),
 * 171 of them outside the walk. Eight are page copy — option tables, a
 * disclosure, the JSON-LD, the panels' error reader — and are now walked
 * (listed in copyFiles()). The rest are RECORDED below by kind. Walking
 * all of them was measured the same day (over the 166 a first, letters-only
 * scan found): seven copy guards went red, every finding but one on engine
 * code or operator text the prose guards were not built for (a
 * `--no-sandbox` flag read as an isolation claim, a denial read as an
 * overclaim, operator figures and trailing comments read as claims). The one
 * true finding was the AI ceiling message's "your own allowance", fixed in
 * that message, and held there by `ai-spend-ceiling.test.ts`.
 *
 * A recorded module is not unread. Both identity ban lists (no-account and
 * no-personal-conduct, `src/tests/identity-claims.ts`) run over the string
 * literals of every one — literals only, so engine code and comments cannot
 * trip them.
 */
describe("copy reach: every file that holds words for a reader is walked, or recorded outside the walk with a reason", () => {
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

  describe("predicate 2: a src/lib module that holds a sentence, or a copy-named export that holds words", () => {
    /**
     * Every piece of text a module holds, as a reader would see it: string
     * literals; a `"a " + "b"` join of literals as ONE text (prettier writes
     * that split at 80 columns, and a phrase across it is still one phrase);
     * a template with each `${…}` filled by {@link HOLE}, so `${n} pages could
     * not be read.` is a sentence and `your ${n} free runs` reads as a count;
     * and JSX text. Comments are not literals, so they never count.
     */
    const HOLE = "0";
    const parse = (file: string, source: string) =>
      ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    function textsOf(root: ts.Node): string[] {
      const out: string[] = [];
      const joined = (n: ts.Node): string | null => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
          return n.text;
        if (ts.isParenthesizedExpression(n)) return joined(n.expression);
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
          const left = joined(n.left);
          const right = joined(n.right);
          return left !== null && right !== null ? left + right : null;
        }
        return null;
      };
      const visit = (n: ts.Node) => {
        if (ts.isJsxText(n)) {
          if (n.text.trim()) out.push(n.text.replace(/\s+/g, " ").trim());
          return;
        }
        if (ts.isTemplateExpression(n)) {
          out.push(
            n.head.text +
              n.templateSpans.map((s) => HOLE + s.literal.text).join(""),
          );
          for (const span of n.templateSpans) visit(span.expression);
          return;
        }
        const text = joined(n);
        if (text !== null) {
          out.push(text);
          return;
        }
        ts.forEachChild(n, visit);
      };
      visit(root);
      return out;
    }

    /** Four or more words, the last one ending a sentence. */
    const SENTENCE =
      /(?:[A-Za-z0-9][A-Za-z0-9’'-]*[ ,;:—–]+){3,}[A-Za-z0-9][A-Za-z0-9’'-]*[.!?…]/;

    /**
     * The SECOND signal: name shapes that mark an export as copy, for a table
     * of short labels with no full sentence in it. Each must be EXERCISED —
     * match a real export — or be FORWARD: named for a module the redesign
     * has planned, with the package that ships it. A forward shape that starts
     * matching shipped code must leave FORWARD.
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
    /** Three or more words: a phrase, not a key or a token. */
    const WORDS = /[A-Za-z]{2,}(?:[ ,]+[A-Za-z’']{2,}){2,}/;

    /** The copy-named exports of a source whose value holds words. */
    function copyNamedExports(sf: ts.SourceFile): string[] {
      const holdsWords = (node: ts.Node) =>
        textsOf(node).some((t) => WORDS.test(t));
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

    interface PhraseModule {
      file: string;
      /** Every text in the module (for the identity checks). */
      texts: string[];
      /** The texts that are sentences (the first signal). */
      sentences: string[];
      /** Copy-named exports holding words (the second signal). */
      names: string[];
    }

    function phraseModule(file: string, source: string): PhraseModule {
      const sf = parse(file, source);
      const all = textsOf(sf);
      return {
        file,
        texts: all,
        sentences: [...new Set(all.filter((t) => SENTENCE.test(t)))],
        names: copyNamedExports(sf),
      };
    }

    let cache: PhraseModule[] | undefined;
    const discovered = (): PhraseModule[] =>
      (cache ??= libSourceFiles()
        .map((f) => phraseModule(rel(f), readFileSync(f, "utf8")))
        .filter((m) => m.sentences.length > 0 || m.names.length > 0));

    // The walk parses every src/lib module (~0.6 s alone), and whichever test
    // calls discovered() first used to pay for it inside vitest's 5 s default:
    // the health check timed out in a parallel full run on 2026-10-09 once
    // WP-03 added src/lib/intent. The walk is setup, so it runs here, with an
    // explicit budget, before any test reads it — the same class as 2b20baa7.
    beforeAll(() => {
      discovered();
    }, 30_000);

    /**
     * Plausibility bounds, not measurements: 233 modules on 2026-10-09. The
     * floor catches a predicate gone blind (the old name-only predicate found
     * 28); the ceiling, a walk that swallowed a second checkout.
     */
    const DISCOVERED_FLOOR = 180;
    const DISCOVERED_CEILING = 600;

    // ── The record ────────────────────────────────────────────────────────
    const ENGINE =
      "engine, worker or client code: its sentences are what a tool reports (errors, refusals, result and capability notes), and walking the module puts its code and trailing comments in front of prose guards built for page copy";
    const AI_ENGINE =
      "an AI engine: its sentences are the model's instructions and the tool's error messages, and walking it puts that code in front of prose guards built for page copy";
    const OPERATIONS =
      "worker configuration, readiness, capability or operations-report text: the state the status and operations reports and the operator's checks are built from. The module is worker machinery, and walking it puts that code in front of prose guards built for page copy";
    const TOOLING =
      "operator tooling: usage, argument errors, probe verdicts and offline reports that a script under scripts/ prints to a terminal";
    const TEST_ONLY = "a test fixture or test double, imported only by tests";
    /** What walking the module did on 2026-10-09, where it did something. */
    const NUMBERS =
      "Walked (2026-10-09), numbers-honesty flags its operator figures and trailing unit comments";
    const CEILING_WIRING =
      "Walked (2026-10-09), ai-ceiling-surfaces requires it to be wired into the per-tool ceiling checks first";

    /** One reason for many files; a file named twice is an error, not an override. */
    function recordOf(
      ...groups: [reason: string, files: string[]][]
    ): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [reason, files] of groups)
        for (const file of files) {
          if (file in out) throw new Error(`recorded twice: ${file}`);
          out[file] = reason;
        }
      return out;
    }

    /**
     * Phrase modules outside the walk, each with its reason. A module may
     * leave (walked, or wordless: the stale check below) and may NOT join:
     * the size is pinned by {@link OUTSIDE_THE_WALK_CEILING}. Put new phrase
     * code in a walked root (`src/lib/intent`, `src/components`) or list the
     * file in copyFiles().
     */
    const OUTSIDE_THE_WALK: Record<string, string> = recordOf(
      [
        ENGINE,
        [
          "src/lib/jobs/ai-extract.ts",
          "src/lib/jobs/ai-no-text.ts",
          "src/lib/jobs/request-signatures.ts",
          "src/lib/jobs/responses.ts",
          "src/lib/jobs/summarize-pdf.ts",
          "src/lib/jobs/translate-pdf.ts",
          "src/lib/jobs/validation.ts",
          "src/lib/pdf/annotate.ts",
          "src/lib/pdf/compare-pdf.ts",
          "src/lib/pdf/create-forms.ts",
          "src/lib/pdf/crop.ts",
          "src/lib/pdf/edit.ts",
          "src/lib/pdf/encryption.ts",
          "src/lib/pdf/engine.ts",
          "src/lib/pdf/flatten.ts",
          "src/lib/pdf/font-packs.ts",
          "src/lib/pdf/gray-jpeg.ts",
          "src/lib/pdf/grayscale.ts",
          "src/lib/pdf/header-footer.ts",
          "src/lib/pdf/image-to-pdf.ts",
          "src/lib/pdf/pdf-to-image.ts",
          "src/lib/pdf/ranges.ts",
          "src/lib/pdf/redact.ts",
          "src/lib/pdf/render.ts",
          "src/lib/pdf/signature.ts",
          "src/lib/pdf/unicode-font.ts",
          "src/lib/pdf/watermark.ts",
          "src/lib/ratelimit/response.ts",
          "src/lib/text/decode-text-file.ts",
          "src/lib/uploads/intake/evaluate.ts",
          "src/lib/uploads/pick-check.ts",
          "src/lib/workers/ai/anthropic.ts",
          "src/lib/workers/ai/openai.ts",
          "src/lib/workers/ai/provider.ts",
          "src/lib/workers/ai/truncation.ts",
          "src/lib/workers/ai-tool-availability.ts",
          "src/lib/workers/artifacts/access.ts",
          "src/lib/workers/artifacts/delivery.ts",
          "src/lib/workers/compression/engine.ts",
          "src/lib/workers/compression/native.ts",
          "src/lib/workers/executor/executor.ts",
          "src/lib/workers/executor/s3-storage.ts",
          "src/lib/workers/html-render/unbundled-assets.ts",
          "src/lib/workers/html-render-client.ts",
          "src/lib/workers/job-polling.ts",
          "src/lib/workers/local-dev.ts",
          "src/lib/workers/ocr-client.ts",
          "src/lib/workers/ocr-engine-errors.ts",
          "src/lib/workers/ocr-native.ts",
          "src/lib/workers/office-conversion/engine.ts",
          "src/lib/workers/office-conversion/native.ts",
          "src/lib/workers/pdf-archive/engine.ts",
          "src/lib/workers/pdf-archive/native.ts",
          "src/lib/workers/pdf-office-export/engine.ts",
          "src/lib/workers/pdf-security/engine.ts",
          "src/lib/workers/pdf-security/native.ts",
          "src/lib/workers/pdf-security-client.ts",
          "src/lib/workers/pdf-structure/engine.ts",
          "src/lib/workers/pdf-structure/native.ts",
          "src/lib/workers/pdf-text/native.ts",
          "src/lib/workers/processor/ai-extract.ts",
          "src/lib/workers/processor/chat-with-pdf.ts",
          "src/lib/workers/processor/compression.ts",
          "src/lib/workers/processor/html-render.ts",
          "src/lib/workers/processor/ocr.ts",
          "src/lib/workers/processor/office-conversion.ts",
          "src/lib/workers/processor/pdf-archive.ts",
          "src/lib/workers/processor/pdf-office-export.ts",
          "src/lib/workers/processor/pdf-security.ts",
          "src/lib/workers/processor/pdf-structure.ts",
          "src/lib/workers/processor/request-signatures.ts",
          "src/lib/workers/processor/summarize.ts",
          "src/lib/workers/processor/table-extract.ts",
          "src/lib/workers/processor/translate.ts",
          "src/lib/workers/queue/local-dev.ts",
          "src/lib/workers/queue/redis.ts",
          "src/lib/workers/soundness/types.ts",
          "src/lib/workers/storage/s3.ts",
          "src/lib/workers/summarize-client.ts",
          "src/lib/workers/table-extract/engine.ts",
          "src/lib/workers/translate/chunking.ts",
        ],
      ],
      [
        `${ENGINE}. ${NUMBERS}`,
        ["src/lib/workers/artifacts/types.ts", "src/lib/workers/client.ts"],
      ],
      [
        `${ENGINE}. ${CEILING_WIRING}`,
        [
          "src/lib/jobs/chat-with-pdf.ts",
          "src/lib/workers/processor/read-cap-limit.ts",
        ],
      ],
      [
        `${ENGINE}. Walked (2026-10-09), pipeline-honesty reads Chromium's "--no-sandbox" launch flag as an isolation claim`,
        ["src/lib/workers/html-render/native.ts"],
      ],
      [
        `${ENGINE}. Walked (2026-10-09), scope-claims reads its denial (delivery "requires a configured e-signature provider") as an overclaim`,
        ["src/lib/workers/request-signatures/engine.ts"],
      ],
      [
        `${AI_ENGINE}. ${CEILING_WIRING}`,
        [
          "src/lib/workers/ai-extract/engine.ts",
          "src/lib/workers/chat-with-pdf/engine.ts",
          "src/lib/workers/summarize/engine.ts",
          "src/lib/workers/translate/engine.ts",
        ],
      ],
      [
        OPERATIONS,
        [
          "src/lib/ratelimit/config.ts",
          "src/lib/ratelimit/redis-config.ts",
          "src/lib/ratelimit/status.ts",
          "src/lib/workers/ai/readiness.ts",
          "src/lib/workers/artifacts/cleanup/run.ts",
          "src/lib/workers/artifacts/gate.ts",
          "src/lib/workers/cleanup/render.ts",
          "src/lib/workers/cleanup-evidence/types.ts",
          "src/lib/workers/compression/native-config.ts",
          "src/lib/workers/daemon/readiness.ts",
          "src/lib/workers/deploy/guardrails.ts",
          "src/lib/workers/deploy/readiness.ts",
          "src/lib/workers/heartbeat/factory.ts",
          "src/lib/workers/heartbeat/redis.ts",
          "src/lib/workers/heartbeat/schema.ts",
          "src/lib/workers/lifecycle/config.ts",
          "src/lib/workers/lifecycle/render.ts",
          "src/lib/workers/lifecycle/verify.ts",
          "src/lib/workers/observability/alerts.ts",
          "src/lib/workers/observability/slo.ts",
          "src/lib/workers/ocr.ts",
          "src/lib/workers/ops-bundle/types.ts",
          "src/lib/workers/pdf-security/capability.ts",
          "src/lib/workers/pdf-security/native-config.ts",
          "src/lib/workers/providers.ts",
          "src/lib/workers/queue/not-configured.ts",
          "src/lib/workers/queue/types.ts",
          "src/lib/workers/release-gate/types.ts",
          "src/lib/workers/scan/capability.ts",
          "src/lib/workers/scanner/clamav.ts",
          "src/lib/workers/scanner/types.ts",
          "src/lib/workers/soundness/gate.ts",
          "src/lib/workers/status.ts",
          "src/lib/workers/storage/not-configured.ts",
          "src/lib/workers/storage/types.ts",
        ],
      ],
      [
        `${OPERATIONS}. ${NUMBERS}`,
        [
          "src/lib/workers/ai/config.ts",
          "src/lib/workers/artifacts/cleanup/evaluate.ts",
          "src/lib/workers/artifacts/cleanup/inventory.ts",
          "src/lib/workers/lifecycle/policy.ts",
          "src/lib/workers/ocr-native-config.ts",
          "src/lib/workers/queue/redis-config.ts",
          "src/lib/workers/scanner/config.ts",
          "src/lib/workers/storage/s3-config.ts",
        ],
      ],
      [
        TOOLING,
        [
          "src/lib/probes/extraction-proof.ts",
          "src/lib/probes/origin-knock.ts",
          "src/lib/probes/proof-outcome.ts",
          "src/lib/probes/reservation-refusal.ts",
          "src/lib/workers/artifacts/cleanup/args.ts",
          "src/lib/workers/cleanup/args.ts",
          "src/lib/workers/cleanup/pipeline/run.ts",
          "src/lib/workers/cleanup/project/args.ts",
          "src/lib/workers/cleanup/verify.ts",
          "src/lib/workers/daemon/args.ts",
          "src/lib/workers/ops-bundle/args.ts",
          "src/lib/workers/ops-bundle/ingest.ts",
          "src/lib/workers/ops-bundle/render.ts",
          "src/lib/workers/ops-check/args.ts",
          "src/lib/workers/ops-check/ingest.ts",
          "src/lib/workers/ops-check/run.ts",
          "src/lib/workers/release-gate/args.ts",
          "src/lib/workers/release-gate/checks.ts",
          "src/lib/workers/release-gate/run.ts",
        ],
      ],
      [`${TOOLING}. ${NUMBERS}`, ["src/lib/workers/cleanup/pipeline/args.ts"]],
      [
        TEST_ONLY,
        [
          "src/lib/jobs/ai-tool-options.examples.ts",
          "src/lib/workers/scanner/fake.ts",
        ],
      ],
      [
        `${ENGINE}. Walked, pricing-honesty reads the dollar figures in its operator billing record ("monthly limit $100") as a price. Its visitor message is held to both identity ban lists by ai-spend-ceiling.test.ts`,
        ["src/lib/jobs/ai-spend-ceiling.ts"],
      ],
      [
        `${ENGINE}. Walked, pricing-honesty reads the number-format example "$4.20" as a price`,
        ["src/lib/jobs/pdf-office-export.ts"],
      ],
      [
        `${ENGINE}. Walked, ai-ceiling-surfaces requires its ceiling sentence to be wired into the per-tool checks first`,
        ["src/lib/jobs/translate-limits.ts"],
      ],
      [
        `${ENGINE}. Walked, account-honesty reads "pages behind a sign-in" (a third-party site's) as a sign-in invitation; the identity check below allows exactly that phrase`,
        ["src/lib/workers/html-render/engine.ts"],
      ],
      [
        "the operations snapshot's subsystem labels and proven-scope sentence, read on /status; the module is the worker's metrics engine",
        ["src/lib/workers/observability/snapshot.ts"],
      ],
      [
        "captured output of the native engines (qpdf, Ghostscript, LibreOffice), the corpus native-diagnostics.ts is run against: the engines' words, not ours",
        ["src/lib/workers/native-diagnostics.corpus.ts"],
      ],
      [
        'the SSRF guard\'s block-list range descriptions, read by a maintainer; discovered only because "incl." ends in a full stop',
        ["src/lib/net/public-address.ts"],
      ],
    );

    /**
     * The record's size, PINNED (2026-10-09, 163 — the day predicate 2 started
     * discovering by content and found the 163 recorded above). Lowering this
     * number is the only allowed edit: a module that leaves the record lowers
     * it, and a new phrase module goes into a walked root instead of joining.
     */
    const OUTSIDE_THE_WALK_CEILING = 163;

    /**
     * Identity language a recorded module may hold, each with the reason, as
     * an exact phrase in one module: anything else the ban lists find there
     * still fails.
     */
    const IDENTITY_ALLOWED: { file: string; phrase: string; why: string }[] = [
      {
        file: "src/lib/workers/html-render/engine.ts",
        phrase: "Pages behind a sign-in",
        why: "a third-party website's sign-in, explaining why its page could not be fetched; not an invitation to an account here",
      },
      {
        file: "src/lib/ratelimit/status.ts",
        phrase: "rather than per visitor.",
        why: "a denial on /status: in shared-bucket mode every caller counts against one budget, NOT per visitor — the honest statement of what the limiter cannot tell apart",
      },
      {
        file: "src/lib/workers/observability/snapshot.ts",
        phrase: "rather than per visitor.",
        why: "the same denial, in the operations snapshot's rate-limit detail",
      },
    ];

    it("health check: the predicate finds the phrase modules that exist", () => {
      const n = discovered().length;
      expect(n).toBeGreaterThanOrEqual(DISCOVERED_FLOOR);
      expect(n).toBeLessThanOrEqual(DISCOVERED_CEILING);
    });

    it("the other direction: every shipped visitor sentence in the corpus is discovered", () => {
      // Rule 1's missing half. Sentences a visitor is SHOWN, from modules
      // outside every walked root, read from the code (not retyped) where
      // they are exported. Each must be found in its own module's texts — a
      // predicate that misses one has a hole exactly that shape.
      const CORPUS: { file: string; sentence: string; how: string }[] = [
        {
          file: "src/lib/jobs/capabilities.ts",
          sentence: CAPABILITY_DESCRIPTORS["in-browser"].summary,
          how: "a field of an exported table, on /status and the tool pages",
        },
        {
          file: "src/lib/pdf/crop-disclosure.ts",
          sentence: CROP_KEEPS_CONTENT,
          how: "a template with an interpolation, on the Crop page",
        },
        {
          file: "src/lib/workers/executor/executor.ts",
          sentence: MALWARE_DETECTED_ERROR.message,
          how: "a field of an exported constant named …ERROR, outside every name shape",
        },
        {
          file: "src/lib/ratelimit/response.ts",
          sentence: RATE_LIMITED_MESSAGE,
          how: "the 429 body",
        },
        {
          file: "src/lib/jobs/ai-spend-ceiling.ts",
          sentence: AI_CEILING_REACHED_MESSAGE,
          how: "the 503 body when the AI ceiling is spent",
        },
        {
          file: "src/lib/workers/client.ts",
          sentence: "Could not start an upload session.",
          how: "an inline call argument in a module that exports no sentence",
        },
      ];
      /** Does a module text, holes and all, spell this value? */
      const spells = (text: string, value: string) => {
        if (text === value) return true;
        if (!text.includes(HOLE)) return false;
        let at = 0;
        for (const part of text.split(HOLE)) {
          const i = value.indexOf(part, at);
          if (i < 0) return false;
          at = i + part.length;
        }
        return true;
      };
      const byFile = new Map(discovered().map((m) => [m.file, m]));
      const missed = CORPUS.filter(
        ({ file, sentence }) =>
          !byFile.get(file)?.sentences.some((t) => spells(t, sentence)),
      ).map(({ file, how }) => `${file} (${how})`);
      expect(
        missed,
        "a sentence a visitor is shown was NOT discovered — the predicate has a hole of this shape",
      ).toEqual([]);
    });

    it("every phrase module is walked, or recorded outside with a reason", () => {
      const walked = new Set(copyFiles().map(rel));
      expect(
        discovered()
          .filter((m) => !walked.has(m.file) && !(m.file in OUTSIDE_THE_WALK))
          .map(
            (m) =>
              `${m.file}: ${[...m.names, ...m.sentences].slice(0, 2).join(" | ")}`,
          ),
        "these modules hold words for a reader and no copy guard reads them. Put phrase code in a walked root (src/lib/intent, src/components) or list the file in copyFiles() — with no trailing // comments in it",
      ).toEqual([]);
    });

    it("the outside record only shrinks: walked or wordless entries are stale, and its size is pinned", () => {
      const walked = new Set(copyFiles().map(rel));
      const found = new Set(discovered().map((m) => m.file));
      expect(
        Object.keys(OUTSIDE_THE_WALK).filter(
          (f) => walked.has(f) || !found.has(f),
        ),
        "these recorded modules are walked now, or hold no words — delete each entry and lower OUTSIDE_THE_WALK_CEILING",
      ).toEqual([]);
      expect(
        Object.keys(OUTSIDE_THE_WALK).length,
        "the outside record grew: put new phrase code in a walked root or list it in copyFiles(), never here",
      ).toBeLessThanOrEqual(OUTSIDE_THE_WALK_CEILING);
    });

    it("every recorded module's literals are free of identity claims (no account, no personal conduct)", () => {
      const recorded = discovered().filter((m) => m.file in OUTSIDE_THE_WALK);
      // Health check: the check reads the record, not an empty set.
      expect(recorded.length).toBe(Object.keys(OUTSIDE_THE_WALK).length);
      const lists = [
        ...ACCOUNT_CLAIMS.map(({ label, pattern }) => ({ label, pattern })),
        ...PERSONAL_CONDUCT_CLAIMS.map(({ name, pattern }) => ({
          label: name,
          pattern,
        })),
      ];
      const allowed = (file: string, text: string) =>
        IDENTITY_ALLOWED.some(
          (a) => a.file === file && text.includes(a.phrase),
        );
      const offenders: string[] = [];
      for (const m of recorded)
        for (const text of m.texts)
          for (const { label, pattern } of lists)
            if (pattern.test(text) && !allowed(m.file, text))
              offenders.push(`${m.file}: ${label} — "${text.slice(0, 160)}"`);
      expect(
        offenders,
        "a recorded module tells a reader something about who they are that the product cannot know",
      ).toEqual([]);
      // Each allowance still names a phrase that exists, or it is stale.
      expect(
        IDENTITY_ALLOWED.filter(
          (a) =>
            !recorded
              .find((m) => m.file === a.file)
              ?.texts.some((t) => t.includes(a.phrase)),
        ).map((a) => `${a.file}: "${a.phrase}"`),
      ).toEqual([]);
    });

    it("positive control: the identity check catches each list's shape in a recorded module's literal", () => {
      // Run through the same reader: a module text, not a bare string.
      const m = phraseModule(
        "fixture.ts",
        `export const A = "Sign in to keep your files for later.";
         export function b(n: number) { return \`You have used your \${n} free AI runs today.\`; }
         export const C = "Your files are uploaded " + "to your account overnight.";`,
      );
      const hits = (text: string) => [
        ...ACCOUNT_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
          ({ label }) => label,
        ),
        ...PERSONAL_CONDUCT_CLAIMS.filter(({ pattern }) =>
          pattern.test(text),
        ).map(({ name }) => name),
      ];
      expect(m.texts.flatMap(hits).sort()).toEqual(
        [
          "a sign-in invitation",
          "second person plus a spend verb — a claim about the reader's conduct",
          "a possessive over the allowance itself — whose runs these are",
          "a claim that the visitor has an account",
        ].sort(),
      );
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

    it("positive control: a sentence is found wherever it sits; keys, labels, classes and comments are not sentences", () => {
      const m = phraseModule(
        "fixture.ts",
        `// This sentence lives in a comment and is not copy.
         const NOT_EXPORTED = "This file could not be read as a PDF.";
         export function read() { throw new Error(NOT_EXPORTED); }
         export default { note: \`\${3} pages could not be read.\` };
         export const SPLIT = "Nothing was uploaded " + "and nothing was sent.";
         export const KEYS = ["in-browser", "secure-worker"];
         export const CLASSES = "text-sm font-medium text-muted underline";
         export const SHORT = "Run OCR first";`,
      );
      expect(m.sentences).toEqual([
        "This file could not be read as a PDF.",
        "0 pages could not be read.",
        "Nothing was uploaded and nothing was sent.",
      ]);
    });

    it("positive control: the name signal catches copy-named tables of short labels; keys, aliases and engines are not", () => {
      const caught = phraseModule(
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
      ).names;
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
