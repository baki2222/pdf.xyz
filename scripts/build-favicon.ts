/**
 * Regenerate `src/app/favicon.ico` from the brand mark — the Folded P's
 * rounded tab tile, `renderBrandMark(size, "favicon")`, which draws
 * `tileSvg("favicon")` from `src/lib/brand.ts` like `icon.svg` beside it.
 *
 * ── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────────
 *
 * `e2e/favicon.spec.ts` stated the problem exactly and then lived with it:
 *
 *   "It is a committed binary rather than a generated route because Next gives
 *    the favicon convention no dynamic form … so nothing here can regenerate
 *    it. … if the brand mark changes, this file does not notice, and that is a
 *    known gap rather than an oversight."
 *
 * The brand mark changed. Measured 2026-09-20, the committed `favicon.ico` was
 * still the retired violet tile with its document glyph — 1,783 indigo pixels
 * and ZERO accent pixels at 48px — while `icon.svg` beside it had been
 * rewritten and every source guard passed. A documented gap is still a gap: a
 * comment is not a guard, and writing the hole down is what made it feel
 * managed.
 *
 * Two things close it. This script makes "nothing can regenerate it" false, so
 * the mark has one source and the ICO is a build output someone forgot to
 * rebuild rather than an independent drawing. And `src/app/favicon-ico.test.ts`
 * decodes the committed bytes and fails if they stop being the mark, so the
 * forgetting is red rather than invisible.
 *
 *   pnpm icon:favicon
 *
 * Next's favicon convention takes `extensions: ["ico"]` and no dynamic form,
 * which is why this writes a file instead of adding a route.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderBrandMark } from "../src/lib/og";

/** The sizes a browser, a bookmark bar and a Windows tile actually ask for. */
const SIZES = [16, 32, 48] as const;

const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/**
 * Pack PNGs into an ICO container.
 *
 * ICONDIR: reserved(2)=0, type(2)=1 for icon, count(2). Then one ICONDIRENTRY
 * per image: width(1), height(1) — 0 meaning 256 — palette(1), reserved(1),
 * planes(2), bpp(2), size(4), offset(4). PNG payloads follow verbatim, which
 * every browser since IE11 reads.
 */
function packIco(images: { size: number; png: Uint8Array }[]): Buffer {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(ICO_ENTRY_BYTES * images.length);
  let offset = ICO_HEADER_BYTES + directory.length;

  images.forEach((image, index) => {
    const at = index * ICO_ENTRY_BYTES;
    directory.writeUInt8(image.size === 256 ? 0 : image.size, at);
    directory.writeUInt8(image.size === 256 ? 0 : image.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });

  return Buffer.concat([
    header,
    directory,
    ...images.map((image) => Buffer.from(image.png)),
  ]);
}

async function main(): Promise<void> {
  const images = [];
  for (const size of SIZES) {
    const response = renderBrandMark(size, "favicon");
    const png = new Uint8Array(await response.arrayBuffer());
    if (png[0] !== 0x89) throw new Error(`size ${size} did not render a PNG`);
    images.push({ size, png });
  }

  const target = path.join(process.cwd(), "src/app/favicon.ico");
  const ico = packIco(images);
  writeFileSync(target, ico);

  const summary = images
    .map((image) => `${image.size}px ${image.png.length}B`)
    .join(", ");
  process.stdout.write(`wrote ${target} — ${ico.length}B (${summary})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
