// @vitest-environment node
/**
 * The design tokens, held to what they claim — computed from the stylesheet,
 * never restated here.
 *
 * The redesign's token table (spec B.2–B.4) arrived as a paragraph of numbers:
 * "fg 15.6, muted 7.2, faint 5.2, accent 6.8" on the selection tint, "≥ 13:1"
 * through the drop veil, a hero H1 of "40px @390 → 68px @1440" (now 48px
 * @390: the 40 it first said cost the H1 the phone LCP). A paragraph
 * cannot fail. Each of those becomes an assertion below against a bound this
 * file does not choose — WCAG's 4.5:1, the layout widths the pages are drawn
 * at — so a later palette tweak that breaks one is red here rather than true
 * in a comment and false on the screen (CLAUDE.md rule 3: a constant has no
 * relationships to constrain, so give it a second, independent bound).
 *
 * THE SET IS DERIVED. Scopes are found by walking the parsed stylesheet for
 * the four blocks every `--sf-*` token must live in (light and dark, paper and
 * ink); tokens are whatever those blocks declare. Nothing below names a hex.
 *
 * The radius tokens get a different kind of bound. Until 2026-10-09 they read
 * `ctl 6px · panel 0px` under a comment admitting ZERO call sites, while the
 * tree hard-coded 4px, 3px and 2px corners — a vocabulary describing a site
 * nobody had rendered. The rule now: a non-zero radius token must be a radius
 * the tree actually renders.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { compositeOver, contrastRatio, parseColor } from "@/lib/a11y/contrast";
import { parseCss, type CssBlock } from "@/lib/motion/contract";
import { toolFamilies } from "@/lib/tools/families";

const ROOT = process.cwd();
const CSS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function* walk(block: CssBlock): Generator<CssBlock> {
  yield block;
  for (const child of block.children) yield* walk(child);
}

const DARK = (p: string) =>
  p.startsWith("@media") && /prefers-color-scheme\s*:\s*dark/.test(p);

type ScopeName = "light paper" | "light ink" | "dark paper" | "dark ink";

/** The four theme scopes, each as `--sf-*` name → value. */
function scopes(css: string): Map<ScopeName, Map<string, string>> {
  const out = new Map<ScopeName, Map<string, string>>();
  for (const b of walk(parseCss(css))) {
    const selectors = b.prelude.split(",").map((s) => s.trim());
    const kind = selectors.includes(".theme-paper")
      ? "paper"
      : selectors.includes(".theme-ink")
        ? "ink"
        : null;
    if (!kind) continue;
    const scheme = b.ancestors.some(DARK) ? "dark" : "light";
    const name = `${scheme} ${kind}` as ScopeName;
    const tokens = out.get(name) ?? new Map<string, string>();
    for (const d of b.declarations)
      if (d.property.startsWith("--sf-")) tokens.set(d.property, d.value);
    out.set(name, tokens);
  }
  return out;
}

/** `var(--sf-x)` resolved inside its own scope, so a token may alias another. */
function resolve(tokens: Map<string, string>, value: string): string {
  const alias = /^var\((--sf-[\w-]+)\)$/.exec(value.trim());
  return alias ? resolve(tokens, tokens.get(alias[1]!) ?? "") : value;
}

function colour(tokens: Map<string, string>, name: string) {
  const raw = tokens.get(`--sf-${name}`);
  expect(raw, `--sf-${name} is not declared in this scope`).toBeTruthy();
  const parsed = parseColor(resolve(tokens, raw!));
  expect(parsed, `--sf-${name} (${raw}) is not a colour`).not.toBeNull();
  return parsed!;
}

const SCOPES = scopes(CSS);
const AA = 4.5;

describe("the four theme scopes", () => {
  it("health check: all four are found, each holding the base palette", () => {
    expect([...SCOPES.keys()].sort()).toEqual([
      "dark ink",
      "dark paper",
      "light ink",
      "light paper",
    ]);
    for (const [name, tokens] of SCOPES) {
      expect(tokens.size, `${name} declares too few tokens`).toBeGreaterThan(
        15,
      );
      // The parser really read values, not just names.
      expect(parseColor(tokens.get("--sf-fg") ?? "")).not.toBeNull();
    }
  });

  it("every scope declares the same tokens, so none silently inherits another scope's value", () => {
    // A token missing from ONE scope does not fail to render — it inherits
    // the enclosing scope's value, which is the wrong ground's colour.
    const names = [...SCOPES.values()].map((t) => [...t.keys()].sort());
    for (const set of names.slice(1)) expect(set).toEqual(names[0]);
  });

  it("positive control: a scope missing one token is told apart", () => {
    const fixture = CSS.replace(/\n\s*--sf-wash:[^;]*;/, "");
    const sets = [...scopes(fixture).values()].map((t) => t.size);
    expect(new Set(sets).size).toBeGreaterThan(1);
  });
});

