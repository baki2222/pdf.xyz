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
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  PDFJS_WASM_ASSETS,
  PDFJS_WASM_VERSION,
} from "../src/lib/pdf/wasm-assets";

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
