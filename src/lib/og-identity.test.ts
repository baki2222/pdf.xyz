// @vitest-environment node
/**
 * The brand mark exists in three places and the site is the only one that
 * counts.
 *
 * `logo.tsx` renders the identity a visitor actually sees: a square in the
 * ACCENT beside a mono wordmark. `src/app/icon.svg` is the browser tab, the
 * installed PWA tile and the Apple touch icon. `src/lib/og.tsx` is every
 * social preview and every Google rich result. The last two cannot import the
 * stylesheet or the component, so both restate the mark in literal hex.
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

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const CSS = read("src/app/globals.css");
const ICON = read("src/app/icon.svg");
const OG = read("src/lib/og.tsx");
const LOGO = read("src/components/layout/logo.tsx");

/**
 * A `--sf-*` value from the DARK block, which is the ground both the icon tile
 * and the social card sit on. Parsed with string operations rather than a
 * regular expression: the sibling guard's first version lost its escapes
 * through a shell and silently matched nothing.
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
 * A `--sf-*` value from the LIGHT block. The mark's ground is the light
 * scheme's ink — the same near-black the site sets type in — while the square
 * on top of it is the DARK scheme's accent, because that is the value tuned to
 * sit on ink. Reading each from the block it belongs to is the whole point: an
 * earlier version of this guard asked the dark block for `--sf-invert` and got
 * #e8edf1, the inverse of what the tile paints.
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

describe("the brand mark agrees with the site, not just with itself", () => {
  it("the palette parses (health check)", () => {
    // Without this, every assertion below could compare against nothing.
    expect(darkToken("accent")).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightToken("invert")).toMatch(/^#[0-9a-f]{6}$/);
    expect(darkToken("accent")).not.toBe(lightToken("invert"));
  });

  it("the favicon is drawn in the palette's ink and accent", () => {
    const icon = ICON.toLowerCase();
    expect(icon).toContain(lightToken("invert")); // the tile
    expect(icon).toContain(darkToken("accent")); // the square and trim ticks
  });

  it("the share cards are drawn in the same two values", () => {
    const og = OG.toLowerCase();
    expect(og).toContain(lightToken("invert"));
    expect(og).toContain(darkToken("accent"));
    // The card ground is the dark canvas, not an invented near-black.
    expect(og).toContain(darkToken("canvas"));
  });

  it("neither copy still carries the retired palette", () => {
    const offenders: string[] = [];
    for (const [label, source] of [
      ["src/app/icon.svg", ICON],
      ["src/lib/og.tsx", OG],
    ] as const) {
      for (const hex of RETIRED) {
        if (source.toLowerCase().includes(hex))
          offenders.push(label + ": " + hex);
      }
    }
    expect(
      offenders,
      "these surfaces still render the identity the header retired:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
    // Positive control through the same predicate.
    expect(RETIRED.some((hex) => ("fill=" + hex).includes(hex))).toBe(true);
  });

  it("the header's own mark is still the accent square this is derived from", () => {
    // If the header identity changes again, this guard must be revisited
    // rather than left asserting a relationship to something that moved.
    // Comment-stripped, because logo.tsx's own docblock NAMES the retired
    // mark ("a violet gradient rounded square") — the first version of this
    // assertion matched that sentence and failed on prose describing the very
    // thing it was checking was gone. A guard that reads comments is reading
    // the author, not the product.
    const logoCode = withoutComments(LOGO);
    expect(logoCode).toContain("bg-accent");
    expect(logoCode).not.toContain("gradient");
  });

  it("the document glyph is gone from both copies", () => {
    // The retired mark's tell was a page outline with a folded corner: two
    // path commands that only that drawing used.
    for (const [label, source] of [
      ["src/app/icon.svg", ICON],
      ["src/lib/og.tsx", OG],
    ] as const) {
      expect(source, label + " still draws the document glyph").not.toContain(
        "V186 A8 8",
      );
      expect(source, label + " still draws the document glyph").not.toContain(
        "M13 3v5h5",
      );
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
    expect(CARD.tile).toBe(lightToken("invert"));
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
      "tile",
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

  it("the lockup splits the wordmark the way the header does", () => {
    // logo.tsx: an accent square, `pdf` in the foreground, `.xyz` muted. The
    // card drew `.xyz` in the ACCENT for as long as it had a violet tile —
    // two independent inventions in one lockup.
    const logoCode = withoutComments(LOGO);
    expect(logoCode).toContain("bg-accent");
    expect(logoCode).toContain("text-muted");
    expect(logoCode).toContain("font-mono");

    const og = withoutComments(OG);
    expect(og).toContain("background: CARD.accent");
    expect(og).toContain("color: CARD.muted");
    expect(og).toContain('fontFamily: "Geist Mono"');
  });
});
