import { readdirSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  DEFAULT_METADATA_ROUTE_EXTENSIONS,
  STATIC_METADATA_IMAGES,
} from "next/dist/lib/metadata/is-metadata-route";

/**
 * Icon routes, as a browser actually receives them.
 *
 * WHAT SHIPPED. `src/app/` had `icon.svg`, `apple-icon.tsx`, the two manifest
 * PNGs, `opengraph-image.tsx` and `twitter-image.tsx` — every icon shape except
 * the one nobody links to and every browser requests anyway. Measured against a
 * production build served by `next start`, before the fix:
 *
 *     /favicon.ico   404  text/html; charset=utf-8   45,008 bytes  <!DOCTYPE html><
 *     /icon.svg      200  image/svg+xml                 810 bytes
 *
 * Browsers and crawlers fetch `/favicon.ico` unprompted regardless of any
 * `<link rel=icon>`, so that was a guaranteed 404 and a 45 KB HTML error
 * document in every cold session. Production measured 46,057 bytes for the same
 * page. After: `200 image/x-icon 3,412 bytes`.
 *
 * WHY THIS IS AN E2E TEST AND NOT A UNIT TEST. The defect is not "the file is
 * missing" — it is "the ROUTE does not serve an icon", and those are different
 * propositions. `src/app/favicon.ico` existing on disk proves nothing about
 * what `GET /favicon.ico` returns: Next only wires the favicon convention from
 * the root segment, only for the `.ico` extension, and only as a static file
 * (no `favicon.tsx` — see the assertion on `STATIC_METADATA_IMAGES` below), so
 * there are several ways to have the file and still serve the 404. A test that
 * stats the file would have been green for a reader who still got HTML. This
 * suite runs against a real production build served by `next start`, so these
 * assertions read the bytes and the `Content-Type` on the wire.
 *
 * The `request` fixture rather than `page` is deliberate, for the same reason
 * `metadata.spec.ts` gives: a browser will happily paper over a bad icon
 * response, and most `/favicon.ico` consumers are not browsers.
 *
 * WHERE THE COMMITTED BYTES CAME FROM. `src/app/favicon.ico` is the SHARED
 * brand mark — `renderBrandMark` in `src/lib/og.tsx`, the same source
 * `apple-icon.tsx` and the two `manifest-icon-*.png` handlers use — rasterised
 * at 16, 32 and 48 px and packed as three PNGs in one ICO container. It is a
 * committed binary rather than a generated route because Next gives the favicon
 * convention no dynamic form (again: `extensions: ["ico"]`, and unlike every
 * other metadata image the page extensions are not appended).
 *
 * THE PARAGRAPH THAT USED TO END HERE said "nothing here can regenerate it …
 * if the brand mark changes, this file does not notice, and that is a known
 * gap rather than an oversight". Both halves were true and the second one was
 * the defect: the mark changed, and on 2026-09-20 these bytes were still the
 * retired violet tile — 1,783 indigo pixels and zero accent pixels at 48px —
 * while every other icon surface had moved. Writing the hole down is what made
 * it feel managed. A comment is not a guard.
 *
 * So `pnpm icon:favicon` (`scripts/build-favicon.ts`) now regenerates them
 * from `renderBrandMark`, and `src/app/favicon-ico.test.ts` decodes the
 * committed bytes and fails if they stop being the mark. This file keeps the
 * half it can see: that the route serves them, with the right type, at three
 * sizes, small.
 */

/**
 * The routes under test, DERIVED rather than typed.
 *
 * Two sources, unioned, because either alone has a hole:
 *
 *  - Next's own `STATIC_METADATA_IMAGES` contributes `/favicon.ico`. It has to
 *    come from the framework constant, not from the directory listing, because
 *    the state this test exists to catch is the file being ABSENT — a corpus
 *    derived only from `src/app/` cannot see a route whose file nobody wrote,
 *    and would have reported a serene pass over the exact defect that shipped.
 *  - `src/app/` itself contributes every other icon URL it serves, so an
 *    `icon.png` or a third manifest icon added tomorrow is covered without
 *    editing a list here. A named list cannot see a file it does not name.
 */
const APP_DIR = path.join(process.cwd(), "src", "app");

/** Every extension Next recognises as a static metadata image, from Next. */
const IMAGE_EXTENSIONS = new Set<string>(
  Object.values(STATIC_METADATA_IMAGES).flatMap((image) => [
    ...image.extensions,
  ]),
);

