// @vitest-environment node
/**
 * A processing mode has ONE hue, and it is defined in `processing.ts`.
 *
 * That file's docblock once said a test failed "any other file that maps all
 * four modes to colours". No such test was ever committed: the sentence was a
 * guard nothing ran, in the one place no test could fail (CLAUDE.md, "a
 * comment is not a guard"). Its history is the reason the rule matters — the
 * mode's colour lived in THREE tables (a `tone` field nothing read, the
 * badge's own dot classes, and the share card's literal hexes), one of them
 * dead and still looking authoritative. The redesign adds a shape and a text
 * hue per mode (B.8), which is exactly when a fourth table gets written.
 *
 * Named `processing-hue-tables`, not `processing-hue`: that name is the
 * negative control `src/tests/test-references.test.ts` uses for "a test that
 * does not exist", and creating it would invert that control.
 *
 * THE PREDICATE, over every non-test source that ships (`src`, minus the
 * test helpers under `src/tests`): a file maps modes to colours when
 *   - one object literal has the keys `client`, `server`, `hybrid` and `ai`,
 *     or one `switch` has a `case` for each of the four, AND
 *   - that literal or switch contains a colour: a Tailwind palette or theme
 *     colour utility, a hex value, or an rgb/hsl/oklch() function.
 * KNOWN BOUND: a table keyed by fewer than four modes, or built at runtime
 * (`Object.fromEntries`, a lookup through another map), is not seen.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const MODES = ["client", "server", "hybrid", "ai"] as const;
const THE_TABLE = "src/lib/tools/processing.ts";

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const THEME =
  "black|white|canvas|panel|wash|invert|fg|fg-invert|muted|muted-invert|faint|line|line-strong|accent|mark|ok|warn|err|info|select|scrim";
const COLOUR = new RegExp(
  String.raw`(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|fill|stroke|from|via|to|outline|decoration|shadow|accent|caret|divide)-(?:(?:${PALETTE})-\d{2,3}|${THEME})(?:\/\d+)?(?![\w-])|#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(`,
);

interface ModeMap {
  line: number;
  kind: "object" | "switch";
  coloured: boolean;
}

/** Every four-mode object literal or switch in a source, and whether it holds a colour. */
function modeMaps(file: string, source: string): ModeMap[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: ModeMap[] = [];
  const has4 = (keys: Set<string>) => MODES.every((m) => keys.has(m));
  const visit = (node: ts.Node) => {
    let kind: ModeMap["kind"] | undefined;
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set(
        node.properties.flatMap((p) =>
          p.name &&
          (ts.isIdentifier(p.name) ||
            ts.isStringLiteral(p.name) ||
            ts.isNoSubstitutionTemplateLiteral(p.name))
            ? [p.name.text]
            : [],
        ),
      );
      if (has4(keys)) kind = "object";
    } else if (ts.isSwitchStatement(node)) {
      const cases = new Set(
        node.caseBlock.clauses.flatMap((c) =>
          ts.isCaseClause(c) && ts.isStringLiteralLike(c.expression)
            ? [c.expression.text]
            : [],
        ),
      );
      if (has4(cases)) kind = "switch";
    }
    if (kind) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        kind,
        coloured: COLOUR.test(node.getText(sf)),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function shippedSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(SRC, "tests")) walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name)
      )
        out.push(full);
    }
  };
  walk(SRC);
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

describe("a processing mode's hue is defined once", () => {
  const files = shippedSources();
  const found = files.flatMap((f) =>
    modeMaps(f, readFileSync(f, "utf8")).map((m) => ({ file: rel(f), ...m })),
  );

  it("health check: the walk is the whole tree, and the key detector sees four-mode tables", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
    // Three on 2026-10-09 (the hue table, the capability descriptor and the
    // processing split). A detector that went blind would find none, and the
    // assertion below would pass over an empty set.
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it("positive control: the real table is detected as a colour map", () => {
    expect(
      found.filter((m) => m.file === THE_TABLE && m.coloured),
    ).toHaveLength(1);
  });

  it("no other file maps the four modes to colours", () => {
    expect(
      found
        .filter((m) => m.coloured && m.file !== THE_TABLE)
        .map((m) => `${m.file}:${m.line} (${m.kind})`),
      `a second mode-to-colour table. Read the hue from processingMeta in ${THE_TABLE} instead`,
    ).toEqual([]);
  });

  it("positive control: a pasted hue map is caught as an object or a switch, in any colour spelling", () => {
    // Class names are ASSEMBLED, never written out: Tailwind scans test files
    // too, and a literal here would ship four unused colour utilities in the
    // site's stylesheet (it did, until 2026-10-09).
    const cls = (...parts: string[]) => parts.join("-");
    const pasted = `
      export const DOTS = { client: "${cls("bg", "emerald", "500")}", server: "${cls("bg", "blue", "500")}", hybrid: "${cls("bg", "cyan", "500")}", ai: "${cls("bg", "violet", "500")}" };
      export const CARD = { "client": "#6ee7b7", "server": "#93c5fd", "hybrid": "#67e8f9", "ai": "#c4b5fd" };
      export function ink(mode: string) {
        switch (mode) {
          case "client": return "${cls("text", "ok")}";
          case "server": return "${cls("text", "info")}";
          case "hybrid": return "${cls("text", "accent")}";
          case "ai": return "${cls("text", "mark")}/80";
        }
      }
      export const LABELS = { client: "In-browser", server: "Secure worker", hybrid: "Hybrid", ai: "AI" };
      export const THREE = { client: "${cls("bg", "emerald", "500")}", server: "${cls("bg", "blue", "500")}", ai: "${cls("bg", "violet", "500")}" };`;
    expect(
      modeMaps("scratch.tsx", pasted).map((m) => `${m.kind}:${m.coloured}`),
    ).toEqual([
      "object:true",
      "object:true",
      "switch:true",
      // Words, not colours: a four-mode table is allowed when it holds none.
      "object:false",
      // THREE is the documented bound: fewer than four modes is not seen.
    ]);
  });
});
