import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readNotoTtf } from "@/lib/pdf/noto-source";
import { setFontByteSource } from "@/lib/pdf/unicode-font";
import {
  setPdfjsForAccessSource,
  type PdfjsForAccess,
} from "@/lib/pdf/encryption";

// The Noto faces the text tools embed come from `fetch("/fonts/…")` in a
// browser, and there is no origin to fetch from under vitest. Point the loader
// at the same TTFs `scripts/copy-noto-fonts.ts` copies into `public/`, so any
// test that stamps non-Latin text embeds exactly the bytes a browser would have
// downloaded.
//
// Registered globally rather than per file on purpose: the failure mode
// otherwise is a test that draws Bengali, forgets the seam, and fails with a
// fetch error that reads like a broken font — a confusing red for a correct
// change, which is how guards get deleted.
//
// What this does NOT prove is that the asset is SERVED; `e2e/unicode-fonts.spec.ts`
// fetches the real URL off the real server for that half.
setFontByteSource(async (pack) => readNotoTtf(pack));

// Compress asks pdf.js whether an encrypted PDF opens without a password. The
// browser build needs a worker URL only the bundler produces and refuses to run
// under Node; the legacy build is the same parser and the same decryption, with
// a fake worker that runs in-process. Registered globally for the same reason
// as the font seam: a runner test that forgets it would read every encrypted
// file as "unreadable" — a confusing red for a correct change.
const requireFromSetup = createRequire(import.meta.url);
setPdfjsForAccessSource(
  () =>
    import(
      /* @vite-ignore */ pathToFileURL(
        requireFromSetup.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
      ).href
    ) as Promise<PdfjsForAccess>,
);

// Unmount anything rendered by a test and reset the DOM after every test.
//
// @testing-library/react registers this same afterEach hook automatically, but
// only as a side effect of being imported — and because our config runs the
// suite with `isolate: false`, that module is imported just once per worker and
// its auto-registration hooks only the first test file. Every later DOM test
// sharing the worker would otherwise inherit an un-reset document and see
// "found multiple elements". setupFiles run for every test file, so registering
// cleanup here restores per-file reset regardless of module caching. In the Node
// worker tests nothing is ever rendered, so cleanup() is a harmless no-op.
afterEach(() => {
  cleanup();
});
