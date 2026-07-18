import {
  execFileSync,
  type ExecFileSyncOptions,
  type ExecFileSyncOptionsWithBufferEncoding,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Spawn a `package.json` worker/deploy script as a subprocess for the CLI smoke tests —
 * the tier that must exercise the real binary end-to-end (real spawn, real `tsx`
 * transpile, real filesystem + stdin, real exit code) rather than call the worker
 * in-process.
 *
 * Why it runs the script's interpreter directly instead of `pnpm run <script>`:
 * `pnpm run` forks a whole extra `pnpm` process that re-parses this package's very large
 * `scripts` map on every single invocation (~1.1s of pure wrapper overhead per call in
 * the sandbox). With ~1.2k smoke spawns across the suite that indirection alone added
 * ~20 CPU-minutes and pushed the unit gate past its wall-clock budget, for zero added
 * coverage — the worker under test never sees pnpm. We instead look the script up in
 * `package.json` (so a missing/renamed script still fails loudly, preserving the
 * script-wiring assertion) and invoke its interpreter — the local `tsx` binary for
 * `tsx scripts/*.ts` — straight through, cutting each spawn from ~1.66s to ~0.63s while
 * running the identical `scripts/worker-*.ts` entrypoint the published `pnpm worker:*`
 * command runs.
 *
 * Argument shape mirrors the old `pnpm`-based helper so call sites are unchanged: pass
 * `["-s", "worker:release-index", ...cliArgs]`; the leading pnpm flags (`-s`/`--silent`,
 * an optional `run`) are stripped, the next token is the script name, and everything
 * after it is forwarded to the worker verbatim.
 */

let scriptsCache: Record<string, string> | undefined;
function packageScripts(): Record<string, string> {
  if (!scriptsCache) {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    scriptsCache = pkg.scripts ?? {};
  }
  return scriptsCache;
}

/** Resolve a `package.json` script name to the concrete argv to spawn (interpreter + its args). */
function resolveScriptArgv(scriptName: string, cliArgs: string[]): {
  command: string;
  argv: string[];
} {
  const scripts = packageScripts();
  const command = scripts[scriptName];
  if (!command) {
    throw new Error(
      `run-worker-cli: no package.json script named "${scriptName}" — the smoke test references a script that does not exist.`,
    );
  }
  // Scripts here are simple `<interpreter> <file> [args...]` forms (`tsx scripts/foo.ts`,
  // `sh scripts/foo.sh`); tokenizing on whitespace is sufficient and no shell is involved.
  const [interpreter, ...interpreterArgs] = command.split(/\s+/).filter(Boolean);
  if (!interpreter) {
    throw new Error(
      `run-worker-cli: package.json script "${scriptName}" has an empty command.`,
    );
  }
  // `tsx` must be the workspace-local binary, not one assumed on PATH.
  const resolved =
    interpreter === "tsx"
      ? join(process.cwd(), "node_modules", ".bin", "tsx")
      : interpreter;
  return { command: resolved, argv: [...interpreterArgs, ...cliArgs] };
}

/** Strip the leading pnpm-style flags/`run` verb and return `{ scriptName, cliArgs }`. */
function parsePnpmStyleArgs(args: string[]): {
  scriptName: string;
  cliArgs: string[];
} {
  let i = 0;
  while (i < args.length && (args[i] === "-s" || args[i] === "--silent")) i++;
  if (args[i] === "run") i++;
  const scriptName = args[i];
  if (!scriptName) {
    throw new Error("run-worker-cli: no script name in arguments");
  }
  return { scriptName, cliArgs: args.slice(i + 1) };
}

/**
 * Run a worker/deploy script as a subprocess, resolving it from `package.json`. A
 * drop-in replacement for the former `execPnpmSync(["-s", <script>, ...args], opts)`:
 * same argument shape, same overloaded `string`-vs-`Buffer` return typing driven by
 * whether `encoding` is passed.
 */
export function runWorkerCliSync(
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding,
): string;
export function runWorkerCliSync(
  args: string[],
  options?: ExecFileSyncOptionsWithBufferEncoding,
): Buffer;
export function runWorkerCliSync(
  args: string[],
  options?: ExecFileSyncOptions,
): string | Buffer {
  const { scriptName, cliArgs } = parsePnpmStyleArgs(args);
  const { command, argv } = resolveScriptArgv(scriptName, cliArgs);
  return execFileSync(
    command,
    argv,
    options as ExecFileSyncOptionsWithBufferEncoding,
  );
}
