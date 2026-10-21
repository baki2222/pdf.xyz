// @vitest-environment node
/**
 * What the share cards actually paint.
 *
 * ── WHY PIXELS ──────────────────────────────────────────────────────────────
 *
 * On 2026-09-20 `src/lib/og-identity.test.ts` passed six of six, and was
 * mutation-proven in both directions, while `/opengraph-image` — the card
 * behind every link anyone has ever pasted to this site — served a violet
 * gradient tile with a document glyph, the mark `logo.tsx` retired months
 * earlier. The guard read `src/lib/og.tsx`. The route imported one constant
 * from it and hand-drew everything else. Every assertion was true and the
 * reader got the old brand.
 *
 * That is the house failure exactly: I checked the thing I had built, not the
 * thing a reader receives. A source guard cannot see a route that opted out of
 * the source, and no amount of care in choosing WHICH source to read fixes
 * that — the answer is to stop reading source. These tests render the routes
 * and decode the PNG, so a card can only pass by looking right.
 *
 * The companion source guard is still worth having: it is fast, it names the
 * file to fix, and it forbids the copy from coming back. It is no longer the
 * only thing standing between the brand and a reader.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import RootCard from "./opengraph-image";
import ToolCard from "./tools/[slug]/opengraph-image";
import ToolsIndexCard from "./tools/opengraph-image";
import WorkspaceCard from "./workspace/opengraph-image";
import { CARD, renderBrandMark } from "@/lib/og";
import { BRAND, LOGO_COLOURS } from "@/lib/brand";
import { getProcessingMeta } from "@/lib/tools/processing";
import {
  colourDistance,
  countNear,
  decodePng,
  hexToRgb,
  pixelAt,
  type DecodedPng,
  type Rgb,
} from "@/lib/png-probe";

async function render(response: ImageResponse): Promise<DecodedPng> {
  return decodePng(new Uint8Array(await response.arrayBuffer()));
}

/**
 * The palette the header retired, as a reader would see it: the three gradient
 * stops of the old tile, the indigo it set text in, and the near-black ground
 * it sat on. Not a word list — actual colours, so a card cannot evade it by
 * spelling a hex differently or building the gradient from a variable.
 */
const RETIRED = {
  "violet-500 (tile stop 1)": "#8b5cf6",
  "indigo-500 (tile stop 2)": "#6366f1",
  "blue-500 (tile stop 3)": "#3b82f6",
  "indigo-300 (eyebrow)": "#a5b4fc",
  "blue-300 (headline)": "#93c5fd",
} as const;

/**
 * NOT BANNED IN PIXEL SPACE, and the reason matters: slate-400 `#94a3b8` is 26
 * units from the live `CARD.muted` `#a8b3bd`, so the antialiased edge of every
 * muted word crosses it. Measured: 377 such pixels on the front card, 0 of
 * them slate. A ban that cannot separate the retired colour from the shipping
 * one is not evidence either way — it just fails loudly and gets deleted.
 *
 * The same is true of blue-300 `#93c5fd` against the accent. Both are still
 * banned by `og-identity.test.ts`, where the match is on the literal string
 * and there is no blend to confuse it. Pixels catch what source cannot see;
 * source catches what pixels cannot separate.
 */
const RETIRED_TOO_CLOSE_TO_SEPARATE = ["#94a3b8"] as const;

/**
 * The box the logo's P lands in: the Folded P, in the pack's dark-ground
 * colours, is the first letter of every card.
 *
 * A REGION, not a pixel. The logo is 56px tall at the 80px / 72px inset, so
 * the P occupies x 80-110, y 83-124 — measured 2026-10-21 on the front card
 * and the Merge PDF card alike: 775 pixels within 10 units of the dark mark
 * colour, and 42 of the fold's. The `d` beside it is white and the `.xyz`
 * dot, the only other mark-coloured shape, lands at x 186-196, outside.
 *
 * Bounded above as well as below, because `[] ⊆ X` runs in both directions:
 * "lots of mark colour up there" would pass for a card that had gone
 * entirely cyan.
 *
 * WAS the accent square of the previous lockup: 24px, x 80-104, y 86-110.
 */
const MARK_REGION = { x0: 60, y0: 70, x1: 140, y1: 130 } as const;
const MARK_P_PX = 775;
const MARK_FOLD_PX = 42;

