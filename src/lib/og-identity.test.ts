// @vitest-environment node
/**
 * The brand mark exists in three places and the site is the only one that
 * counts.
 *
 * `logo.tsx` renders the identity a visitor actually sees: since 2026-10-21
 * the brand pack's Folded P, a petrol P with a cyan corner fold that is the
 * first letter of the name. `src/app/icon.svg` is the browser tab.
 * `src/lib/og.tsx` is every social preview, the Apple touch icon and the PWA
 * icons. All of them draw from ONE module, `src/lib/brand.ts`, except
 * `icon.svg`, which cannot import and so restates it — and is held to it
 * below, element for element. The brand's ink, petrol and paper are the
 * site's own light tokens, and that is held too.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * They were kept in sync by a sentence. og.tsx said the mark was "kept in sync
 * with src/app/icon.svg … so every surface reads the same", and that sentence
 * was true — of those two files, and false of the product. The header had
 * retired the violet gradient tile and its document glyph (logo.tsx: "which is
 * to say: everyone's mark"), and both copies went on rendering it: measured
 * 2026-09-20, the tab icon and every share card were still #8b5cf6 → #6366f1 →
 * #3b82f6 on #060611 for a site whose own header square was the accent.
 *
 * Nothing was red. `e2e/smoke.spec.ts` asserts the card returns 200 with an
 * image content-type; `e2e/favicon.spec.ts` concedes the gap in its own
 * docblock. Two copies agreeing with each other is not agreement with the
 * site.
 *
 * So this binds them to the source of truth — the palette in globals.css —
 * and to each other, and refuses the retired palette outright.
 *
 * ── AND THAT WAS NOT ENOUGH ─────────────────────────────────────────────────
 *
 * The version of this file that said the above passed six of six, and was
 * mutation-proven in both directions, while the site's most-shared image went
 * on painting the violet tile. It read TWO FILES BY NAME, and the front card —
 * `src/app/opengraph-image.tsx`, 140 lines with its own fonts, its own palette
 * and its own hand-drawn mark — was not one of them. A right predicate over
 * the wrong corpus.
 *
 * Two things changed. The corpus at the bottom of this file is DISCOVERED from
 * Next's metadata-file convention and from the import graph, so a card cannot
 * be added without joining it. And `src/app/card-pixels.test.ts` renders the
 * cards and decodes the PNG, because no amount of care about WHICH source to
 * read can see a route that declined to use the source. The two are bridged: a
 * card discovered here that nothing renders there is a failure.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";
import { CARD } from "@/lib/og";
import {
  BRAND,
  LOGO_COLOURS,
  LOGO_GLYPHS,
  P_BODY,
  P_FOLD,
  logoSvg,
  tileSvg,
} from "@/lib/brand";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const CSS = read("src/app/globals.css");
const ICON = read("src/app/icon.svg");
const OG = read("src/lib/og.tsx");
const LOGO = read("src/components/layout/logo.tsx");
const BRAND_SOURCE = read("src/lib/brand.ts");

/**
 * A `--sf-*` value from the DARK block, which is the ground the social card
 * sits on. Parsed with string operations rather than a regular expression:
 * the sibling guard's first version lost its escapes through a shell and
 * silently matched nothing.
 */
function darkToken(name: string): string {
  const media = CSS.indexOf("@media (prefers-color-scheme: dark)");
  expect(media, "no dark-scheme block in globals.css").toBeGreaterThan(0);
  const prefix = "--sf-" + name + ":";
  const line = CSS.slice(media)
    .split(String.fromCharCode(10))
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith(prefix));
  expect(
    line,
    "--sf-" + name + " is not defined in the dark block",
  ).toBeTruthy();
  const value = line!
    .slice(prefix.length)
    .replace(";", "")
    .trim()
    .toLowerCase();
  expect(value.startsWith("#"), "--sf-" + name + " is " + value).toBe(true);
  return value;
}

/**
 * A `--sf-*` value from the LIGHT block, where the brand's ink, petrol and
 * paper live. Reading each token from the block it belongs to is the whole
 * point: an earlier version of this guard asked the dark block for
 * `--sf-invert` and got #e8edf1, the inverse of what it meant.
 */
