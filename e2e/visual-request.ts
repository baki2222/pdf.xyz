/**
 * Was the screenshot run asked for? Either `VISUAL=1` in the environment (the
 * spelling the redesign spec uses: `VISUAL=1 pnpm test:e2e e2e/visual.spec.ts`)
 * or `pnpm test:visual`, which pnpm announces as `npm_lifecycle_event` — the
 * cross-platform spelling, since `VISUAL=1 cmd` is not a command `cmd.exe`
 * can run.
 *
 * Read by BOTH `playwright.config.ts` (whether the default project ignores
 * the visual spec) and the spec itself (whether it skips), so the two cannot
 * disagree about what was requested.
 */
export function visualRequested(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    (env.VISUAL !== undefined && env.VISUAL !== "" && env.VISUAL !== "0") ||
    env.npm_lifecycle_event === "test:visual"
  );
}
