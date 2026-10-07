/**
 * What a prerendered page makes a browser download: the ONE weigher, imported
 * by both `src/deploy/bundle-budget.test.ts` (the budget) and
 * `scripts/weigh-pages.ts` (the before/after table a budget change is argued
 * from).
 *
 * They were two copies, and a docblock said they used the "same method". On
 * 2026-08-21 the test's copy learned to decode `/tools/%5Bslug%5D/page-*.js`
 * (the largest chunk on every tool page; it is `[slug]` on disk) and to fail
 * on a chunk it counted but could not weigh. The script's copy never did: it
 * `continue`d past the miss, so on 2026-10-08 it reported a tool page at
 * 715 KB while the budget test, over the same build, measured 1,241 KB. The
 * page chunk was simply absent from the script's sum. Shared, the two cannot
 * drift, and bundle-budget.test.ts runs the script to check it.
 *
 * Sizes are UNCOMPRESSED bytes on disk (~3x transfer): fine for comparing
 * builds, wrong as a user-facing figure.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface ChunkWeight {
  /** The chunk URL as the page references it. */
  url: string;
  bytes: number;
}

export interface PageWeight {
  html: string;
  chunks: number;
  kb: number;
  /** Every referenced chunk, heaviest first. */
  sized: ChunkWeight[];
}

/** The unique chunk URLs a prerendered page references. */
export function chunkUrls(nextDir: string, htmlRelPath: string): string[] {
  const html = path.join(nextDir, "server", "app", htmlRelPath);
  if (!existsSync(html)) return [];
  return [
    ...new Set(
      readFileSync(html, "utf8").match(
        /\/_next\/static\/chunks\/[^"']+?\.js/g,
      ) ?? [],
    ),
  ];
}

/**
 * Unique chunks a prerendered page references and their total size on disk,
 * or null when the build has no such page.
 */
export function weighPage(
  nextDir: string,
  htmlRelPath: string,
): PageWeight | null {
  const html = path.join(nextDir, "server", "app", htmlRelPath);
  if (!existsSync(html)) return null;
  const urls = chunkUrls(nextDir, htmlRelPath);
  let bytes = 0;
  const sized: ChunkWeight[] = [];
  const unweighed: string[] = [];
  for (const url of urls) {
    // decodeURIComponent, because a dynamic route is percent-encoded in the
    // HREF and NOT on disk: `/tools/%5Bslug%5D/page-*.js` is `[slug]` in
    // `.next`. Without it `existsSync` was false for the LARGEST chunk on every
    // tool page, which was then counted in `chunks` and added ZERO bytes.
    const file = path.join(
      nextDir,
      decodeURIComponent(url.replace("/_next/", "")),
    );
    if (!existsSync(file)) {
      // A counted chunk that is not weighed is the defect above, and decoding
      // only fixes today's spelling of it. The PROPERTY is that `chunks` and
      // `kb` describe the same set, so a miss is fatal rather than silent.
      unweighed.push(url);
      continue;
    }
    const size = statSync(file).size;
    bytes += size;
    sized.push({ url, bytes: size });
  }
  if (unweighed.length > 0) {
    throw new Error(
      `page-weight: ${unweighed.length} referenced chunk(s) were counted but not found on disk, so their bytes went uncounted: ${unweighed.join(", ")}`,
    );
  }
  sized.sort((a, b) => b.bytes - a.bytes);
  return {
    html: htmlRelPath,
    chunks: urls.length,
    kb: Math.round(bytes / 1024),
    sized,
  };
}
