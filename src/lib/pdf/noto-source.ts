/**
 * Where the Noto TTFs come from, and what they actually contain.
 *
 * NODE ONLY. This module reads `node_modules` and the filesystem; it exists for
 * the copy step, the coverage generator and the guards. `import-boundary.test.ts`
 * fails if any non-test module under `src/` statically imports it, because
 * dragging `node:fs` into a client bundle is the exact regression the pdf-lib
 * dynamic boundary was built to prevent.
 *
 * The package is resolved through `require.resolve`, not by joining a path into
 * `node_modules`: under pnpm those directories are symlinks into `.pnpm/`, and a
 * path-joined lookup is the false-zero that once hid a missing decoder for a
 * whole release. Resolution follows the link; a bare path does not.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FONT_PACKS, type FontPack, type FontPackId } from "./font-packs";

const require_ = createRequire(import.meta.url);

/** Absolute path to a pack's TTF inside the installed package. */
export function notoTtfPath(pack: FontPack): string {
  const pkgJson = require_.resolve(`${pack.pkg}/package.json`);
  return path.join(path.dirname(pkgJson), "400Regular", pack.file);
}

/** The version of the npm package a pack is actually installed from. */
export function installedPackageVersion(pack: FontPack): string {
  const pkgJson = require_.resolve(`${pack.pkg}/package.json`);
  return (JSON.parse(readFileSync(pkgJson, "utf8")) as { version: string })
    .version;
}

/** A pack's TTF bytes, straight off disk. */
export function readNotoTtf(pack: FontPack): Uint8Array {
  return new Uint8Array(readFileSync(notoTtfPath(pack)));
}

/**
 * Every code point in a pack's cmap, derived from the file itself.
 *
 * `fontkit` rather than a hand-written block list: a block table is a claim
 * about a font, and this project's most expensive defects are claims that were
 * true when written. Noto Sans JP carries 61% of CJK Unified and Noto Sans KR
 * 39% — a "covers CJK" row would be true of all three and useful for none.
 */
export async function notoCharacterSet(pack: FontPack): Promise<Set<number>> {
  const font = await openNotoFont(readNotoTtf(pack));
  return new Set(font.characterSet);
}

/** Open a TTF with upstream fontkit (Node side; the browser has its own path). */
export async function openNotoFont(
  bytes: Uint8Array,
): Promise<import("fontkit").FontkitFont> {
  const mod = await import("fontkit");
  const create = mod.create ?? mod.default?.create;
  if (!create) throw new Error("fontkit exposed no create()");
  return create(bytes);
}

/** Packs keyed by id, for generators that want to iterate deterministically. */
export function eachPack(): readonly [FontPackId, FontPack][] {
  return FONT_PACKS.map((p) => [p.id, p] as const);
}