function lightToken(name: string): string {
  const media = CSS.indexOf("@media (prefers-color-scheme: dark)");
  expect(media, "no dark-scheme block in globals.css").toBeGreaterThan(0);
  const prefix = "--sf-" + name + ":";
  const line = CSS.slice(0, media)
    .split(String.fromCharCode(10))
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith(prefix));
  expect(
    line,
    "--sf-" + name + " is not defined in the light block",
  ).toBeTruthy();
  const value = line!
    .slice(prefix.length)
    .replace(";", "")
    .trim()
    .toLowerCase();
  expect(value.startsWith("#"), "--sf-" + name + " is " + value).toBe(true);
  return value;
}

/** The palette the prepress redesign replaced, kept as an explicit corpus. */
const RETIRED = [
  "#8b5cf6",
  "#6366f1",
  "#3b82f6",
  "#a5b4fc",
  "#8ab4ff",
  "#060611",
  "#0b0b1e",
  "#2b1d6b",
  "#123a6b",
];

/**
 * Retired colours that `card-pixels.test.ts` deliberately does NOT look for.
 * Each sits within ~26 units of a colour the cards still paint, so the
 * antialiased edge of live text lands on them and a pixel ban cannot tell the
 * two apart. They are banned here, on the literal string, where there is no
 * blend to confuse it — and the bridge test below fails if that file stops
 * handing them over.
 */
const PIXEL_BLIND_SPOT = ["#94a3b8"];

/**
 * The drawings the identity has retired, by path commands only they used:
 * the violet tile's document glyph (twice), then the registration mark's trim
 * ticks — at 512 in `icon.svg` and at 32 in `og.tsx`. Each `shipped` line is
 * quoted from the file that shipped it, and the corpus test below proves
 * every pattern still catches its own excerpt.
 */
const RETIRED_DRAWINGS: { pattern: string; shipped: string }[] = [
  {
    pattern: "V186 A8 8",
    shipped: '<path d="M298 104 V186 A8 8 0 0 0 306 194 H388"/>',
  },
  { pattern: "M13 3v5h5", shipped: '<path d="M13 3v5h5"/>' },
  {
    pattern: "M104 104 H160",
    shipped: '<path d="M104 104 H160 M104 104 V160"/>',
  },
  { pattern: "M6.5 6.5 H10", shipped: '<path d="M6.5 6.5 H10 M6.5 6.5 V10"/>' },
];