describe("the selection tint (--sf-select) keeps every text role at AA", () => {
  const ROLES = ["fg", "muted", "faint", "accent"] as const;

  it.each([...SCOPES.keys()])("%s", (name) => {
    const tokens = SCOPES.get(name)!;
    const select = colour(tokens, "select");
    for (const role of ROLES) {
      const ratio = contrastRatio(colour(tokens, role), select);
      expect(ratio, `${role} on select in ${name}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("positive control: a tint as dark as the faint ink fails", () => {
    const tokens = new Map(SCOPES.get("light paper")!);
    tokens.set("--sf-select", tokens.get("--sf-faint")!);
    const select = colour(tokens, "select");
    expect(contrastRatio(colour(tokens, "faint"), select)).toBeLessThan(AA);
  });
});

describe("the drop veil (--sf-scrim) keeps its label legible over anything", () => {
  /**
   * The veil covers the whole page, so what sits beneath it is unknown: the
   * worst case is the extreme content colour, black or white, whichever
   * pulls the composite toward the label's own luminance. Spec B.2 claims
   * ≥ 13:1; the floor below is that claim, held.
   */
  const FLOOR = 13;
  const EXTREMES = ["#000000", "#ffffff"];

  it.each([...SCOPES.keys()])("%s", (name) => {
    const tokens = SCOPES.get(name)!;
    const scrim = colour(tokens, "scrim");
    expect(scrim.a, "a veil that is opaque hides the page").toBeLessThan(1);
    const fg = colour(tokens, "fg");
    for (const under of EXTREMES) {
      const ground = compositeOver(scrim, parseColor(under)!);
      expect(
        contrastRatio(fg, ground),
        `fg over the veil over ${under} in ${name}`,
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe("the display type steps land where the layouts are drawn", () => {
  /** `clamp(a rem, b rem + c vw, d rem)` at a viewport width, in px. */
  function clampAt(value: string, viewport: number): number {
    const m =
      /^clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)rem\s*\+\s*([\d.]+)vw\s*,\s*([\d.]+)rem\s*\)$/.exec(
        value,
      );
    expect(m, `not a rem/vw clamp: ${value}`).not.toBeNull();
    const [min, base, slope, max] = m!.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const preferred = base * 16 + (slope * viewport) / 100;
    return Math.min(Math.max(preferred, min * 16), max * 16);
  }

  const theme = [...walk(parseCss(CSS))].filter((b) =>
    b.prelude.startsWith("@theme"),
  );
  const token = (name: string) =>
    theme.flatMap((b) => b.declarations).find((d) => d.property === name)
      ?.value ?? "";

  // The phone and desktop widths every layout in the spec is drawn at.
  it.each([
    // 48 at 390, not the 40 the spec's table first drew: at 40px the hero
    // H1 lost the home page's LCP to its lede on every phone width (see
    // e2e/layout-stability.spec.ts, which measures it in a browser).
    ["--text-display-1", 48, 68],
    ["--text-display-2", 32, 48],
  ] as const)("%s: %ipx at 390, %ipx at 1440", (name, phone, desktop) => {
    expect(Math.round(clampAt(token(name), 390))).toBe(phone);
    expect(Math.round(clampAt(token(name), 1440))).toBe(desktop);
  });
});

describe("the radius vocabulary describes corners the tree renders", () => {
  const radii = [...walk(parseCss(CSS))]
    .filter((b) => b.prelude.startsWith("@theme"))
    .flatMap((b) => b.declarations)
    .filter((d) => d.property.startsWith("--radius-"))
    .map((d) => ({
      name: d.property.slice("--radius-".length),
      value: d.value,
    }));

  const shipped = (() => {
    const out: string[] = [];
    const visit = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (full !== path.join(ROOT, "src", "tests")) visit(full);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
          out.push(readFileSync(full, "utf8"));
      }
    };
    visit(path.join(ROOT, "src"));
    return out.join("\n");
  })();

  /** Call sites that render this corner: the token's own class or the literal. */
  const sites = (name: string, value: string) =>
    [
      ...shipped.matchAll(
        new RegExp(
          `(?<![\\w-])rounded(?:-[trblse]{1,2})?-(?:${name}|\\[${value.replace(".", "\\.")}\\])(?![\\w-])`,
          "g",
        ),
      ),
    ].length;

  it("health check: the vocabulary and the walk both exist", () => {
    expect(radii.length).toBeGreaterThanOrEqual(3);
    // 181 `rounded-[4px]` on 2026-10-09: a walk that lost the tree finds none.
    expect(sites("panel", "4px")).toBeGreaterThan(50);
  });

  it("every non-zero radius token is a corner some shipped source renders", () => {
    const unrendered = radii
      .filter((r) => !/^0(?:px)?$/.test(r.value))
      .filter((r) => sites(r.name, r.value) === 0)
      .map((r) => `--radius-${r.name}: ${r.value}`);
    expect(unrendered).toEqual([]);
  });

  it("positive control: the 6px control radius that shipped renders nowhere", () => {
    expect(sites("ctl-retired", "6px")).toBe(0);
  });
});

describe("an unavailable or busy primary button keeps its label at AA", () => {
  /**
   * `RunButton` stays on screen while it cannot run — before a file is
   * picked on Image to PDF and Compare PDF, and through EVERY run as
   * "Merging…", "Creating PDF…" — dimmed by the button's own opacity
   * utility. A busy label is information, not an inactive control, so it is
   * held to AA like any text. On 2026-10-11 the WP-08 gate's contrast audit
   * (`--all-tools`, light) measured "Create PDF" and "Compare PDFs" at
   * 4.498:1 there: `opacity-60` dims the ink ground until the label falls
   * through 4.5 on the white panel.
   *
   * Measured the way the audit measures it — the label's full colour over
   * the dimmed ground composited onto each ground a button sits on — which
   * is the stricter reading: the browser dims the label too, toward the
   * ground, which only lightens a light label. The opacity is read from the
   * shipped `buttonVariants()`, never restated.
   */
  const GROUNDS = ["canvas", "panel", "wash"] as const;
  const classes = buttonVariants();
  const dims = [
    ...classes.matchAll(/(?:^|\s)((?:aria-)?disabled):opacity-(\d+)(?=\s|$)/g),
  ];

  it("health check: the dimming is found, once per state, and the two agree", () => {
    expect(dims.map((m) => m[1]).sort()).toEqual(["aria-disabled", "disabled"]);
    expect(new Set(dims.map((m) => m[2])).size).toBe(1);
  });

  const opacity = Number(dims[0]?.[2]) / 100;
  const worst = (tokens: Map<string, string>, a: number) => {
    const button = colour(tokens, "invert");
    const label = colour(tokens, "fg-invert");
    return Math.min(
      ...GROUNDS.map((g) =>
        contrastRatio(
          label,
          compositeOver({ ...button, a }, colour(tokens, g)),
        ),
      ),
    );
  };

  it.each([...SCOPES.keys()])("%s", (name) => {
    expect(
      worst(SCOPES.get(name)!, opacity),
      `the dimmed primary's label in ${name}, at opacity ${opacity}`,
    ).toBeGreaterThanOrEqual(AA);
  });

  it("positive control: a button dimmed to half fails on the light panel", () => {
    expect(worst(SCOPES.get("light paper")!, 0.5)).toBeLessThan(AA);
  });
});

/*
 * The home page's category colours (review of PR #199, 2026-10-21: the pale
 * tinted tiles did not read as categories at a glance). Each family the
 * catalogue folds into a chip owns a solid tile token, `--sf-cat-<family>`,
 * and every tile draws its glyph in `--sf-cat-ink`. The family set is
 * DERIVED from `toolFamilies()`, so a new family without a token fails here
 * rather than rendering an empty tile.
 */
describe("every family's tile keeps its glyph at 3:1 (non-text), in every scope", () => {
  const families = toolFamilies().map((f) => f.id);
  const NON_TEXT = 3;

  it("health check: the families are the catalogue's, and each scope has their tokens", () => {
    expect(families.length).toBeGreaterThanOrEqual(6);
    for (const [name, tokens] of SCOPES)
      for (const id of families)
        expect(tokens.has(`--sf-cat-${id}`), `${name}: --sf-cat-${id}`).toBe(
          true,
        );
  });

  it.each([...SCOPES.keys()])("%s", (name) => {
    const tokens = SCOPES.get(name)!;
    const ink = colour(tokens, "cat-ink");
    for (const id of families) {
      const ratio = contrastRatio(ink, colour(tokens, `cat-${id}`));
      expect(ratio, `glyph on ${id} in ${name}`).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    }
  });

  it("no two families share a tile colour in a scope", () => {
    for (const [name, tokens] of SCOPES) {
      const values = families.map((id) => tokens.get(`--sf-cat-${id}`));
      expect(new Set(values).size, name).toBe(families.length);
    }
  });

  it("positive control: the brand cyan as a tile fails under a white glyph", () => {
    const tokens = new Map(SCOPES.get("light paper")!);
    tokens.set("--sf-cat-ink", "#ffffff");
    expect(
      contrastRatio(colour(tokens, "cat-ink"), colour(tokens, "mark")),
    ).toBeLessThan(NON_TEXT);
  });
});