function faviconRoute(): string {
  const { filename, extensions } = STATIC_METADATA_IMAGES.favicon;
  // A link health check, not decoration. This whole file assumes the favicon
  // convention is "one static `.ico` at the app root" — that is what makes a
  // `favicon.tsx` route handler impossible and a committed binary the only
  // option. If a Next upgrade widens or renames it, fail HERE with something a
  // reader can act on, rather than silently testing a route Next stopped
  // serving.
  expect(
    [...extensions],
    "Next's favicon convention changed; revisit how src/app/favicon.ico is produced",
  ).toEqual(["ico"]);
  return `/${filename}.${extensions[0]}`;
}

/** File extensions Next accepts for a route handler, from Next. */
const ROUTE_EXTENSIONS = new Set(DEFAULT_METADATA_ROUTE_EXTENSIONS);

function hasRouteHandler(dir: string): boolean {
  return readdirSync(dir).some(
    (name) =>
      path.basename(name, path.extname(name)) === "route" &&
      ROUTE_EXTENSIONS.has(path.extname(name).slice(1)),
  );
}

/**
 * Image URLs served from the root of `src/app`, in BOTH shapes this repo uses.
 *
 * The first draft filtered on `entry.isFile()` and derived TWO routes where
 * there are four — `manifest-icon-192.png` and `manifest-icon-512.png` are not
 * files, they are DIRECTORIES holding a `route.ts` that renders the brand mark
 * (`/manifest-icon-192.png/route` in `.next/app-path-routes-manifest.json`).
 * The predicate was right and the set was wrong, which is the failure that
 * leaves no trace: it would simply have guarded two of the four icon routes
 * while reading as though it covered them all. The size bound below is what
 * caught it, so it stays.
 *
 * Deliberately NOT included: the extensionless dynamic metadata routes
 * (`/apple-icon`, `/opengraph-image`, `/twitter-image`, and the per-tool cards).
 * They are a different shape with their own coverage, and pretending this sweep
 * reaches them would be the more expensive mistake.
 */
function appRootImageRoutes(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(APP_DIR, { withFileTypes: true })) {
    if (
      !IMAGE_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase())
    ) {
      continue;
    }
    // A static metadata image (`icon.svg`), or a route handler whose directory
    // is named for the URL it serves (`manifest-icon-192.png/route.ts`). A bare
    // directory with no handler serves nothing, so it is not a route.
    if (
      entry.isFile() ||
      (entry.isDirectory() && hasRouteHandler(path.join(APP_DIR, entry.name)))
    ) {
      routes.push(`/${entry.name}`);
    }
  }
  return routes;
}

const ICON_ROUTES = [
  ...new Set([faviconRoute(), ...appRootImageRoutes()]),
].sort();

const PNG_MAGIC = "89504e470d0a1a0a";

type IcoImage = {
  width: number;
  height: number;
  offset: number;
  length: number;
  encoding: "png" | "bmp";
};

/**
 * Parse an ICO container, throwing on anything that is not one.
 *
 * This exists so the assertion can be "the response is a usable icon" rather
 * than "the response is 200" — a route serving a renamed HTML page, or an ICO
 * whose directory points past the end of the body, would satisfy the weaker
 * claim. The test asserting "the ICO parser rejects a response that is not an
 * ICO" is this function's positive control: it feeds a real non-ICO response
 * back through it, so a parser that had quietly stopped rejecting anything
 * cannot make every assertion above pass by agreeing with whatever it is given.
 */
