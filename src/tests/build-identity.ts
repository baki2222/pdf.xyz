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
 * ── WHAT THE FIRST VERSION OF THIS CHECK COULD NOT SEE ───────────────────────
 *
 * It probed the freshest local content-hashed chunk and accepted a `200`. That
 * names a MECHANISM ("a file I just built is reachable") where the property is
 * **"the server answering me was built from this tree"** — and the two come
 * apart in the most ordinary workflow there is:
 *
 *     next start          # serves /_next/static/* straight off disk
 *     pnpm build          # same worktree, in place: new chunks land on disk
 *     # the OLD process now serves the NEW chunk files, from its OLD manifests
 *
 * Measured 2026-08-16 against a real server, not reasoned about:
 *
 *     CURRENT GUARD verdict : {"ok":true}          <- false pass
 *     BUILD_ID on disk      : CilNHU9GAoUxQqTNDYyAO
 *     BUILD_ID served       : 8O3hemTNa4PT8KQm0W0Ub
 *
 * It worked for the different-CHECKOUT case it was written for; rebuild-in-place
 * was the hole, and it cost a full e2e run — all 30 cases red **for the wrong
 * reason**, which this codebase treats as worse than a miss, because a red
 * nobody can explain gets deleted.
 *
 * ── WHY THE BUILD ID, AND WHY AS A LITERAL SEARCH ────────────────────────────
 *
 * `.next/BUILD_ID` identifies the build itself, and the server embeds its OWN
 * id in the document it renders — from memory, not from disk, which is the
 * whole point: the measurement above shows a stale process still reporting the
 * id it started with after the tree was rebuilt underneath it.
 *
 * The served document is searched for the on-disk id **as a literal**, rather
 * than parsing Next's payload for a build-id field. That deliberately avoids
 * depending on an internal format (`"b":"<id>"` today, in the flight payload):
 * if Next stops embedding it, this fails CLOSED — red, immediately, on the next
 * run — instead of quietly matching nothing and passing. A 21-character random
 * id cannot appear in another build's output by accident, so the literal search
 * has no false-accept path.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** The response shape this check needs: a status and the body it may search. */
export interface BuildProbeResponse {
  readonly status: number;
  text(): Promise<string>;
}

/**
 * This checkout's build id, or `null` when there is no local build to compare
 * against. Never throws — an unreadable/empty `BUILD_ID` is "no build", which
 * refuses adoption rather than excusing it.
 */
export function localBuildId(nextDir: string): string | null {
  try {
    const id = readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export type AdoptedBuildVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * `no-local-build`    — nothing here to compare against.
       * `build-id-mismatch` — it answered, and it is running a different build:
       *                       another checkout, or this one before a rebuild.
       * `unreachable`       — it did not answer, or did not answer with a page.
       */
      readonly reason: "no-local-build" | "build-id-mismatch" | "unreachable";
    };

/**
 * Decide whether an adopted server was built from THIS checkout. `fetchImpl` is
 * injectable for tests; the status and the body are both read.
 *
 * The document fetched is the site root, because every App Router response
 * carries the rendering server's own build id. A non-200, a transport failure,
 * or a body that cannot be read is `unreachable` — **never a pass**: this check
 * exists to refuse a server it cannot vouch for.
 */
export async function verifyAdoptedServerBuild(
  baseURL: string,
  nextDir: string,
  fetchImpl: (url: string) => Promise<BuildProbeResponse> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(5_000) }),
): Promise<AdoptedBuildVerdict> {
  const expected = localBuildId(nextDir);
  // No local build at all: adopting ANY server means testing unknown code —
  // exactly the silent-wrong-build failure this check exists to refuse.
  if (!expected) return { ok: false, reason: "no-local-build" };
  let body: string;
  try {
    const res = await fetchImpl(new URL("/", baseURL).toString());
    if (res.status !== 200) return { ok: false, reason: "unreachable" };
    body = await res.text();
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  return body.includes(expected)
    ? { ok: true }
    : { ok: false, reason: "build-id-mismatch" };
}
