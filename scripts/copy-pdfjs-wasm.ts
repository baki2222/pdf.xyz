/**
 * Copy pdfjs's image-decoder assets into `public/` so the browser can fetch
 * them from OUR origin.
 *
 * Runs before `next dev` and `next build` (see package.json). The destination
 * is version-stamped — `public/pdfjs-wasm/<version>/` — so the files can be
 * served immutably and a pdfjs bump lands on a fresh URL instead of poisoning
 * a cached one.
 *
 * Every step asserts. This script exists because a missing decoder produced
 * silently blank output; a copy step that quietly copied nothing would
 * reproduce exactly that failure one layer down. A missing source file, a
 * short read, or a count mismatch is fatal and says which file.
 *
 * NOTE for `find`: under pnpm `node_modules/pdfjs-dist` is a SYMLINK into
 * `.pnpm/`, so `find node_modules/pdfjs-dist -name '*.wasm'` reports nothing
 * unless you pass `-L`. That false zero is what hid this defect. This script
 * resolves the package through `require.resolve`, which follows the link.
 */
import { createRequire } from "node:module";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  PDFJS_WASM_ASSETS,
  PDFJS_WASM_VERSION,
} from "../src/lib/pdf/wasm-assets";

/**
 * Minimum `.bcmap` files expected in pdfjs's cmaps directory. A count-assert
 * rather than a list: the point is to notice the directory arriving EMPTY or
 * nearly so (a packaging change, a bad copy), which would blank every CJK
 * document exactly as before while every source-reading guard stayed green.
 */
const MIN_CMAPS = 100;

const require = createRequire(import.meta.url);

function fail(message: string): never {
  console.error(`copy-pdfjs-wasm: ${message}`);
  process.exit(1);
}

const pkgJsonPath = require.resolve("pdfjs-dist/package.json");
const installed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
  version: string;
};

if (installed.version !== PDFJS_WASM_VERSION) {
  fail(
    `installed pdfjs-dist is ${installed.version} but PDFJS_WASM_VERSION says ` +
      `${PDFJS_WASM_VERSION}. The browser would fetch decoders from a URL that ` +
      `does not match the library. Update PDFJS_WASM_VERSION in ` +
      `src/lib/pdf/wasm-assets.ts.`,
  );
}

const sourceDir = path.join(path.dirname(pkgJsonPath), "wasm");
const destDir = path.join(
  process.cwd(),
  "public",
  "pdfjs-wasm",
  PDFJS_WASM_VERSION,
);
mkdirSync(destDir, { recursive: true });

let copied = 0;
let bytes = 0;
for (const name of PDFJS_WASM_ASSETS) {
  const from = path.join(sourceDir, name);
  let size: number;
  try {
    size = statSync(from).size;
  } catch {
    fail(
      `${name} is not in ${sourceDir}. pdfjs-dist ${installed.version} does not ` +
        `ship it under that name — the decoder list in wasm-assets.ts is stale.`,
    );
  }
  if (size === 0) fail(`${name} is zero bytes in the package`);
  const to = path.join(destDir, name);
  copyFileSync(from, to);
  const written = statSync(to).size;
  if (written !== size) {
    fail(`${name} copied short: ${written} of ${size} bytes`);
  }
  copied += 1;
  bytes += written;
}

if (copied !== PDFJS_WASM_ASSETS.length) {
  fail(`copied ${copied} of ${PDFJS_WASM_ASSETS.length} assets`);
}

console.log(
  `copy-pdfjs-wasm: ${copied} assets (${(bytes / 1024).toFixed(0)} KB) -> ` +
    `public/pdfjs-wasm/${PDFJS_WASM_VERSION}/`,
);

/* ---------------------------------------------------------------- *
 *  Character maps: without these, a non-embedded CJK document renders
 *  COMPLETELY blank — measured, not assumed.
 * ---------------------------------------------------------------- */

const cmapSource = path.join(path.dirname(pkgJsonPath), "cmaps");
const cmapDest = path.join(
  process.cwd(),
  "public",
  "pdfjs-cmaps",
  PDFJS_WASM_VERSION,
);
mkdirSync(cmapDest, { recursive: true });

let cmapNames: string[];
try {
  cmapNames = readdirSync(cmapSource).filter((n) => n.endsWith(".bcmap"));
} catch {
  fail(
    `${cmapSource} is missing. pdfjs-dist ${installed.version} does not ship ` +
      "character maps under that path — every non-embedded CJK document would " +
      "render blank.",
  );
}

if (cmapNames.length < MIN_CMAPS) {
  fail(
    `only ${cmapNames.length} .bcmap files in ${cmapSource} (expected at least ` +
      `${MIN_CMAPS}) — copying this would silently blank most CJK documents`,
  );
}

let cmapBytes = 0;
for (const name of cmapNames) {
  const from = path.join(cmapSource, name);
  const to = path.join(cmapDest, name);
  copyFileSync(from, to);
  const written = statSync(to).size;
  if (written !== statSync(from).size) fail(`${name} copied short`);
  cmapBytes += written;
}

const landed = readdirSync(cmapDest).filter((n) => n.endsWith(".bcmap")).length;
if (landed !== cmapNames.length) {
  fail(`copied ${cmapNames.length} cmaps but ${landed} landed on disk`);
}

console.log(
  `copy-pdfjs-wasm: ${landed} cmaps (${(cmapBytes / 1024).toFixed(0)} KB) -> ` +
    `public/pdfjs-cmaps/${PDFJS_WASM_VERSION}/`,
);
