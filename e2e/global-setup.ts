import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { verifyAdoptedServerBuild } from "../src/tests/build-identity";

/**
 * Next.js serves its debugging endpoints only in development: a dev server
 * answers this route (400 for a malformed probe), while a production
 * `next start` has no such handler and 404s it.
 */
const DEV_ONLY_ROUTE = "/__nextjs_source-map";

/**
 * Refuse to run the suite against a server we did not build for.
 *
 * `webServer.reuseExistingServer` is enabled for local runs, so whatever is
 * already listening on the e2e port gets adopted silently — including a
 * leftover `pnpm dev`. That is not a harmless substitution. This suite exists
 * to assert the production CSP and statically generated output, and a dev
 * server reached over 127.0.0.1 additionally blocks its own client chunks as a
 * cross-origin dev resource: pages render but never hydrate, so every upload is
 * dropped and the specs fail on a missing filename far from the actual cause.
 *
 * Detect it once, up front, and say plainly what is wrong.
 */
export default async function guardProductionServer(
  config: FullConfig,
): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ??
    `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3100)}`;

  let status: number;
  try {
    const res = await fetch(new URL(DEV_ONLY_ROUTE, baseURL), {
      signal: AbortSignal.timeout(5_000),
    });
    status = res.status;
  } catch {
    // Nothing is listening yet — Playwright is about to start our own
    // `next start`, which is exactly what we want.
    return;
  }

  if (status === 404) {
    // A PRODUCTION server is listening and about to be adopted. Refuse it unless
    // it was BUILT FROM THIS TREE: `reuseExistingServer` happily adopts a
    // leftover `next start`, and a suite that silently tests other code is the
    // worst failure mode — it reports success. Two ways that happens, and the
    // second is the one the first version of this check could not see:
    //   1. another checkout on the shared port (measured 2026-08-09);
    //   2. THIS worktree, rebuilt in place while the old process kept running
    //      (measured 2026-08-16 — it cost a full e2e run, 30 cases red for the
    //      wrong reason, because `next start` serves /_next/static/* off disk
    //      and the stale process happily served the new chunk files).
    // The discriminator is the build id the server itself reports, which it
    // holds in memory from the build it booted with.
    const verdict = await verifyAdoptedServerBuild(
      baseURL,
      path.join(process.cwd(), ".next"),
    );
    if (verdict.ok) return;
    throw new Error(
      [
        `A production server is already listening on ${baseURL}, but it is not serving THIS checkout's build.`,
        verdict.reason === "no-local-build"
          ? "This checkout has no local .next build to compare against, so the adopted server's code is unknown."
          : verdict.reason === "unreachable"
            ? "It did not answer with a page, so its build could not be identified — adoption is refused rather than guessed at."
            : "It reports a different build id than this tree just built: another checkout, or this one before your last `pnpm build` (the old process keeps serving even though the files on disk are new).",
        "",
        "Adopting it would run the suite against different code than you think you are testing.",
        "Stop that server (or free the port via E2E_PORT), then re-run:",
        "  pnpm build && pnpm exec playwright test",
      ].join("\n"),
    );
  }

  throw new Error(
    [
      `A Next.js dev server is already listening on ${baseURL}.`,
      "",
      "The e2e suite runs against a production build so it can assert the real",
      "CSP and statically generated output. A dev server also blocks its own",
      "client chunks when reached over 127.0.0.1, leaving pages rendered but",
      "never hydrated — uploads are then silently dropped.",
      "",
      "Stop that server, then re-run:",
      "  pnpm build && pnpm exec playwright test",
    ].join("\n"),
  );
}
