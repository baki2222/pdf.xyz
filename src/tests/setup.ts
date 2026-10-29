import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readNotoTtf } from "@/lib/pdf/noto-source";
import { setFontByteSource } from "@/lib/pdf/unicode-font";
import { discloseKeyingForTests } from "@/lib/ratelimit/config";
import { resetWorkerStatusForTests } from "@/components/tools/use-worker-status";
import { observeClassesForTests } from "@/lib/utils";
import { droppedClasses } from "./class-conflicts";
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

// cn() joins and does not merge (src/lib/utils.ts), so two classes from one
// Tailwind family in one list are decided by the stylesheet's order, not by
// what was written last. Every list the component suite renders is checked,
// and a conflict throws inside the render that produced it — a red naming
// the classes, rather than a page that looks slightly wrong in one state.
// The static scan (src/lib/cn-conflicts.test.ts) cannot read a variable or a
// prop handed further on; this sees them as rendered.
observeClassesForTests((classes) => {
  const dropped = droppedClasses(classes);
  if (dropped.length > 0)
    throw new Error(
      `cn() produced conflicting classes — [${dropped.join(" ")}] lose to a later class in "${classes}". cn() does not merge: write one class per family per branch.`,
    );
});

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

// Per-client rate-limit keying is gated on the privacy disclosure
// (`ratelimit/config.ts`). A test that needs the counterfactual sets
// `discloseKeyingForTests(true)`; restoring it here, after EVERY test, means a
// file that forgets cannot hand the next file in its worker a world where the
// limiter keys by address while /privacy says it does not.
afterEach(() => {
  discloseKeyingForTests(undefined);
});

// The worker status is ONE check per page, cached at module level
// (`use-worker-status.ts`). Under `isolate: false` a page is the whole
// worker, so every test starts with the page's answer forgotten — a test
// that stubs a not-ready status must not read the last test's ready one —
// and with its retry backoff instant (a test that wants the waits injects
// its own clock).
beforeEach(() => {
  resetWorkerStatusForTests({ sleep: () => Promise.resolve() });
});
