import {
  execFileSync,
  type ExecFileSyncOptions,
  type ExecFileSyncOptionsWithBufferEncoding,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import { resolvePnpmInvocation } from "@/lib/workers/exec-pnpm";

/**
 * Drop-in replacement for `execFileSync("pnpm", args, options)` that resolves
 * `pnpm` portably (see `resolvePnpmInvocation`) instead of requiring it on PATH.
 * Overloaded to mirror `execFileSync` itself so callers keep their existing
 * `string`-vs-`Buffer` return type inference based on whether they pass `encoding`.
 */
export function execPnpmSync(
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding,
): string;
export function execPnpmSync(
  args: string[],
  options?: ExecFileSyncOptionsWithBufferEncoding,
): Buffer;
export function execPnpmSync(
  args: string[],
  options?: ExecFileSyncOptions,
): string | Buffer {
  const { command, prefixArgs } = resolvePnpmInvocation();
  return execFileSync(
    command,
    [...prefixArgs, ...args],
    options as ExecFileSyncOptionsWithBufferEncoding,
  );
}
