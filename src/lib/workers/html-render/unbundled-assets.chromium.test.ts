// @vitest-environment jsdom
/**
 * THE COMPOSED CHAIN for the "linked files are missing" note: what the
 * browser-side scan TELLS the user, against what the real renderer DOES.
 *
 * The scan (`findUnbundledAssets`) runs on the user's machine before upload;
 * the render runs on the worker afterwards. Each can be right about itself and
 * the two still disagree — a note for a file that would have loaded, or
 * silence for one that will not. So every assertion here puts the SAME page
 * through both: the scan over jsdom's DOM (the browser's DOMParser in
 * production), the render through a real Chromium and the real render network,
 * with the network's fetcher recording what Chromium actually asked for.
 *
 * The corpus is `ASSET_SOURCES` itself — one sample per entry, every entry —
 * so a source added there is proven here without anyone listing it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createNativeChromiumPdfRunner, resolveOnPath } from "./native";
import type { PinnedFetch, Resolve } from "./network";
import { findChromium } from "./test-chromium";
import { ASSET_SOURCES, findUnbundledAssets } from "./unbundled-assets";

const BIN = findChromium(resolveOnPath);
const PUBLIC = "https://assets.example/";

const work = mkdtempSync(path.join(tmpdir(), "pdfxyz-assets-"));
afterAll(() => {
  try {
    rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch {
    /* the OS temp cleaner owns it now */
  }
});

const fetched: string[] = [];
const resolve: Resolve = async (host) => {
  if (host === new URL(PUBLIC).hostname)
    return [{ address: "93.184.215.14", family: 4 }];
  throw new Error("NXDOMAIN");
};
const fetch: PinnedFetch = async (url) => {
  fetched.push(url.toString());
  return {
    status: 200,
    rawHeaders: ["Content-Type", "text/plain"],
    body: new TextEncoder().encode("x"),
  };
};

const runner = createNativeChromiumPdfRunner(
  {
    enabled: true,
    candidates: [BIN ?? "chromium"],
    overridden: true,
    timeoutMs: 60_000,
    maxInputBytes: 10 * 1024 * 1024,
    maxOutputBytes: 50 * 1024 * 1024,
    tmpDir: work,
  },
  { fileExists: () => true, network: { resolve, fetch } },
);

/** One relative reference per source, each named for the entry it came from. */
const REFS = ASSET_SOURCES.map((_, i) => `assets/ref-${i}.bin`);
const BODY = ASSET_SOURCES.map((s, i) => s.sample(REFS[i]!)).join("\n");

const page = (head: string, extra = "") =>
  `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>
<h1>Asset scan proof</h1>
${BODY}
${extra}
</body></html>`;

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

async function render(html: string): Promise<string[]> {
  fetched.length = 0;
  await runner.renderHtml(new TextEncoder().encode(html));
  return [...fetched];
}

describe.skipIf(!BIN)(
  `asset scan vs the real renderer (${BIN ?? "no Chromium found"})`,
  () => {
    // Health check: a corpus that shrank would pass everything below.
    it("the corpus is every source, and big enough to mean something", () => {
      expect(new Set(REFS).size).toBe(ASSET_SOURCES.length);
      expect(ASSET_SOURCES.length).toBeGreaterThanOrEqual(10);
    });

    /*
     * Direction 1 — no source is decoration. With a <base> pointing at a
     * public host, every relative reference becomes fetchable; each source's
     * sample must make Chromium actually fetch its reference, or the scan is
     * reporting something the renderer never asks for.
     * Direction 2 — no element kind is a hole. Everything Chromium fetched
     * must be something the scan reports once the <base> is gone.
     */
    it("each source's reference is one Chromium fetches, and each fetch is one the scan reports", async () => {
      const withBase = page(`<base href="${PUBLIC}">`);
      const got = await render(withBase);
      const expected = REFS.map((r) => new URL(r, PUBLIC).toString());
      const unfetched = ASSET_SOURCES.filter(
        (_, i) => !got.includes(expected[i]!),
      ).map((s) => s.selector);
      expect(unfetched).toEqual([]);

      const reported = findUnbundledAssets(parse(page(""))).references;
      const unreported = got
        .map((u) => new URL(u).pathname.slice(1))
        .filter((ref) => !reported.includes(ref));
      expect(unreported).toEqual([]);
      // And with the <base>, the scan agrees nothing is missing.
      expect(findUnbundledAssets(parse(withBase)).references).toEqual([]);
    }, 90_000);

    /*
     * Without a <base>, the scan's verdict must be the renderer's outcome:
     * everything it reports is never fetched, and the absolute public
     * reference it stays quiet about IS fetched (the positive control).
     */
    it("what the scan reports missing is what the renderer never loads", async () => {
      const absolute = `${PUBLIC}absolute.bin`;
      const html = page(
        "",
        `<img src="${absolute}" alt=""><img src="data:image/png;base64,AAAA" alt="">`,
      );
      const reported = findUnbundledAssets(parse(html)).references;
      expect([...reported].sort()).toEqual([...REFS].sort());
      const got = await render(html);
      expect(got).toEqual([absolute]);
    }, 90_000);
  },
);
