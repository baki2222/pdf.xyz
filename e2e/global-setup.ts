import type { FullConfig } from "@playwright/test";

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

  if (status === 404) return;

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
