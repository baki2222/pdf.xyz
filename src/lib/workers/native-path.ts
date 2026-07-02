/**
 * Presence-only PATH resolution, shared by every native worker engine.
 *
 * This is the one primitive the compression and OCR native layers agree on: does
 * a command exist as an executable file on this host? It reads the *presence* of
 * a binary on `PATH` — it never executes it, never reads its version, and never
 * returns a path. Kept in its own tiny Node-only module so both engines depend on
 * exactly one implementation instead of each re-deriving PATHEXT handling.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

/** Resolves whether a binary exists on the host. Presence only; never executes. */
export type BinaryResolver = (binary: string) => boolean;

/**
 * Presence-only resolver: is `binary` an executable file on PATH? Never runs it.
 * Handles Windows PATHEXT so the probe is correct cross-platform.
 */
export function resolveOnPath(binary: string): boolean {
  const pathVar = process.env.PATH ?? "";
  if (pathVar.length === 0) return false;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir.length === 0) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return true;
      } catch {
        // Unreadable PATH entry — treat as absent and keep looking.
      }
    }
  }
  return false;
}
