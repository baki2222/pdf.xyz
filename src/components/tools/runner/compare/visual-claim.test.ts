import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  flattenForPhraseSearch,
  withoutComments,
} from "@/lib/tools/copy-surface";
import {
  CLEAN_CLAIM_STATE,
  NO_VISIBLE_DIFFERENCE,
  canClaimNoVisualDiff,
  noVisualDifferenceSentence,
  type ClaimState,
} from "./visual-claim";

/**
 * The Overlay's single gate (S3, 2026-11-15). The phrase "No differences
 * visible at this resolution" is the one sentence the overlay can say that
 * a reader takes as reassurance, so it has one definition, one gate, and
 * every state that must not reach it is a key the gate checks by name.
 */

const ROOT = process.cwd();
const COMPARE_DIR = path.join(ROOT, "src/components/tools/runner/compare");

/** Every key of ClaimState, typed: a key added to the interface fails here. */
const TYPED_KEYS = {
  pairsTotal: true,
  pairsChecked: true,
  unpaired: true,
  refused: true,
  failed: true,
  undecoded: true,
  blankWithText: true,
  sizeDiffers: true,
  shifted: true,
  withRegions: true,
  aborted: true,
} as const satisfies Record<keyof ClaimState, true>;

const CLAIM_KEYS = Object.keys(CLEAN_CLAIM_STATE) as (keyof ClaimState)[];

/** One BAD value per key: each is a state the overlay can actually reach. */
const BAD: { [K in keyof ClaimState]: ClaimState[K] } = {
  pairsTotal: 2, // a pair in scope that was not checked
  pairsChecked: 0, // a pair not drawn on both sides (missing capture, abort)
  unpaired: 2, // the files' page counts differ
  refused: "Page 1 of this PDF has more image data than one page can draw.",
  failed: 1, // a page failed to draw, or the browser ran out of memory
  undecoded: 1, // an image pdf.js could not decode
  blankWithText: 1, // both pages drew blank while their text layer has text
  sizeDiffers: 1, // the pages differ in size or orientation
  shifted: 1, // lined up by moving PDF 2's page
  withRegions: 1, // at least one differing region
  aborted: true, // the person pressed Stop
};

describe("canClaimNoVisualDiff", () => {
  it("positive control: the clean state opens the gate", () => {
    expect(canClaimNoVisualDiff(CLEAN_CLAIM_STATE)).toBe(true);
    expect(
      canClaimNoVisualDiff({
        ...CLEAN_CLAIM_STATE,
        pairsTotal: 40,
        pairsChecked: 40,
      }),
    ).toBe(true);
  });

  it("health: the keys enumerated are exactly ClaimState's eleven", () => {
    expect([...CLAIM_KEYS].sort()).toEqual(Object.keys(TYPED_KEYS).sort());
    expect(CLAIM_KEYS).toHaveLength(11);
    expect(Object.keys(BAD).sort()).toEqual([...CLAIM_KEYS].sort());
  });

  for (const key of Object.keys(TYPED_KEYS) as (keyof ClaimState)[])
    it(`a bad ${key} closes the gate`, () => {
      const state = { ...CLEAN_CLAIM_STATE, [key]: BAD[key] } as ClaimState;
      // Health: the bad value really differs from the clean one.
      expect(state[key]).not.toEqual(CLEAN_CLAIM_STATE[key]);
      expect(canClaimNoVisualDiff(state)).toBe(false);
      expect(noVisualDifferenceSentence(state, 150)).toBeNull();
    });

  it("nothing in scope is not 'nothing differs': pairsTotal 0 closes it", () => {
    expect(
      canClaimNoVisualDiff({
        ...CLEAN_CLAIM_STATE,
        pairsTotal: 0,
        pairsChecked: 0,
      }),
    ).toBe(false);
  });
});

describe("noVisualDifferenceSentence", () => {
  it("is null exactly when the gate is closed, and names the dpi used", () => {
    const states: ClaimState[] = [
      CLEAN_CLAIM_STATE,
      { ...CLEAN_CLAIM_STATE, pairsTotal: 12, pairsChecked: 12 },
      ...CLAIM_KEYS.map((k) => ({ ...CLEAN_CLAIM_STATE, [k]: BAD[k] })),
    ];
    for (const s of states)
      expect(noVisualDifferenceSentence(s, 150) === null).toBe(
        !canClaimNoVisualDiff(s),
      );
    expect(noVisualDifferenceSentence(CLEAN_CLAIM_STATE, 149.6)).toBe(
      `${NO_VISIBLE_DIFFERENCE} (about 150 dpi, in grayscale).`,
    );
    expect(
      noVisualDifferenceSentence(
        { ...CLEAN_CLAIM_STATE, pairsTotal: 12, pairsChecked: 12 },
        87.2,
      ),
    ).toBe(
      `${NO_VISIBLE_DIFFERENCE} on any of the 12 pages (about 87 dpi, in grayscale).`,
    );
  });
});

/* ------------------------------------------------------------------ *
 *  Where the phrase may be written, and what the overlay may never say
 * ------------------------------------------------------------------ */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name))
      out.push(full);
  }
  return out;
}

const PHRASE_RE = new RegExp(NO_VISIBLE_DIFFERENCE.replace(/ /g, "\\s+"), "gi");

function phraseCount(source: string): number {
  return [
    ...flattenForPhraseSearch(withoutComments(source)).matchAll(PHRASE_RE),
  ].length;
}