function parseIco(bytes: Buffer): IcoImage[] {
  const head = bytes.subarray(0, 8).toString("hex");
  if (bytes.length < 6) {
    throw new Error(`too short to be an ICO: ${bytes.length} bytes`);
  }
  const reserved = bytes.readUInt16LE(0);
  const type = bytes.readUInt16LE(2);
  const count = bytes.readUInt16LE(4);
  if (reserved !== 0 || type !== 1) {
    throw new Error(
      `not an ICO header: reserved=${reserved} type=${type} (want 0 and 1), first bytes ${head}`,
    );
  }
  if (count < 1) throw new Error(`ICO declares ${count} images`);
  if (bytes.length < 6 + 16 * count) {
    throw new Error(
      `ICO declares ${count} images but is only ${bytes.length} bytes`,
    );
  }

  const images: IcoImage[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    // A zero in the width/height byte means 256 — the field is one byte wide.
    const width = bytes.readUInt8(at) || 256;
    const height = bytes.readUInt8(at + 1) || 256;
    const length = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    if (length === 0 || offset + length > bytes.length) {
      throw new Error(
        `ICO image ${i} points outside the body: offset=${offset} length=${length} body=${bytes.length}`,
      );
    }
    const payload = bytes.subarray(offset, offset + length);
    const isPng = payload.subarray(0, 8).toString("hex") === PNG_MAGIC;
    // The other legal payload is a headerless BMP, which opens with a 40-byte
    // BITMAPINFOHEADER whose first field is its own size.
    const isBmp = length >= 40 && payload.readUInt32LE(0) === 40;
    if (!isPng && !isBmp) {
      throw new Error(
        `ICO image ${i} is neither PNG nor BMP: starts ${payload.subarray(0, 8).toString("hex")}`,
      );
    }
    if (isPng) {
      // The directory says one thing; the pixels say another only if the ICO
      // was packed carelessly. PNG stores width/height in IHDR at bytes 16..24.
      const pngWidth = payload.readUInt32BE(16);
      const pngHeight = payload.readUInt32BE(20);
      if (pngWidth !== width || pngHeight !== height) {
        throw new Error(
          `ICO image ${i} directory says ${width}x${height} but its PNG is ${pngWidth}x${pngHeight}`,
        );
      }
    }
    images.push({
      width,
      height,
      offset,
      length,
      encoding: isPng ? "png" : "bmp",
    });
  }
  return images;
}

test.describe("icon routes", () => {
  test("the derived route set is the one we think it is", () => {
    // `[] ⊆ X` passes vacuously, and a `for` loop over an empty corpus is the
    // strongest-looking green there is. Bound the set and print its members, so
    // a derivation that quietly collapses fails here instead of downstream.
    expect(
      ICON_ROUTES,
      `derived icon routes: ${JSON.stringify(ICON_ROUTES)}`,
    ).toContain("/favicon.ico");
    expect(
      ICON_ROUTES.length,
      `implausibly few icon routes derived: ${JSON.stringify(ICON_ROUTES)}`,
    ).toBeGreaterThanOrEqual(4);
  });

  for (const route of ICON_ROUTES) {
    test(`${route} serves image bytes, not a page`, async ({ request }) => {
      const res = await request.get(route);
      const body = Buffer.from(await res.body());
      const contentType = res.headers()["content-type"] ?? "";

      expect(
        res.status(),
        `${route} returned ${res.status()} ${contentType}`,
      ).toBe(200);
      // The defect's signature: a 404 page is `text/html` and ~45 KB, and every
      // consumer of these URLs wants an image or nothing.
      expect(contentType, `${route} content-type`).toMatch(/^image\//);
      expect(
        body.subarray(0, 15).toString("latin1").toLowerCase(),
        `${route} served an HTML document`,
      ).not.toContain("<!doctype html");
      expect(body.length, `${route} served an empty body`).toBeGreaterThan(0);
    });
  }

  test("/favicon.ico is a real, multi-size, small ICO", async ({ request }) => {
    const res = await request.get("/favicon.ico");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(
      /^image\/(x-icon|vnd\.microsoft\.icon)$/,
    );

    const body = Buffer.from(await res.body());
    const images = parseIco(body);

    // Three sizes so browsers, tabs and pinned shortcuts each get a real
    // rasterisation rather than a downscale of one.
    expect(
      images.map((image) => `${image.width}x${image.height}`),
      `served ICO images: ${JSON.stringify(images)}`,
    ).toEqual(["16x16", "32x32", "48x48"]);

    // The other half of the defect was transfer, not just the status line: the
    // 404 page this replaces was 45,008 bytes locally and 46,057 in production,
    // sent on every cold visit. A cushion above the 1,373 bytes measured here
    // (3,412 while the mark was the violet gradient — the prepress mark is
    // flat colour and compresses far better), low enough that re-introducing a
    // page-sized response fails.
    expect(body.length, `/favicon.ico is ${body.length} bytes`).toBeLessThan(
      16_384,
    );
  });

  test("the ICO parser rejects a response that is not an ICO", async ({
    request,
  }) => {
    // A positive control for `parseIco`. Without it, a parser that threw on
    // nothing — or returned `[]` for everything — would make the assertions
    // above pass on any 200 the server cared to send. `/icon.svg` is a real
    // served icon route and definitively not an ICO, so it separates "these
    // bytes are an ICO" from "these bytes came back with status 200".
    const svg = Buffer.from(await (await request.get("/icon.svg")).body());
    expect(svg.length).toBeGreaterThan(0);
    expect(() => parseIco(svg)).toThrow(/not an ICO header/);
  });
});