/** `icon.svg` without its comment and the whitespace between its tags. */
function iconDrawing(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

/** What `tileSvg` draws inside its `<svg>`: the tile, the P and the fold. */
function tileBody(svg: string): string {
  return svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
}

/**
 * The header's logo, as code: it draws the brand module's P and lettering in
 * both schemes' colours, and nothing of the lockup before it. Run on the
 * shipped file AND on an excerpt of the retired one, so the predicate is
 * shown able to fail.
 */
function headerDrawsTheFoldedP(source: string): string[] {
  const code = withoutComments(source);
  const verdict: string[] = [];
  for (const needed of [
    'from "@/lib/brand"',
    "d={P_BODY}",
    "d={P_FOLD}",
    "LOGO_GLYPHS.map",
    "LOGO_COLOURS.light[role]",
    "LOGO_COLOURS.dark[role]",
  ]) {
    if (!code.includes(needed)) verdict.push("lacks " + needed);
  }
  // The previous lockup's tells. Spelt with "·" for the hyphen and restored
  // at runtime: Tailwind scans this file, and a class written whole here
  // would ship in the stylesheet.
  for (const retired of ["reg·square", "bg·accent", "font·mono", "gradient"]) {
    const word = retired.replace("·", "-");
    if (code.includes(word)) verdict.push("still has " + word);
  }
  return verdict;
}

describe("the brand mark agrees with the site, not just with itself", () => {
  it("the palette parses (health check)", () => {
    // Without this, every assertion below could compare against nothing.
    expect(darkToken("accent")).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightToken("accent")).toMatch(/^#[0-9a-f]{6}$/);
    expect(darkToken("accent")).not.toBe(lightToken("accent"));
  });

  it("the identity's ink, petrol and paper are the site's light tokens", () => {
    // The pack was drawn from the live site (its design notes say so), and
    // this is the binding that keeps that true: change the site's accent and
    // the logo's P is red here, not quietly a different blue.
    expect(BRAND.ink).toBe(lightToken("fg"));
    expect(BRAND.petrol).toBe(lightToken("accent"));
    expect(BRAND.paper).toBe(lightToken("canvas"));
    expect(LOGO_COLOURS.light.mark).toBe(lightToken("accent"));
    expect(LOGO_COLOURS.light.letters).toBe(lightToken("fg"));
  });

  it("icon.svg draws exactly what the brand module draws", () => {
    // Element for element, not "contains a colour": the favicon is the one
    // copy that cannot import, so it is compared to the module's own output.
    const drawn = iconDrawing(ICON);
    const body = tileBody(tileSvg("favicon"));
    expect(body.length, "tileSvg drew nothing").toBeGreaterThan(200);
    expect(body).toContain(P_BODY);
    expect(body).toContain(P_FOLD);
    expect(drawn).toContain(body);
    // Positive control through the same predicate: one colour changed in the
    // file is a failure, so the comparison can see a drift.
    expect(iconDrawing(ICON.replace(BRAND.cyan, "#000000"))).not.toContain(
      body,
    );
  });

  it("og.tsx draws the logo and the mark from the brand module", () => {
    const og = withoutComments(OG);
    expect(og).toContain('from "./brand"');
    expect(og).toContain('logoSvg("dark")');
    expect(og).toContain("tileSvg(kind)");
    // And what logoSvg returns is the whole signature: the P, its fold, and
    // every glyph of `df.xyz`, in the dark variant's colours.
    const svg = logoSvg("dark");
    expect(svg).toContain(P_BODY);
    expect(svg).toContain(P_FOLD);
    expect(LOGO_GLYPHS.length).toBe(5);
    for (const glyph of LOGO_GLYPHS) expect(svg).toContain(glyph.d);
    for (const colour of Object.values(LOGO_COLOURS.dark))
      expect(svg).toContain(colour);
  });

  it("no copy still carries the retired palette", () => {
    const offenders: string[] = [];
    for (const [label, source] of [
      ["src/app/icon.svg", ICON],
      ["src/lib/og.tsx", OG],
      ["src/lib/brand.ts", BRAND_SOURCE],
    ] as const) {
      for (const hex of RETIRED) {
        if (source.toLowerCase().includes(hex))
          offenders.push(label + ": " + hex);
      }
    }
    expect(
      offenders,
      "these surfaces still render an identity the header retired:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
    // Positive control through the same predicate.
    expect(RETIRED.some((hex) => ("fill=" + hex).includes(hex))).toBe(true);
  });

  it("the header draws the Folded P, from the brand module", () => {
    // WAS "the header's own mark is still the accent square this is derived
    // from": `bg-accent` present, no gradient. That comment said a changed
    // header identity meant revisiting this guard rather than leaving it
    // asserting a relationship to something that moved; on 2026-10-21 it
    // moved, to the brand pack's Folded P, and this is the revisit.
    expect(headerDrawsTheFoldedP(LOGO)).toEqual([]);
    // Positive control: the lockup this replaced, excerpted (hyphens as "·"),
    // fails the same predicate on both counts.
    const retired = [
      'import { ActivitySquare } from "./activity-square";',
      'const SQUARE = "reg·square bg·accent size-2.5";',
      '<span className="text-fg font·mono font-semibold">pdf</span>',
    ]
      .join(String.fromCharCode(10))
      .replaceAll("·", "-");
    const verdict = headerDrawsTheFoldedP(retired);
    expect(verdict).toContain("lacks d={P_BODY}");
    expect(verdict).toContain("still has bg-accent");
  });

  it("no retired drawing survives, and every pattern catches its own excerpt", () => {
    // Both directions (CLAUDE.md rule 1): a pattern nothing exercises is
    // decoration, so each must match the line it was written from.
    expect(
      RETIRED_DRAWINGS.filter((r) => !r.shipped.includes(r.pattern)),
    ).toEqual([]);
    for (const [label, source] of [
      ["src/app/icon.svg", ICON],
      ["src/lib/og.tsx", OG],
      ["src/lib/brand.ts", BRAND_SOURCE],
    ] as const) {
      for (const { pattern } of RETIRED_DRAWINGS) {
        expect(source, label + " still draws " + pattern).not.toContain(
          pattern,
        );
      }
    }
  });
});

/**
 * ── THE SET THIS GUARD ASKS ABOUT ───────────────────────────────────────────
 *
 * Everything above reads two files by name: `src/app/icon.svg` and
 * `src/lib/og.tsx`. Every assertion was true of both, and the site's most
 * shared image was not in the set. `src/app/opengraph-image.tsx` imported one
 * constant from the library and hand-drew the rest, so it inherited none of
 * the library's correctness and none of this file's scrutiny — a right command
 * over the wrong corpus, which is the most convincing way to be wrong.
 *
 * The corpus below is DISCOVERED, twice over and unioned:
 *
 *  1. Next.js's own metadata-file convention. A file named `opengraph-image`,
 *     `twitter-image`, `icon` or `apple-icon` under `src/app` IS a route
 *     because of its name — the framework depends on that, so a new card
 *     cannot exist without joining this set, and renaming one moves the guard
 *     with it.
 *  2. The import graph: anything under `src/app` that imports `@/lib/og`.
 *     Catches the two `manifest-icon-*.png` routes, which follow no naming
 *     convention at all.
 *
 * Neither derivation alone is complete, which is the point of taking both.
 */
const APP_DIR = path.join(ROOT, "src", "app");
const METADATA_BASENAMES = new Set([
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
  // A binary, and in the corpus BECAUSE it is one: on 2026-09-20 it was the
  // only surface still painting the retired mark in full, precisely because
  // no source guard can open it. It is excluded from the colour rules below
  // and bound instead to the test that decodes it.
  "favicon",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function cardSurfaces(): string[] {
  const found = new Set<string>();
  for (const full of walk(APP_DIR)) {
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    const base = path.basename(full);
    const stem = base.replace(/\.(tsx|ts|svg|ico)$/, "");
    const byConvention =
      stem !== base && METADATA_BASENAMES.has(stem) && !base.endsWith(".d.ts");
    const byImport =
      /\.(tsx|ts)$/.test(base) &&
      !base.includes(".test.") &&
      readFileSync(full, "utf8").includes('from "@/lib/og"');
    if (byConvention || byImport) found.add(rel);
  }
  return [...found].sort();
}

/**
 * Surfaces whose colours are not in their text: `icon.svg` IS a drawing (it
 * cannot import, so its literals are checked against the palette above), and
 * `favicon.ico` is a binary (checked by decoding, in `favicon-ico.test.ts`).
 */
const BINARY_OR_DRAWN = [".svg", ".ico"];

/** Colour written into a file rather than imported, in any syntax Satori takes. */
function colourLiterals(source: string): string[] {
  const code = withoutComments(source);
  const hits: string[] = [];
  hits.push(...(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []));
  for (const fn of ["rgb(", "rgba(", "hsl(", "hsla("]) {
    if (code.includes(fn)) hits.push(fn);
  }
  return hits;
}

describe("the corpus is every surface that carries the mark", () => {
  const surfaces = cardSurfaces();

  it("the walk found the app tree (health check)", () => {
    // `[] ⊆ X` is vacuously true, so a walk that quietly returned nothing
    // would report the strongest possible pass on every assertion below.
    // Both bounds, because a walk that gained the whole tree is just as blind.
    expect(surfaces.length, surfaces.join("\n")).toBeGreaterThanOrEqual(8);
    expect(surfaces.length, surfaces.join("\n")).toBeLessThan(40);

    // Not the corpus — proof the walk can see. These three are the surfaces
    // the defect was found in, and if one stops being discovered, the
    // derivation broke rather than the files.
    expect(surfaces).toContain("src/app/opengraph-image.tsx");
    expect(surfaces).toContain("src/app/icon.svg");
    expect(surfaces).toContain("src/app/manifest-icon-512.png/route.ts");

    // Positive control THROUGH the discovery predicate, not beside it.
    expect(METADATA_BASENAMES.has("opengraph-image")).toBe(true);
    expect(METADATA_BASENAMES.has("page")).toBe(false);
  });

  it("no route writes a colour of its own", () => {
    const offenders: string[] = [];
    for (const rel of surfaces) {
      // `icon.svg` is a drawing, not a module: it cannot import, so its
      // literals are checked against the palette instead, above.
      if (BINARY_OR_DRAWN.some((ext) => rel.endsWith(ext))) continue;
      const literals = colourLiterals(
        readFileSync(path.join(ROOT, rel), "utf8"),
      );
      if (literals.length) offenders.push(rel + ": " + literals.join(" "));
    }
    expect(
      offenders,
      "a card route restating colour is how the front page kept the retired " +
        "mark for months — take it from CARD or from processing.ts:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the literal detector can actually see one (positive control)", () => {
    expect(colourLiterals('const a = "#8b5cf6";')).toContain("#8b5cf6");
    expect(colourLiterals("const a = rgba(1,2,3,0.4);")).toContain("rgba(");
    // And does not fire on a docblock naming the colour it replaced, which is
    // what every file above now contains.
    expect(colourLiterals("/** was #8b5cf6, a violet tile */")).toEqual([]);
  });

  it("no surface still carries the retired palette", () => {
    const offenders: string[] = [];
    for (const rel of surfaces) {
      const code = withoutComments(
        readFileSync(path.join(ROOT, rel), "utf8"),
      ).toLowerCase();
      for (const hex of [...RETIRED, ...PIXEL_BLIND_SPOT]) {
        if (code.includes(hex)) offenders.push(rel + ": " + hex);
      }
    }
    expect(offenders, offenders.join("\n  ")).toEqual([]);
  });

  it("every card the reader receives is rendered by the pixel guard", () => {
    // The bridge. This file proves a route holds no bad colour; it cannot
    // prove the route paints a good one. `card-pixels.test.ts` renders and
    // decodes, and this is what stops a new card from being added to the app
    // and to nothing else.
    const pixelGuard = read("src/app/card-pixels.test.ts");
    const missing = surfaces
      .filter((rel) => path.basename(rel).startsWith("opengraph-image"))
      .map((rel) => "./" + rel.replace("src/app/", "").replace(/\.tsx$/, ""))
      .filter((specifier) => !pixelGuard.includes('"' + specifier + '"'));
    expect(
      missing,
      "these cards are rendered by nothing that looks at the result:\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("every binary surface is bound to a test that decodes it", () => {
    // The colour rules above SKIP these, so without this they would be in the
    // corpus and exempt from all of it — a membership that proves nothing.
    // `favicon.ico` was exactly that shape: present in the repo, excluded from
    // every guard by being a file type no guard could read, and wrong.
    const decoders = [
      "src/app/favicon-ico.test.ts",
      "src/app/card-pixels.test.ts",
    ]
      .map((rel) => read(rel))
      .join(String.fromCharCode(10));

    const binaries = surfaces.filter((rel) =>
      BINARY_OR_DRAWN.some((ext) => rel.endsWith(ext)),
    );
    expect(binaries.length, "no binary surfaces discovered").toBeGreaterThan(0);

    const unread = binaries.filter(
      (rel) => !decoders.includes(path.basename(rel)),
    );
    expect(
      unread,
      "these surfaces are in the corpus and exempt from every rule in it: " +
        unread.join(", "),
    ).toEqual([]);
  });

  it("the colours pixels cannot separate are banned here instead", () => {
    // `card-pixels.test.ts` hands these over by name: they sit close enough to
    // a live colour that antialiasing crosses them, so it cannot tell a
    // retired hex from a blend. Here the match is on the literal string.
    const pixelGuard = read("src/app/card-pixels.test.ts");
    expect(pixelGuard).toContain("RETIRED_TOO_CLOSE_TO_SEPARATE");
    for (const hex of PIXEL_BLIND_SPOT) {
      expect(pixelGuard, hex + " is not the hex handed over").toContain(hex);
    }
  });
});

describe("the card palette is the site's palette", () => {
  it("every CARD value is a token from globals.css", () => {
    // Imported, not parsed. The values cannot be read from CSS at runtime —
    // Satori has no custom properties — so this is the only thing standing
    // between the stylesheet and five literal copies.
    expect(CARD.ground).toBe(darkToken("canvas"));
    expect(CARD.panel).toBe(darkToken("panel"));
    expect(CARD.fg).toBe(darkToken("fg"));
    expect(CARD.muted).toBe(darkToken("muted"));
    expect(CARD.faint).toBe(darkToken("faint"));
    expect(CARD.accent).toBe(darkToken("accent"));
    expect(CARD.ok).toBe(darkToken("ok"));
  });

  it("covers every token a card paints (health check)", () => {
    // A binding per key is only as complete as the key list, so the key set is
    // pinned too: adding a CARD value without binding it fails here.
    expect(Object.keys(CARD).sort()).toEqual([
      "accent",
      "faint",
      "fg",
      "ground",
      "muted",
      "ok",
      "panel",
    ]);
  });

  it("no card asks for a typeface nothing loads", () => {
    // Satori does not error on an unknown family — it silently falls back to
    // the first registered face. So when `loadCardFonts` moved from Inter to
    // Geist, three cards went on saying `fontFamily: "Inter"` and rendered
    // CORRECTLY, in Geist, by accident. Nothing was wrong on screen and every
    // pixel assertion passed; the only evidence was the source. This is the
    // shape a pixel guard cannot see, which is why both guards exist.
    const registered = new Set<string>();
    for (const match of OG.matchAll(/name: "([^"]+)"/g)) {
      if (match[1]) registered.add(match[1]);
    }
    expect(
      registered.size,
      "no font families registered at all",
    ).toBeGreaterThan(1);

    const offenders: string[] = [];
    for (const rel of cardSurfaces()) {
      if (BINARY_OR_DRAWN.some((ext) => rel.endsWith(ext))) continue;
      const code = withoutComments(readFileSync(path.join(ROOT, rel), "utf8"));
      for (const match of code.matchAll(/fontFamily: "([^"]+)"/g)) {
        const family = match[1] ?? "";
        if (!registered.has(family)) offenders.push(rel + ": " + family);
      }
    }
    expect(
      offenders,
      "these cards name a family `loadCardFonts` does not register: " +
        offenders.join(", "),
    ).toEqual([]);

    // Positive control: the family that was wrong for as long as it rendered.
    expect(registered.has("Inter")).toBe(false);
  });

  it("the card and the header split the logo's colours the same way", () => {
    // WAS "the lockup splits the wordmark the way the header does": an accent
    // square, `pdf` in the foreground, `.xyz` muted, on both. The card once
    // drew `.xyz` in the ACCENT — two inventions in one lockup — and the same
    // drift is possible now between the header's two schemes and the card's
    // one. The header paints each part `light-dark()` of the brand's two
    // variants by ROLE; the card is the dark variant by the same roles.
    expect(withoutComments(LOGO)).toContain("style={paint(glyph.role)}");
    const card = logoSvg("dark");
    for (const glyph of LOGO_GLYPHS) {
      // The glyph's own tag: from its `<path` to its `d`, and no further back.
      const at = card.indexOf(glyph.d);
      expect(at, "glyph at x " + glyph.x + " not drawn").toBeGreaterThan(0);
      const tag = card.slice(card.lastIndexOf("<path", at), at);
      expect(tag, glyph.role + " at x " + glyph.x).toContain(
        `fill="${LOGO_COLOURS.dark[glyph.role]}"`,
      );
    }
    // `df` and `.xyz` really are two colours in both variants, or the split
    // this test exists for is not there to keep.
    for (const scheme of ["light", "dark"] as const) {
      expect(LOGO_COLOURS[scheme].letters).not.toBe(
        LOGO_COLOURS[scheme].suffix,
      );
    }
  });
});
