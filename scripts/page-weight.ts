/**
 * What a prerendered page makes a browser download: the ONE weigher, imported
 * by both `src/deploy/bundle-budget.test.ts` (the budget) and
 * `scripts/weigh-pages.ts` (the before/after table a budget change is argued
 * from), and by the guards that read a page's first-load chunks for what
 * they CARRY (the catalogue test in bundle-budget).
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
 * TWO FIGURES since 2026-10-09:
 *  - `kb`: UNCOMPRESSED bytes on disk (~3x transfer) — the figure every raw
 *    budget in this repo was written in. Fine for comparing builds, wrong as
 *    a user-facing figure.
 *  - `gzKb`: gzip -9 of each UNIQUE chunk, summed — close to what a browser
 *    transfers (each chunk is its own response, compressed on its own), and
 *    the unit the redesign's growth allowances are written in. Before this,
 *    every gz figure in the plan was a one-off measurement nothing could
 *    re-run, and none matched the build once one was weighed (home 191.6
 *    planned vs 202.6 measured; tool pages 302.4 vs 371.2).
 * `src/deploy/page-weight.test.ts` holds `gzKb` to a sum it computes itself.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

export interface ChunkWeight {
  /** The chunk URL as the page references it. */
  url: string;
  /** Where that URL lives in the build (decoded). */
  file: string;
  bytes: number;
  /** gzip -9 of this chunk alone. */
  gzBytes: number;
}

export interface PageWeight {
  html: string;
  chunks: number;
  /** Uncompressed KB, rounded to the KB. */
  kb: number;
  /** gzip -9 per unique chunk, summed; KB to one decimal. */
  gzKb: number;
  /** Every chunk file counted, once each, in the order the page references it. */
  files: string[];
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
 * Where a chunk URL lives in the build. `decodeURIComponent`, because a
 * dynamic route is percent-encoded in the HREF and NOT on disk:
 * `/tools/%5Bslug%5D/page-*.js` is `[slug]` in `.next`. Without it `existsSync`
 * was false for the LARGEST chunk on every tool page, which was then counted
 * in `chunks` and added ZERO bytes.
 */
export function chunkFile(nextDir: string, url: string): string {
  return path.join(nextDir, decodeURIComponent(url.replace("/_next/", "")));
}

/**
 * The files a page loads up front, in reference order — the set every
 * first-load CONTENT guard reads. A referenced chunk that is not on disk
 * throws: a reader that skipped it would report a page clean of whatever that
 * chunk carries.
 */
export function chunkFiles(nextDir: string, htmlRelPath: string): string[] {
  const urls = chunkUrls(nextDir, htmlRelPath);
  const files = urls.map((url) => chunkFile(nextDir, url));
  // A counted chunk that is not weighed is the defect above, and decoding
  // only fixes today's spelling of it. The PROPERTY is that `chunks` and
  // `kb` describe the same set, so a miss is fatal rather than silent.
  const unweighed = urls.filter((_, i) => !existsSync(files[i]!));
  if (unweighed.length > 0) {
    throw new Error(
      `page-weight: ${unweighed.length} referenced chunk(s) were counted but not found on disk, so their bytes went uncounted: ${unweighed.join(", ")}`,
    );
  }
  return files;
}

/**
 * gzip -9 sizes, memoised per file for the life of the process: the content
 * guards and the budget weigh ~90 pages that share most of their chunks, and
 * each chunk is compressed once. Keyed by path, size and mtime, so a rebuild
 * under a long-lived process cannot serve a stale figure.
 */
const gzCache = new Map<string, number>();
function gzipSize(file: string): number {
  const stat = statSync(file);
  const key = `${file}\0${stat.size}\0${stat.mtimeMs}`;
  const hit = gzCache.get(key);
  if (hit !== undefined) return hit;
  const size = gzipSync(readFileSync(file), { level: 9 }).length;
  gzCache.set(key, size);
  return size;
}

/**
 * Unique chunks a prerendered page references and their total size on disk,
 * raw and gzipped, or null when the build has no such page.
 */
export function weighPage(
  nextDir: string,
  htmlRelPath: string,
): PageWeight | null {
  const html = path.join(nextDir, "server", "app", htmlRelPath);
  if (!existsSync(html)) return null;
  const urls = chunkUrls(nextDir, htmlRelPath);
  const files = chunkFiles(nextDir, htmlRelPath);
  const sized: ChunkWeight[] = urls.map((url, i) => ({
    url,
    file: files[i]!,
    bytes: statSync(files[i]!).size,
    gzBytes: gzipSize(files[i]!),
  }));
  const bytes = sized.reduce((sum, c) => sum + c.bytes, 0);
  const gzBytes = sized.reduce((sum, c) => sum + c.gzBytes, 0);
  sized.sort((a, b) => b.bytes - a.bytes);
  return {
    html: htmlRelPath,
    chunks: urls.length,
    kb: Math.round(bytes / 1024),
    gzKb: Math.round((gzBytes / 1024) * 10) / 10,
    files,
    sized,
  };
}

/**
 * Every page the build prerendered, as posix paths relative to
 * `.next/server/app` (`index.html`, `tools/rotate-pdf.html`, …), sorted.
 *
 * DERIVED from disk, never typed: a guard that names its pages cannot see the
 * next route that starts carrying what it forbids (CLAUDE.md rule 4). Lifted
 * from bundle-budget's private walk on 2026-10-09 so the budget, the lazy-chunk
 * guard and the server-rendered-content guard read one set. An absent build
 * throws rather than returning `[]`, which every `⊆` check passes.
 */
export function prerenderedPages(nextDir: string): string[] {
  const appDir = path.join(nextDir, "server", "app");
  if (!existsSync(appDir)) {
    throw new Error(
      `page-weight: no ${appDir} — run \`pnpm build\` before reading its pages`,
    );
  }
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : entry.name.endsWith(".html")
          ? [
              path
                .relative(appDir, path.join(dir, entry.name))
                .split(path.sep)
                .join("/"),
            ]
          : [],
    );
  return walk(appDir).sort();
}
