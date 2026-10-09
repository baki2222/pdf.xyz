/**
 * Copy the TTFs the text tools embed (the Noto faces, and Geist Mono for the
 * monospace pack) into `public/`, so the browser
 * fetches them from OUR origin.
 *
 * Runs before `next dev` and `next build`, next to `copy-pdfjs-wasm.ts` and for
 * the same reasons. The destination is version-stamped —
 * `public/fonts/<package version>/` — so the files can be served immutably and
 * a font bump lands on a fresh URL instead of poisoning a cached one.
 *
 * Every step asserts, because the failure this guards against is not an error
 * page. A missing face means `embedDrawingFont` cannot fetch it, and the tool
 * refuses a language it advertises — the exact shape of the defect the whole
 * feature exists to close, one layer down. A copy step that quietly copied
 * nothing would recreate it.
 *
 * These faces are NOT in the JS bundle. `src/deploy/bundle-budget.test.ts`
 * measures the chunks a prerendered page references; a `public/` asset is not
 * one, and nothing here is imported by a component. A tool page's weight is
 * unchanged by this step, which is the whole reason the delivery is a fetch and
 * not an import.
 *
 * ── WHY THIS IS A FUNCTION AND NOT JUST A SCRIPT BODY ───────────────────────
 *
 * The work is exported so `font-packs.test.ts` can CALL it rather than assert
 * that somebody else ran it. The first spelling of that guard did the latter —
 * `existsSync(public/…)` — and it was red on every CI run of PR #130, because
 * CI runs `pnpm test` BEFORE `pnpm build` and only `dev`/`build` invoke this
 * file. That is an ordering fact about the workflow, not a fact about the
 * product, and a guard that a developer has to satisfy by hand before it will
 * go green is a guard that gets deleted. Failures THROW; only the CLI arm
 * below turns a throw into `process.exit(1)`.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FONT_PACKS } from "../src/lib/pdf/font-packs";
import {
  installedPackageVersion,
  notoTtfPath,
} from "../src/lib/pdf/noto-source";

/** One face, as it was actually written. */
export interface CopiedFace {
  /** The pack's id, so a caller can tie a row back to `FONT_PACKS`. */
  readonly id: string;
  /** Absolute path written to. */
  readonly dest: string;
  /**
   * Path under `public/`, in URL form — i.e. what a browser must ask for to be
   * served this file. Derived from the destination this step actually wrote,
   * NOT from `fontPackUrl`, so the two can be compared instead of assumed
   * equal.
   */
  readonly servedAt: string;
  /** Bytes on disk after the copy. */
  readonly bytes: number;
}

/**
 * Copy every face in `FONT_PACKS` into `public/fonts/<version>/`.
 *
 * Idempotent, and cheap enough to call from a test: five `copyFileSync`s.
 * Throws on any drift between the table, the installed package and the file.
 */
export function copyNotoFonts(): CopiedFace[] {
  const written: CopiedFace[] = [];

  for (const pack of FONT_PACKS) {
    const installed = installedPackageVersion(pack);
    if (installed !== pack.version) {
      throw new Error(
        `${pack.pkg} is installed at ${installed} but FONT_PACKS says ` +
          `${pack.version}. The browser would fetch ${pack.file} from a URL that ` +
          `does not match the installed face. Update src/lib/pdf/font-packs.ts ` +
          `and re-run \`pnpm fonts:coverage\`.`,
      );
    }

    const from = notoTtfPath(pack);
    let size: number;
    try {
      size = statSync(from).size;
    } catch {
      throw new Error(
        `${pack.file} is not at ${from}. ${pack.pkg}@${installed} does not ship ` +
          `it under that name — the pack table is stale.`,
      );
    }
    if (size !== pack.bytes) {
      throw new Error(
        `${pack.file} is ${size} bytes but FONT_PACKS records ${pack.bytes}. The ` +
          `face changed underneath the version stamp, so the coverage table in ` +
          `src/lib/pdf/font-coverage.generated.ts may describe a different font. ` +
          `Re-run \`pnpm fonts:coverage\` and update the size.`,
      );
    }

    const destDir = path.join(process.cwd(), "public", "fonts", pack.version);
    mkdirSync(destDir, { recursive: true });
    const to = path.join(destDir, pack.file);
    copyFileSync(from, to);
    const bytes = statSync(to).size;
    if (bytes !== size) {
      throw new Error(`${pack.file} copied short: ${bytes} of ${size} bytes`);
    }

    written.push({
      id: pack.id,
      dest: to,
      // Re-derived from the destination, with the platform separator
      // normalised. On Windows `path.join` yields backslashes and a URL never
      // does, so a naive comparison against `fontPackUrl` would fail there for
      // a reason that has nothing to do with fonts.
      servedAt:
        "/" +
        path
          .relative(path.join(process.cwd(), "public"), to)
          .split(path.sep)
          .join("/"),
      bytes,
    });
  }

  if (written.length !== FONT_PACKS.length) {
    throw new Error(`copied ${written.length} of ${FONT_PACKS.length} faces`);
  }
  return written;
}

/**
 * CLI arm. Guarded so importing this module from a test copies nothing until
 * `copyNotoFonts()` is called and never calls `process.exit`.
 */
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const written = copyNotoFonts();
    const bytes = written.reduce((sum, face) => sum + face.bytes, 0);
    console.log(
      `copy-noto-fonts: ${written.length} faces (${(bytes / 1024 / 1024).toFixed(1)} MB) -> public/fonts/`,
    );
  } catch (error) {
    console.error(`copy-noto-fonts: ${(error as Error).message}`);
    process.exit(1);
  }
}
