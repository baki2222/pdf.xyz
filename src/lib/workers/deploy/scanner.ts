/**
 * Presence-only **malware-scanner honesty**.
 *
 * This build ships NO malware scanner. That is a deliberate, load-bearing honesty
 * boundary: the worker never claims an uploaded file was scanned, because nothing
 * scans it. This module exists so operator tooling can state that plainly and
 * distinguish the two honest situations an operator must not confuse:
 *  - `not-configured`: no scanner is declared at all; and
 *  - `declared-not-implemented`: an operator has pointed an env var at a scanner,
 *    but this build still ships no scanner runner — so scanning is STILL not
 *    happening. Setting the variable does not (and must not) make the app pretend.
 *
 * In every case `active` is `false`. When a real scanner processor is genuinely
 * wired behind the worker in a later phase, this is where its presence-only
 * readiness would light up — never before. Node-free; names no variable or value.
 */

type EnvSource = Record<string, string | undefined>;

/** The environment variable an operator would point at a scanner (name only). */
export const MALWARE_SCANNER_ENV = "PDFXYZ_MALWARE_SCANNER";

/** The honest scanner state. `active` is always false in this build. */
export type MalwareScanState = "not-configured" | "declared-not-implemented";

/** Presence-only readiness of malware scanning. Never claims a file was scanned. */
export interface MalwareScanReadiness {
  /**
   * Whether files are actually scanned. ALWAYS `false` in this build — there is no
   * scanner runner, so no upload is ever scanned regardless of configuration.
   */
  readonly active: false;
  readonly state: MalwareScanState;
  /** One-line, content-free explanation. Never names a variable or value. */
  readonly detail: string;
}

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the honest malware-scan readiness. Presence-only: it checks whether the
 * scanner variable is *present*, never reads its value, and reports `active: false`
 * in both states because this build ships no scanner. `env` is injectable.
 */
export function resolveMalwareScanReadiness(
  env: EnvSource = process.env,
): MalwareScanReadiness {
  const declared = read(env, MALWARE_SCANNER_ENV) !== undefined;
  if (declared) {
    return {
      active: false,
      state: "declared-not-implemented",
      detail:
        "A malware scanner is declared, but this build ships no scanner runner, so uploads are NOT scanned. The app never claims a file was scanned when it was not.",
    };
  }
  return {
    active: false,
    state: "not-configured",
    detail:
      "Malware scanning is not configured and not implemented in this build; uploads are not scanned. This is called out honestly rather than silently assumed.",
  };
}