function countNearInRegion(
  png: DecodedPng,
  target: Rgb,
  tolerance: number,
): number {
  let n = 0;
  for (let y = MARK_REGION.y0; y < MARK_REGION.y1; y += 1) {
    for (let x = MARK_REGION.x0; x < MARK_REGION.x1; x += 1) {
      if (colourDistance(pixelAt(png, x, y), target) <= tolerance) n += 1;
    }
  }
  return n;
}

describe("the decoder itself", () => {
  /**
   * A positive control, because every assertion below is only as good as this.
   * A decoder that returned zeros would make "no violet pixel" vacuously true
   * — the strongest possible pass from a blind instrument — and from outside,
   * a thin guard and a broken reader look identical.
   */
  it("reads back a colour it was given, through the same renderer", async () => {
    const png = await render(
      new ImageResponse(
        {
          type: "div",
          key: null,
          props: {
            style: {
              display: "flex",
              width: "100%",
              height: "100%",
              background: CARD.accent,
            },
          },
        },
        { width: 40, height: 40 },
      ),
    );

    expect(png.width).toBe(40);
    expect(png.height).toBe(40);
    expect(
      colourDistance(pixelAt(png, 20, 20), hexToRgb(CARD.accent)),
    ).toBeLessThan(3);
    expect(countNear(png, hexToRgb(CARD.accent), 3)).toBe(40 * 40);
  });

  it("refuses a buffer that is not a PNG rather than inventing pixels", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
      /not a PNG/,
    );
  });
});

/**
 * Every card, discovered nowhere — these four are named because a test has to
 * call something. The SET is guarded by `og-identity.test.ts`, which walks the
 * app tree for metadata routes and fails if one exists that is not rendered
 * here. Naming them here and deriving them there is the split that works: this
 * file needs the arguments each route takes, which a walk cannot supply.
 */
const CARDS: { name: string; render: () => Promise<DecodedPng> }[] = [
  { name: "/opengraph-image", render: async () => render(await RootCard()) },
  {
    name: "/tools/opengraph-image",
    render: async () => render(await ToolsIndexCard()),
  },
  {
    name: "/tools/merge-pdf/opengraph-image",
    render: async () =>
      render(
        await ToolCard({ params: Promise.resolve({ slug: "merge-pdf" }) }),
      ),
  },
  {
    name: "/workspace/opengraph-image",
    render: async () => render(await WorkspaceCard()),
  },
];

describe.each(CARDS)("$name", ({ render: renderCard }) => {
  it("is a 1200x630 card on the ink ground", async () => {
    const png = await renderCard();
    expect([png.width, png.height]).toEqual([1200, 630]);

    let total = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      total +=
        (png.data[i] ?? 0) + (png.data[i + 1] ?? 0) + (png.data[i + 2] ?? 0);
    }
    const meanChannel = total / (png.data.length / 4) / 3;
    expect(meanChannel, "card is not on a dark ground").toBeLessThan(70);
  });

  it("opens with the Folded P of the site's own logo", async () => {
    const png = await renderCard();
    const inP = countNearInRegion(png, hexToRgb(LOGO_COLOURS.dark.mark), 10);
    const inFold = countNearInRegion(png, hexToRgb(LOGO_COLOURS.dark.fold), 10);

    expect(inP, "no P where the logo starts").toBeGreaterThan(MARK_P_PX * 0.85);
    expect(
      inP,
      "more mark colour up there than the P can account for",
    ).toBeLessThan(MARK_P_PX * 1.2);
    // The fold is what makes it this P and not any P.
    expect(inFold, "the P has lost its fold").toBeGreaterThan(
      MARK_FOLD_PX * 0.7,
    );
    expect(inFold).toBeLessThan(MARK_FOLD_PX * 1.5);
  });

  it.each(Object.entries(RETIRED))(
    "paints no pixel of the retired %s",
    async (_name, hex) => {
      const png = await renderCard();
      expect(countNear(png, hexToRgb(hex), 12)).toBe(0);
    },
  );
});

