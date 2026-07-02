/**
 * Presence-only binary resolution, shared by every native worker engine.
 *
 * This primitive answers: does a command name resolve on this host's PATH? It
 * does not execute the target binary or inspect its version. The implementation
 * intentionally delegates lookup to the platform resolver (`command -v`/`where`)
 * rather than walking PATH with `fs.existsSync(path.join(...))`; dynamic PATH
 * walking makes Next/Turbopack trace the whole project into route bundles.
 */

import { execFileSync } from "node:child_process";

/** Resolves whether a binary exists on the host. Presence only; never executes the target. */
export type BinaryResolver = (binary: string) => boolean;

const SAFE_BINARY_NAME = /^[A-Za-z0-9_.+-]+$/;

/**
 * Presence-only resolver: is `binary` resolvable on PATH? Never runs `binary`.
 * Uses fixed lookup commands and argv arrays (no shell interpolation).
 */
export function resolveOnPath(binary: string): boolean {
  if (!SAFE_BINARY_NAME.test(binary)) return false;

  try {
    if (process.platform === "win32") {
      execFileSync("where", [binary], { stdio: "ignore", timeout: 1_000 });
    } else {
      execFileSync("which", [binary], { stdio: "ignore", timeout: 1_000 });
    }
    return true;
  } catch {
    return false;
  }
}
