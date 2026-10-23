// @vitest-environment node
/**
 * The palette exists in THREE copies, and only one of them is the source.
 *
 * `globals.css` defines it. Two other files must restate it in literal hex
 * because neither can read a stylesheet:
 *
 *   - `layout.tsx`'s `viewport.themeColor` — the phone browser's toolbar.
 *     It was the canvas, per scheme, until 2026-10-23; it is the brand
 *     petrol now (see "THE TOOLBAR IS THE BRAND" below);
 *   - `global-error.tsx` — the root error boundary replaces the layout that
 *     imports the stylesheet, so it inlines the whole palette to render at all.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Both copies were kept in sync by a COMMENT. `layout.tsx` says "These MUST
 * track --sf-canvas in globals.css"; `global-error.tsx` said its hexes were
 * "the same values as `.theme-paper` in globals.css". On 2026-09-20 the
 * prepress redesign changed every one of those values, and the error
 * boundary's eight hexes did not move — leaving the one page a user sees when
 * everything else has failed as the only surface still painting the retired
 * cream design, under a docblock that claimed it matched. Nothing was red.
 * `browser-count-surfaces` renders those components with `css: false`; the
 * bundle budget cannot see a colour; the contrast audit never visits
 * `global-error` because it cannot be crashed on demand.
 *
 * A comment is not a guard (CLAUDE.md rule 2). This is the guard: it parses
 * the values out of the stylesheet and asserts the copies equal them, per
 * scheme. Nothing here hard-codes a colour, so a future palette change moves
 * all three or fails here.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const CSS = read("src/app/globals.css");
const LAYOUT = read("src/app/layout.tsx");
const GLOBAL_ERROR = read("src/app/global-error.tsx");

/**
 * The light block is `:root, .theme-paper { … }` at top level; the dark one is
 * the same selector nested inside `@media (prefers-color-scheme: dark)`. Both
 * are located by their OPENING SELECTOR and read to the matching close, so a
 * reordered stylesheet moves the parser with it rather than silently matching
 * the wrong scope (`.theme-ink` sits between them and must never be read here).
 */
function paperBlock(scheme: "light" | "dark"): string {
  const media = CSS.indexOf("@media (prefers-color-scheme: dark)");
  expect(media, "no dark-scheme media block in globals.css").toBeGreaterThan(0);
  const region = scheme === "light" ? CSS.slice(0, media) : CSS.slice(media);
  const start = region.indexOf(".theme-paper {");
  expect(
    start,
    `no \`.theme-paper\` block in the ${scheme} region of globals.css`,
  ).toBeGreaterThan(-1);
  const end = region.indexOf("\n}", start);
  const nested = region.indexOf("\n  }", start);
  const close =
    end === -1 ? nested : nested === -1 ? end : Math.min(end, nested);
  expect(
    close,
    `unterminated \`.theme-paper\` block (${scheme})`,
  ).toBeGreaterThan(start);
  return region.slice(start, close);
}

function token(scheme: "light" | "dark", name: string): string {
  const block = paperBlock(scheme);
  // Parsed with string operations, not a regular expression, deliberately:
  // the first version of this helper was written through a shell heredoc and
  // its s escapes collapsed to plain `s` in the template literal, so the
  // pattern could never match and the guard reported the stylesheet as having
  // no tokens at all. An instrument that cannot see is worse than none.
  const prefix = `--sf-${name}:`;
  const line = block
    .split(String.fromCharCode(10))
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith(prefix));
  expect(
    line,
    `--sf-${name} is not defined in the ${scheme} .theme-paper block`,
  ).toBeTruthy();
  const value = line!
    .slice(prefix.length)
    .replace(";", "")
    .trim()
    .toLowerCase();
  expect(
    value.startsWith("#"),
    `--sf-${name} (${scheme}) is ${value}, which is not a hex literal`,
  ).toBe(true);
  return value;
}

/**
 * The brand petrol: the light scheme's accent. The one hex in this file is
 * the health check's, which proves the parser found the token the owner
 * named, not some other accent.
 */
const BRAND_PETROL = () => token("light", "accent");

/** Every `--sf-*` the two copies restate, so the set is not hand-picked twice. */
const MIRRORED = [
  "canvas",
  "fg",
  "muted",
  "faint",
  "invert",
  "fg-invert",
] as const;

