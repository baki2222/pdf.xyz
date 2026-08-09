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
    // it serves THIS checkout's build: `reuseExistingServer` happily adopts a
    // leftover `next start` from another checkout, and a suite that silently
    // tests last week's code is the worst failure mode — it reports success.
    // (Measured 2026-08-09: a worktree run adopted the main tree's stale server
    // on the shared port and failed brand-new specs against old code.) The
    // discriminator is the local build's newest content-hashed chunk — served
    // 200 iff the adopted server runs the same bytes.
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
          : "The freshest locally built chunk is not served there (404) — it is another checkout's or an older build.",
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
