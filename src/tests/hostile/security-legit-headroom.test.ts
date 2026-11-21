// @native-canvas
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { classifyPdfAccess, type PdfjsForAccess } from "@/lib/pdf/encryption";
import { ACCESS_DEADLINE_MS } from "@/lib/pdf/pdf-access-guard";
import { loadPdfLib } from "@/lib/pdf/pdf-lib";
import {
  MAX_XREF_OBJECTS,
  objectStreamBudget,
  readXref,
  xrefEntryLimit,
} from "@/lib/pdf/security/document";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { measureTime } from "../time-bound";

// The positive control for lane l02's bounds (`security/document.ts` and
// `pdf-access-guard.ts`): every real-producer file, encrypted owner-only in
// both layouts, still opens through our own reader with every page, and the
// pdf.js probe still calls it restricted with the right count. And each bound
// is MEASURED against the same files, so a constant that drifted toward real
// files fails here rather than in a person's tab.

const DIR = path.join(process.cwd(), "src/tests/fixtures/legit-corpus");
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".pdf"))
  .sort();

const req = createRequire(import.meta.url);
let pdfjsPromise: Promise<PdfjsForAccess> | null = null;
function pdfjs(): Promise<PdfjsForAccess> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      req.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<PdfjsForAccess>;
  return pdfjsPromise;
}

const T = 120_000;

describe("lane l02 bounds against the real-producer corpus", () => {
  test("the corpus is the corpus (health check: it did not shrink)", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(14);
  });

  test("the bounds' own arithmetic (second, independent bound on each constant)", () => {
    // ISO 32000-1 Annex C.2 states the object limit; it is 2^23 - 1.
    expect(MAX_XREF_OBJECTS).toBe(2 ** 23 - 1);
    expect(xrefEntryLimit(0)).toBe(65_536);
    expect(xrefEntryLimit(4e9)).toBe(MAX_XREF_OBJECTS);
    expect(objectStreamBudget(0)).toBe(32 * 2 ** 20);
    expect(objectStreamBudget(1e12)).toBe(512 * 2 ** 20);
    // A deflate stream inflates at most 1,032x; the budget sits well below.
    expect(objectStreamBudget(1 << 30) / (1 << 30)).toBeLessThan(1032);
  });

  test(
    "every file maps far fewer xref entries than the bound allows (bytes per entry measured)",
    async () => {
      const lib = await loadPdfLib();
      let worst = Infinity;
      for (const name of FILES) {
        const bytes = new Uint8Array(readFileSync(path.join(DIR, name)));
        const x = await readXref(lib, bytes);
        expect(x.entries.size, name).toBeGreaterThan(0);
        worst = Math.min(worst, bytes.length / x.entries.size);
        expect(x.entries.size, name).toBeLessThan(xrefEntryLimit(bytes.length));
      }
      // The bound allows one entry per 4 bytes; the corpus spends 312 or more
      // (measured 2026-11-08: gs-ebook-long.pdf). Hold a 50x margin.
      expect(worst).toBeGreaterThan(4 * 50);
    },
    T,
  );

  test("every file's object streams inflate far below the budget (ratio measured)", () => {
    let worst = 0;
    let streams = 0;
    for (const name of FILES) {
      const bytes = readFileSync(path.join(DIR, name));
      const t = bytes.toString("latin1");
      let inflated = 0;
      for (const m of t.matchAll(/\/Type\s*\/ObjStm[^]*?stream\r?\n/g)) {
        const start = m.index + m[0].length;
        inflated += inflateSync(
          bytes.subarray(start, t.indexOf("endstream", start)),
        ).length;
        streams += 1;
      }
      worst = Math.max(worst, inflated / bytes.length);
    }
    // Health check: the corpus has object streams to measure (qpdf, ocrmypdf).
    expect(streams).toBeGreaterThanOrEqual(3);
    // Budget: 32x the file (floor 32 MiB). Measured worst: 0.15x.
    expect(worst).toBeGreaterThan(0);
    expect(worst * 50).toBeLessThan(32);
  });

  for (const objectStreams of [false, true]) {
    const layout = objectStreams ? "object streams" : "classic xref";
    test(
      `every file encrypted owner-only (${layout}) opens with every page, and classifies restricted`,
      async () => {
        const lib = await pdfjs();
        // The deadline's headroom over a real file (CI-flake audit lane 2).
        // It WAS one window per file, each under ACCESS_DEADLINE_MS / 100,
        // the first of them carrying pdf.js's first document in this fork:
        // the repo's own figure for the window is 14-160 ms in Node
        // (pdf-access-guard.ts), so 300 ms was under 2x before CI's slower
        // runner. Now two bounds, each derived from the constant: the
        // FIRST classify of the layout, cold, against ACCESS_DEADLINE_MS /
        // 20 (the deadline guards a tab's first open, so no untimed warm-up
        // is added), and every later file's best of 3 against
        // ACCESS_DEADLINE_MS / 100, the "two orders" claim. Measure mode
        // until CI harvests show 2x at both; the verdicts are asserted on
        // every pass.
        const verdicts: string[] = [];
        let coldMs = -1;
        let worstWarmMs = 0;
        for (const name of FILES) {
          const source = new Uint8Array(readFileSync(path.join(DIR, name)));
          const pages = (await PDFDocument.load(source)).getPageCount();
          const bytes = await encryptPdf(source, {
            userPassword: "",
            ownerPassword: "owner",
            objectStreams,
          });
          const opened = await openProtectedPdf(bytes);
          expect(opened.kind, name).toBe("opened");
          if (opened.kind !== "opened") continue;
          const plain = await PDFDocument.load(opened.pdf.plain);
          expect(plain.getPageCount(), name).toBe(pages);
          const passes = coldMs < 0 ? 1 : 3;
          let best = Infinity;
          for (let k = 0; k < passes; k += 1) {
            // A fresh copy per pass, taken before the clock: the preflight
            // keeps its answer per Uint8Array, so a repeat on the same
            // array timed a cache hit (about 1 ms).
            const fresh = bytes.slice();
            const t0 = performance.now();
            const access = await classifyPdfAccess(fresh, lib);
            best = Math.min(best, performance.now() - t0);
            expect(access, name).toEqual({
              kind: "restricted",
              pageCount: pages,
            });
          }
          verdicts.push("restricted");
          if (coldMs < 0) coldMs = best;
          else worstWarmMs = Math.max(worstWarmMs, best);
        }
        // Health: every file was classified (the `continue` above can skip
        // one), and both windows measured something.
        expect(verdicts).toEqual(FILES.map(() => "restricted"));
        expect(coldMs).toBeGreaterThan(0);
        expect(worstWarmMs).toBeGreaterThan(0);
        measureTime("legit-classify-cold", coldMs, ACCESS_DEADLINE_MS / 20, {
          instance: layout,
          witness: "verdicts",
        });
        measureTime(
          "legit-classify-warm-worst",
          worstWarmMs,
          ACCESS_DEADLINE_MS / 100,
          { instance: layout, witness: "verdicts" },
        );
      },
      T,
    );
  }

  test(
    "every unencrypted file still classifies unencrypted with its page count",
    async () => {
      const lib = await pdfjs();
      for (const name of FILES) {
        const bytes = new Uint8Array(readFileSync(path.join(DIR, name)));
        const pages = (await PDFDocument.load(bytes)).getPageCount();
        expect(await classifyPdfAccess(bytes, lib), name).toEqual({
          kind: "unencrypted",
          pageCount: pages,
        });
      }
    },
    T,
  );
});