describe("the phrase has one site", () => {
  it("positive control: the counter counts a doubled, wrapped, split fixture as 2", () => {
    const fixture = `const a = "${NO_VISIBLE_DIFFERENCE}";\nconst b = "No differences visible " +\n  "at this\\nresolution";`;
    expect(phraseCount(fixture)).toBe(2);
    expect(phraseCount(`// ${NO_VISIBLE_DIFFERENCE}`)).toBe(0);
  });

  it("is written exactly once in src/components and src/lib, in visual-claim.ts", () => {
    const files = [
      ...walk(path.join(ROOT, "src/components")),
      ...walk(path.join(ROOT, "src/lib")),
    ];
    // Health: the walk saw the codebase, not a corner of it.
    expect(files.length).toBeGreaterThan(500);
    const sites = files.flatMap((f) => {
      const n = phraseCount(readFileSync(f, "utf8"));
      return n > 0 ? [`${path.relative(ROOT, f)}:${n}`] : [];
    });
    expect(sites).toEqual([
      path.join("src/components/tools/runner/compare/visual-claim.ts") + ":1",
    ]);
  });
});

/**
 * Sentences a reader would take as "nothing differs". The overlay says the
 * gated sentence or nothing of the kind.
 */
const OVERLAY_BANS: readonly RegExp[] = [
  /\bidentical\b/i,
  /\bno (?:visual )?differences?\b(?! visible at this resolution)/i,
  /\b(?:pages|they) match\b/i,
  /pixel[- ]for[- ]pixel/i,
];

/** Each ban's corpus: shipped-looking sentences it must catch. */
const MUST_CATCH = [
  "The pages are identical.",
  "No differences found.",
  "No visual differences.",
  "Pages match.",
  "They match pixel for pixel.",
];

/** Every string a module writes: literals, template text, JSX text. */
function stringsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      out.push(node.text);
    else if (ts.isTemplateExpression(node))
      out.push(
        node.head.text +
          node.templateSpans.map((s) => `…${s.literal.text}`).join(""),
      );
    else if (ts.isJsxText(node) && node.text.trim())
      out.push(node.text.replace(/\s+/g, " ").trim());
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The static VALUE imports of a module that resolve inside the compare dir. */
function compareValueImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (st.importClause?.isTypeOnly) continue;
    const spec = (st.moduleSpecifier as ts.StringLiteral).text;
    if (!spec.startsWith("./")) continue;
    const named = st.importClause?.namedBindings;
    if (
      named &&
      ts.isNamedImports(named) &&
      !st.importClause?.name &&
      named.elements.every((e) => e.isTypeOnly)
    )
      continue;
    for (const ext of [".ts", ".tsx"]) {
      const full = path.join(path.dirname(file), spec + ext);
      try {
        readFileSync(full);
        out.push(full);
        break;
      } catch {
        // try the next extension
      }
    }
  }
  return out;
}

/** compare-overlay.tsx and every compare-dir module it reaches by value. */
function overlayModules(): string[] {
  const start = path.join(COMPARE_DIR, "compare-overlay.tsx");
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of compareValueImports(queue.shift()!))
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return [...seen];
}

/** The strings of `CompareVisualRoute` (and its host) in compare-result.tsx. */
function visualRouteStrings(): string[] {
  const file = path.join(COMPARE_DIR, "compare-result.tsx");
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const wanted = new Set([
    "CompareVisualRoute",
    "CompareOverlayHost",
    "partlyScannedSentence",
  ]);
  const out: string[] = [];
  for (const st of sf.statements) {
    const name = ts.isFunctionDeclaration(st) ? st.name?.text : undefined;
    if (!name || !wanted.has(name)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        out.push(node.text);
      else if (ts.isTemplateExpression(node))
        out.push(
          node.head.text +
            node.templateSpans.map((s) => `…${s.literal.text}`).join(""),
        );
      else if (ts.isJsxText(node) && node.text.trim())
        out.push(node.text.replace(/\s+/g, " ").trim());
      ts.forEachChild(node, visit);
    };
    visit(st);
  }
  return out;
}

describe("what the overlay never says", () => {
  it("every ban catches a sentence of its corpus, and every corpus sentence is caught", () => {
    for (const re of OVERLAY_BANS)
      expect(
        MUST_CATCH.some((s) => re.test(s)),
        `${re} catches nothing`,
      ).toBe(true);
    for (const s of MUST_CATCH)
      expect(
        OVERLAY_BANS.some((re) => re.test(s)),
        `"${s}" walks past`,
      ).toBe(true);
    // The gated sentence itself is not a ban's catch.
    const sentence = noVisualDifferenceSentence(CLEAN_CLAIM_STATE, 150)!;
    expect(OVERLAY_BANS.some((re) => re.test(sentence))).toBe(false);
  });

  it("no string the overlay or its route writes is caught", () => {
    const modules = overlayModules();
    // Health: the walk reached the overlay's own modules.
    const names = modules.map((m) => path.basename(m));
    for (const want of [
      "compare-overlay.tsx",
      "visual-claim.ts",
      "visual-pairs.ts",
    ])
      expect(names).toContain(want);
    const strings = [
      ...modules.flatMap((m) => stringsOf(m)),
      ...visualRouteStrings(),
    ];
    expect(strings.length).toBeGreaterThan(40);
    // Health: the route's own button is among them.
    expect(strings).toContain("Compare pages visually");
    const caught = strings.filter((s) => OVERLAY_BANS.some((re) => re.test(s)));
    expect(caught).toEqual([]);
  });
});