describe("the palette's named copies agree", () => {
  it("the stylesheet really defines both schemes (health check)", () => {
    // `[] ⊆ X` is vacuously true: a parser that returned nothing would make
    // every assertion below pass while comparing empty sets.
    for (const scheme of ["light", "dark"] as const) {
      for (const name of MIRRORED) {
        expect(token(scheme, name)).toMatch(/^#[0-9a-f]{3,8}$/);
      }
    }
    // And the two schemes must actually differ, or the parser is reading one
    // block twice — which is exactly how this check would go blind.
    expect(token("light", "canvas")).not.toBe(token("dark", "canvas"));
  });

  /*
   * ── THE TOOLBAR IS THE BRAND ──────────────────────────────────────────────
   *
   * INVERTED 2026-10-23 (owner: "the mobile browser toolbar in the brand
   * petrol, #07567A, if it looks good"). This test pinned the toolbar to
   * `--sf-canvas` per scheme ("a mismatch reads as a flash of the previous
   * design on every rubber-band scroll" — the overscroll is painted from the
   * page's own background, not from theme-color, in the browsers that tint a
   * toolbar). It pins the new rule: the toolbar is the brand petrol, read
   * from the stylesheet as the light scheme's `--sf-accent`, in BOTH schemes —
   * chosen by screenshot against the dark page (the dark accent, #53c1ee, is
   * a light cyan that glares above a near-black page; the dark organize tile
   * read as a different, greyer brand). Nothing here types the hex.
   */
  it("layout.tsx's themeColor is the brand petrol, in both schemes", () => {
    const colorFor = (scheme: string): string => {
      const marker = `(prefers-color-scheme: ${scheme})`;
      const line = LAYOUT.split(String.fromCharCode(10)).find(
        (raw) => raw.includes(marker) && raw.includes("color:"),
      );
      expect(line, `no ${scheme} themeColor entry in layout.tsx`).toBeTruthy();
      const after = line!.slice(line!.indexOf("color:") + "color:".length);
      const open = after.indexOf(String.fromCharCode(34));
      const close = after.indexOf(String.fromCharCode(34), open + 1);
      return after.slice(open + 1, close).toLowerCase();
    };
    // Health: the brand token is the petrol, and it is not a canvas — a
    // parser that read the canvas twice would pass the old rule here.
    expect(BRAND_PETROL()).toBe("#07567a");
    expect(BRAND_PETROL()).not.toBe(token("light", "canvas"));
    expect(colorFor("light")).toBe(BRAND_PETROL());
    expect(colorFor("dark")).toBe(BRAND_PETROL());
  });
  it("global-error.tsx inlines the same values, per scheme", () => {
    // The file declares light `--ge-*` first, then overrides them inside its
    // own dark media query; splitting there gives the two scopes.
    const split = GLOBAL_ERROR.indexOf("prefers-color-scheme: dark");
    expect(split, "global-error.tsx declares no dark scheme").toBeGreaterThan(
      0,
    );
    const scopes = {
      light: GLOBAL_ERROR.slice(0, split),
      dark: GLOBAL_ERROR.slice(split),
    };

    const mismatched: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      for (const name of MIRRORED) {
        const prefix = `--ge-${name}:`;
        const line = scopes[scheme]
          .split(String.fromCharCode(10))
          .map((raw) => raw.trim())
          .find((raw) => raw.startsWith(prefix));
        expect(
          line,
          `global-error.tsx declares no --ge-${name} (${scheme})`,
        ).toBeTruthy();
        const inlined = line!
          .slice(prefix.length)
          .replace(";", "")
          .trim()
          .toLowerCase();
        const source = token(scheme, name);
        if (inlined !== source) {
          mismatched.push(
            `${scheme} --ge-${name}: ${inlined} ≠ globals.css --sf-${name}: ${source}`,
          );
        }
      }
    }
    expect(
      mismatched,
      "the root error boundary is painting a palette the stylesheet no longer defines:\n  " +
        mismatched.join("\n  "),
    ).toEqual([]);
  });

  it("no retired palette literal survives in either copy", () => {
    // The cream/ink values the prepress redesign replaced. Kept as an explicit
    // corpus so the check names what it is looking for; each was measured in
    // global-error.tsx on 2026-09-20 before the fix.
    const RETIRED = [
      "#f7f5f2",
      "#1c1917",
      "#57534e",
      "#6e6862",
      "#171412",
      "#ece7e1",
      "#b3aba2",
      "#9c948b",
    ];
    const offenders: string[] = [];
    for (const [label, source] of [
      ["layout.tsx", LAYOUT],
      ["global-error.tsx", GLOBAL_ERROR],
    ] as const) {
      for (const hex of RETIRED) {
        if (source.toLowerCase().includes(hex))
          offenders.push(`${label}: ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
    // Positive control, through the same predicate: the corpus can still match.
    expect(RETIRED.some((hex) => `background: ${hex};`.includes(hex))).toBe(
      true,
    );
  });
});

/**
 * ── THE FOURTH COPY ─────────────────────────────────────────────────────────
 *
 * Everything above names its copies: globals.css, layout.tsx, global-error.tsx.
 * "The palette's three copies agree" was true and there were four. Written
 * 2026-09-20; on the same day `src/app/manifest.ts` still declared
 * `background_color` and `theme_color` as `#060611`, the retired near-black,
 * so installing the PWA gave a splash screen in a colour the site paints
 * nowhere. A guard that enumerates its subjects cannot see the one it forgot.
 *
 * So this discovers them by the PROPERTY, not the path: any file under `src/`
 * that declares browser chrome — `themeColor`, `theme_color`,
 * `background_color` — has to agree with the stylesheet. A new surface joins
 * the corpus by doing the thing the corpus is about.
 *
 * Since 2026-10-23 the two kinds of chrome have two rules: a TOOLBAR
 * (`themeColor`, `theme_color` — the phone browser's bar, an installed app's
 * title bar) is the brand petrol; a BACKGROUND (`background_color`, the
 * installed app's splash) is the canvas. Until then all three were the canvas.
 */
const CHROME_KEYS = ["themeColor", "theme_color", "background_color"] as const;
const TOOLBAR_KEYS = new Set<string>(["themeColor", "theme_color"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test."))
      out.push(full);
  }
  return out;
}

/**
 * Every `#rrggbb` inside the VALUE of a chrome property.
 *
 * Scans to the end of the value expression rather than to the end of the line.
 * The line-based version of this function found `manifest.ts`, where the value
 * is a string on the same line, and MISSED `layout.tsx`, where `themeColor` is
 * an array of `{ media, color }` objects spanning four lines — so its health
 * check reported a corpus of one. A phrase search has a hole wherever the
 * source happens to wrap, and this file's whole subject is a value that lives
 * in more than one place.
 */
function declaredChromeColours(
  source: string,
  keys: readonly string[] = CHROME_KEYS,
): string[] {
  const code = withoutComments(source);
  const out: string[] = [];
  for (const key of keys) {
    let from = code.indexOf(key + ":");
    while (from !== -1) {
      let depth = 0;
      let end = from + key.length + 1;
      for (; end < code.length; end += 1) {
        const ch = code[end];
        if (ch === "[" || ch === "{" || ch === "(") depth += 1;
        else if (ch === "]" || ch === ")") depth -= 1;
        else if (ch === "}") {
          if (depth === 0) break;
          depth -= 1;
        } else if (ch === "," && depth === 0) break;
      }
      for (const hex of code.slice(from, end).match(/#[0-9a-fA-F]{6}\b/g) ?? [])
        out.push(hex);
      from = code.indexOf(key + ":", end);
    }
  }
  return out;
}

describe("browser chrome, wherever it is declared", () => {
  const declarers = sourceFiles(path.join(ROOT, "src"))
    .map((full) => {
      const source = readFileSync(full, "utf8");
      return {
        rel: path.relative(ROOT, full).split(path.sep).join("/"),
        colours: declaredChromeColours(source),
        toolbar: declaredChromeColours(
          source,
          CHROME_KEYS.filter((k) => TOOLBAR_KEYS.has(k)),
        ),
        background: declaredChromeColours(
          source,
          CHROME_KEYS.filter((k) => !TOOLBAR_KEYS.has(k)),
        ),
      };
    })
    .filter((file) => file.colours.length > 0);

  it("finds the files that declare it (health check)", () => {
    // Bounded both ways: zero declarers makes every assertion below vacuous,
    // and a walk that matched everything is just as blind as one that matched
    // nothing. These two are proof the discovery works, not the corpus.
    const names = declarers.map((file) => file.rel);
    expect(names, "chrome declarers found: " + names.join(", ")).toContain(
      "src/app/layout.tsx",
    );
    expect(names).toContain("src/app/manifest.ts");
    expect(declarers.length).toBeLessThan(10);

    // Positive control through the same predicate.
    expect(declaredChromeColours('theme_color: "#abcdef",')).toEqual([
      "#abcdef",
    ]);
    // The case the first version of this function could not see: the value is
    // an array and the colours are three lines below the key.
    expect(
      declaredChromeColours(
        [
          "themeColor: [",
          '  { media: "(prefers-color-scheme: light)", color: "#abcdef" },',
          '  { media: "(prefers-color-scheme: dark)", color: "#123456" },',
          "],",
        ].join(String.fromCharCode(10)),
      ),
    ).toEqual(["#abcdef", "#123456"]);
    expect(declaredChromeColours('someOther: "#abcdef",')).toEqual([]);
    expect(declaredChromeColours('// theme_color: "#abcdef",')).toEqual([]);
  });

  it("a toolbar declares the brand petrol; a background declares a canvas", () => {
    const canvases = new Set([
      token("light", "canvas"),
      token("dark", "canvas"),
    ]);
    // Health: both kinds are found, and the split lost no colour.
    expect(declarers.flatMap((f) => f.toolbar).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      declarers.flatMap((f) => f.background).length,
    ).toBeGreaterThanOrEqual(1);
    for (const file of declarers)
      expect(file.toolbar.length + file.background.length, file.rel).toBe(
        file.colours.length,
      );
    const offenders: string[] = [];
    for (const file of declarers) {
      for (const hex of file.toolbar)
        if (hex.toLowerCase() !== BRAND_PETROL())
          offenders.push(file.rel + " (toolbar): " + hex);
      for (const hex of file.background)
        if (!canvases.has(hex.toLowerCase()))
          offenders.push(file.rel + " (background): " + hex);
    }
    expect(
      offenders,
      "browser chrome off its rule (toolbar: the petrol; background: " +
        "`--sf-canvas`) — the PWA " +
        "manifest carried the retired #060611 this way: " +
        offenders.join(", "),
    ).toEqual([]);
  });
});
