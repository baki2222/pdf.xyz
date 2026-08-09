/**
 * Build-identity check for an ADOPTED e2e server.
 *
 * `webServer.reuseExistingServer` adopts whatever already listens on the e2e
 * port, and `e2e/global-setup.ts` historically rejected only DEV servers — a
 * leftover production `next start` from another checkout sailed through, and
 * the suite silently tested last week's code while reporting green. Measured
 * 2026-08-09: a worktree run adopted the main tree's stale server and failed
 * brand-new specs against code that did not contain the feature.
 *
 * The discriminator is a content-hashed chunk: `next start` serves
 * `/_next/static/...` straight from its own `.next/static`, and chunk
 * filenames embed a hash of their contents — so the freshest local chunk is
 * served with `200` iff the adopted server runs the same build (identical
 * hashes mean identical bytes, in which case adoption is harmless), and `404`
 * from any other build. Deliberately the NEWEST chunk by mtime: stable-name
 * files (polyfills, framework) can share hashes across builds and would
 * false-pass.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** The newest content-hashed .js chunk of the local build, as a URL path. */
export function discriminatingChunk(nextDir: string): string | null {
  const chunksDir = path.join(nextDir, "static", "chunks");
  let newest: { file: string; mtimeMs: number } | null = null;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const mtimeMs = statSync(full).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs };
      }
    }
  };
  walk(chunksDir);
  if (!newest) return null;
  const rel = path
    .relative(path.join(nextDir, "static"), (newest as { file: string }).file)
    .split(path.sep)
    .join("/");
  return `/_next/static/${rel}`;
}

export type AdoptedBuildVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "no-local-build" | "chunk-not-served" };

/**
 * Decide whether an adopted server serves THIS checkout's build. `fetchImpl`
 * is injectable for tests; only the status code is read.
 */
export async function verifyAdoptedServerBuild(
  baseURL: string,
  nextDir: string,
  fetchImpl: (url: string) => Promise<{ status: number }> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(5_000) }),
): Promise<AdoptedBuildVerdict> {
  const chunk = discriminatingChunk(nextDir);
  // No local build at all: adopting ANY server means testing unknown code —
  // exactly the silent-wrong-build failure this check exists to refuse.
  if (!chunk) return { ok: false, reason: "no-local-build" };
  try {
    const res = await fetchImpl(new URL(chunk, baseURL).toString());
    return res.status === 200 ? { ok: true } : { ok: false, reason: "chunk-not-served" };
  } catch {
    return { ok: false, reason: "chunk-not-served" };
  }
}
