/**
 * Copy the Noto TTFs the text tools embed into `public/`, so the browser
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
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { FONT_PACKS } from "../src/lib/pdf/font-packs";
import {
  installedPackageVersion,
  notoTtfPath,
} from "../src/lib/pdf/noto-source";

function fail(message: string): never {
  console.error(`copy-noto-fonts: ${message}`);
  process.exit(1);
}

let copied = 0;
let bytes = 0;

for (const pack of FONT_PACKS) {
  const installed = installedPackageVersion(pack);
  if (installed !== pack.version) {
    fail(
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
    fail(
      `${pack.file} is not at ${from}. ${pack.pkg}@${installed} does not ship ` +
        `it under that name — the pack table is stale.`,
    );
  }
  if (size !== pack.bytes) {
    fail(
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
  const written = statSync(to).size;
  if (written !== size) {
    fail(`${pack.file} copied short: ${written} of ${size} bytes`);
  }
  copied += 1;
  bytes += written;
}

if (copied !== FONT_PACKS.length) {
  fail(`copied ${copied} of ${FONT_PACKS.length} faces`);
}

console.log(
  `copy-noto-fonts: ${copied} faces (${(bytes / 1024 / 1024).toFixed(1)} MB) -> public/fonts/`,
);
