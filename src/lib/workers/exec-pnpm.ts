import { execFileSync } from "node:child_process";

/** How to invoke `pnpm` as a subprocess: the binary/command plus any args that must precede the caller's own. */
export interface PnpmInvocation {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

let cachedInvocation: PnpmInvocation | undefined;

/**
 * Resolve how to invoke `pnpm` without assuming it is on `PATH` — worker CLIs spawn `pnpm <script>`
 * to run other worker checks as subprocesses, but a bare `spawnSync("pnpm", ...)` only works when the
 * host happens to have `pnpm` globally installed; sandboxes and some CI images don't.
 */
export function resolvePnpmInvocation(): PnpmInvocation {
  if (cachedInvocation) return cachedInvocation;

  // `pnpm run <script>` (how every worker CLI here is launched) sets `npm_execpath` to pnpm's OWN
  // CLI entrypoint. Re-invoking that entrypoint through the node binary already running this process
  // (`process.execPath`) needs no PATH lookup at all, so it works on any CI runner, local machine, or
  // sandbox — as long as this process was itself launched via `pnpm run`/`pnpm <script>`.
  const execPath = process.env.npm_execpath;
  if (execPath && /pnpm/i.test(execPath)) {
    cachedInvocation = { command: process.execPath, prefixArgs: [execPath] };
    return cachedInvocation;
  }

  // Launched some other way (e.g. the compiled binary invoked directly): fall back to a `pnpm`
  // already on PATH. On Windows the PATH entry is `pnpm.CMD`, which `execFileSync` cannot
  // execute without a shell — without this flag the probe always threw here and fell through
  // to the corepack fallback, which is dead under Node >= 24 (corepack no longer ships with
  // Node), so a machine with a perfectly good `pnpm` on PATH reported it unfindable.
  try {
    execFileSync("pnpm", ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    cachedInvocation = { command: "pnpm", prefixArgs: [] };
    return cachedInvocation;
  } catch {
    // Not on PATH — fall through to the last resort below.
  }

  // Corepack ships with Node >=16.9 and resolves the exact version pinned by package.json's
  // "packageManager" field, so it reaches the same pnpm without it being installed globally or
  // present on PATH.
  cachedInvocation = { command: "corepack", prefixArgs: ["pnpm"] };
  return cachedInvocation;
}