describe("the square mark, as apple-icon and the PWA icons render it", () => {
  /**
   * `renderBrandMark` is the other renderer: `apple-icon.tsx` calls it at 180,
   * the two `manifest-icon-*.png` handlers at 192 and 512, and
   * `scripts/build-favicon.ts` at 16/32/48 (as the rounded tab tile).
   *
   * `favicon-ico.test.ts` decodes the COMMITTED bytes, which is the right
   * check for a file someone has to remember to rebuild — and it is the wrong
   * check for this. Change `renderBrandMark` to paint violet and those bytes
   * do not move: the committed favicon stays green while every icon the
   * browser generates on demand turns violet. The stale artifact would be the
   * thing vouching for the live one.
   */
  it.each([180, 512])(
    "at %i px is the white P and cyan fold on petrol, edge to edge",
    async (size) => {
      const png = await render(renderBrandMark(size));
      expect([png.width, png.height]).toEqual([size, size]);

      // Measured 2026-10-21 at 512: 226,107 petrol, 32,742 white, 2,016 cyan
      // pixels — the ground, the P and its fold. Floors well under those, as
      // fractions of the area, so 180 is held to the same proportions.
      const area = size * size;
      const petrol = countNear(png, hexToRgb(BRAND.petrol), 24);
      const white = countNear(png, hexToRgb(BRAND.white), 24);
      const cyan = countNear(png, hexToRgb(BRAND.cyan), 24);
      expect(petrol, "no petrol ground").toBeGreaterThan(area * 0.7);
      expect(white, "no white P").toBeGreaterThan(area * 0.08);
      expect(white, "more white than a P").toBeLessThan(area * 0.2);
      expect(cyan, "no cyan fold").toBeGreaterThan(area * 0.004);

      // An app icon is masked by the launcher, so its ground must reach the
      // corners: the rounded tab tile would leave them transparent.
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ] as const) {
        expect(
          colourDistance(pixelAt(png, x, y), hexToRgb(BRAND.petrol)),
          `corner ${x},${y}`,
        ).toBeLessThan(3);
      }

      // The previous mark: the dark accent square and ticks on an ink tile.
      expect(countNear(png, hexToRgb(CARD.accent), 12), "accent").toBe(0);
      expect(countNear(png, hexToRgb(BRAND.ink), 12), "ink tile").toBe(0);
      for (const [name, hex] of Object.entries(RETIRED)) {
        expect(countNear(png, hexToRgb(hex), 12), name).toBe(0);
      }
    },
  );

  it("the favicon tile leaves its corners transparent and keeps the P", async () => {
    const png = await render(renderBrandMark(128, "favicon"));
    expect(png.data[3], "top-left corner is painted").toBe(0);
    expect(countNear(png, hexToRgb(BRAND.white), 24)).toBeGreaterThan(
      128 * 128 * 0.12,
    );
    expect(countNear(png, hexToRgb(BRAND.cyan), 24)).toBeGreaterThan(20);
  });
});

describe("what pixels cannot decide", () => {
  it("hands its blind spot to the guard that can read strings", () => {
    // Not a decorative list. Each of these is a retired colour this file
    // REFUSES to look for, because it is close enough to a live one that the
    // antialiased edge of shipping text lands on it — and a constant nobody
    // reads is the shape of defect this repo keeps paying for. So the handover
    // is asserted: `og-identity.test.ts` must ban every one of them on the
    // literal string, and both tests fail if the other stops holding up its
    // half.
    const sourceGuard = readFileSync(
      path.join(process.cwd(), "src/lib/og-identity.test.ts"),
      "utf8",
    );
    expect(sourceGuard).toContain("PIXEL_BLIND_SPOT");
    for (const hex of RETIRED_TOO_CLOSE_TO_SEPARATE) {
      expect(sourceGuard, hex + " is banned nowhere").toContain(hex);
    }

    // And the reason, measured rather than asserted: each really is closer to
    // a live CARD value than the tolerance a pixel ban would need.
    for (const hex of RETIRED_TOO_CLOSE_TO_SEPARATE) {
      const nearest = Math.min(
        ...Object.values(CARD).map((live) =>
          colourDistance(hexToRgb(hex), hexToRgb(live)),
        ),
      );
      expect(
        nearest,
        hex + " is separable after all — ban it in pixels",
      ).toBeLessThan(30);
    }
  });
});

describe("/tools/merge-pdf/opengraph-image", () => {
  it("states where the tool runs in the same hue the site's dot uses", async () => {
    const png = await render(
      await ToolCard({ params: Promise.resolve({ slug: "merge-pdf" }) }),
    );
    const tone = getProcessingMeta("client").hue.card;

    // The chip text is the only place this colour appears on the card, so a
    // count above zero is the chip, and zero means the card stopped saying it.
    expect(countNear(png, hexToRgb(tone.text), 14)).toBeGreaterThan(200);
  });
});
