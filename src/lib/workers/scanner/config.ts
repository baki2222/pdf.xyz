/**
 * The **configuration + provider-selection seam** for the malware scanner: given an
 * environment, it decides which scanner a worker should wire, parses and bounds a
 * ClamAV endpoint's connection knobs, and resolves an honest, presence-only
 * readiness the operator tooling reports.
 *
 * One scanner backend ships in this build — ClamAV/clamd over INSTREAM (`./clamav`).
 * It is OPTIONAL by default: with nothing declared the seam resolves `not-configured`
 * and the honest no-op runs (nothing is scanned, and nothing is ever *reported* as
 * scanned). An operator opts in by pointing {@link MALWARE_SCANNER_ENV} at a clamd
 * endpoint, and mandates it with {@link MALWARE_SCAN_REQUIRED_ENV} (the same flag the
 * `require-scan` guardrail reads).
 *
 * Presence-only & content-free: {@link resolveScannerReadiness} reports only which
 * of four honest states applies — `disabled`, `not-configured`, `ready`
 * (configured with a usable endpoint), or `unavailable` (selected but its endpoint
 * config is missing/malformed, so it cannot connect) — plus whether scanning is
 * required. It NEVER echoes the endpoint host, port, socket path, or any value. This
 * is Node-free: it parses config but opens no socket (that is `./clamav-transport`,
 * wired by the Node runtime in `./node`).
 */

import type { FieldError } from "@/lib/jobs";

type EnvSource = Record<string, string | undefined>;

/** The variable an operator points at a clamd endpoint (a value, never logged). */
export const MALWARE_SCANNER_ENV = "PDFXYZ_MALWARE_SCANNER";

/** The flag that makes scanning REQUIRED (shared with the `require-scan` guardrail). */
export const MALWARE_SCAN_REQUIRED_ENV = "PDFXYZ_WORKER_REQUIRE_SCAN";

/** ClamAV connection knobs (names only; values are read to connect, never surfaced). */
export const CLAMAV_ENV = {
  /** Per-scan deadline in ms (bounded). */
  timeoutMs: "PDFXYZ_CLAMAV_TIMEOUT_MS",
  /** Hard client-side size ceiling in bytes (bounded). */
  maxBytes: "PDFXYZ_CLAMAV_MAX_BYTES",
} as const;

/** Default clamd TCP port. */
export const CLAMAV_DEFAULT_PORT = 3310;

/** Safe defaults + bounds for the connection knobs. */
export const CLAMAV_TIMEOUT_MS_DEFAULT = 30_000;
const CLAMAV_TIMEOUT_MS_MIN = 1_000;
const CLAMAV_TIMEOUT_MS_MAX = 600_000; // 10 min — a generous ceiling.
export const CLAMAV_MAX_BYTES_DEFAULT = 26_214_400; // 25 MiB — clamd's classic StreamMaxLength.
const CLAMAV_MAX_BYTES_MIN = 1;
const CLAMAV_MAX_BYTES_MAX = 1_073_741_824; // 1 GiB — a sane upper bound for a stream.

/** Values that explicitly turn the scanner OFF (case-insensitive). */
const DISABLE_TOKENS = new Set(["disabled", "disable", "off", "none", "false", "no", "0"]);

/** Truthy tokens for the required flag (matches the guardrail layer's set). */
const TRUE_TOKENS = new Set(["true", "1", "yes", "on"]);

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when a boolean env flag holds a recognized truthy token. */
function flagOn(env: EnvSource, name: string): boolean {
  const raw = read(env, name)?.toLowerCase();
  return raw !== undefined && TRUE_TOKENS.has(raw);
}

/** Where clamd listens: a TCP host/port, or a Unix domain socket path. */
export type ClamavEndpointConfig =
  | { readonly host: string; readonly port: number }
  | { readonly socketPath: string };

/** A fully-parsed, bounded ClamAV configuration the scanner/transport consume. */
export interface ClamavConfig {
  readonly endpoint: ClamavEndpointConfig;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/** Parse result for {@link parseClamavConfig}: a valid config or field-level issues. */
export type ClamavConfigResult =
  | { readonly ok: true; readonly config: ClamavConfig }
  | { readonly ok: false; readonly issues: FieldError[] };

/** Which scanner an environment selects, before its config is validated. */
export type ScannerProviderToken =
  | "unset" // nothing declared
  | "disabled" // explicitly turned off
  | "clamav" // a clamd endpoint scheme was declared (parse it)
  | "unrecognized"; // a value that names no supported scheme/provider

/** The honest, presence-only malware-scan state (never claims a scan happened). */
export type MalwareScanState =
  | "disabled" // explicitly turned off by the operator
  | "not-configured" // nothing declared (the safe default)
  | "ready" // a scanner is configured with a usable endpoint
  | "unavailable"; // selected, but its endpoint config is missing/malformed

/** Presence-only readiness of malware scanning. Content-free; names no value. */
export interface MalwareScanReadiness {
  /** True ONLY in `ready` — a scanner is configured and inputs are actually scanned. */
  readonly active: boolean;
  readonly state: MalwareScanState;
  /** Whether an operator has mandated scanning ({@link MALWARE_SCAN_REQUIRED_ENV}). */
  readonly required: boolean;
  /** One-line, content-free explanation. Never names a variable, endpoint, or value. */
  readonly detail: string;
}

/** The clamd endpoint schemes this build understands (single-variable URLs). */
const TCP_SCHEME = "clamav";
const UNIX_SCHEMES = new Set(["clamav+unix", "unix"]);

/** Classify the declared scanner value into a {@link ScannerProviderToken}. */
export function scannerProviderToken(env: EnvSource = process.env): ScannerProviderToken {
  const raw = read(env, MALWARE_SCANNER_ENV);
  if (raw === undefined) return "unset";
  if (DISABLE_TOKENS.has(raw.toLowerCase())) return "disabled";
  const sep = raw.indexOf("://");
  if (sep > 0) {
    const scheme = raw.slice(0, sep).toLowerCase();
    if (scheme === TCP_SCHEME || UNIX_SCHEMES.has(scheme)) return "clamav";
  }
  return "unrecognized";
}

/** Parse `host` or `host:port` (incl. bracketed IPv6) into a bounded endpoint. */
function parseTcpAuthority(
  rest: string,
): { host: string; port: number } | undefined {
  let host: string;
  let portText: string | undefined;
  if (rest.startsWith("[")) {
    // IPv6 literal: [::1] or [::1]:3310
    const close = rest.indexOf("]");
    if (close < 0) return undefined;
    host = rest.slice(1, close);
    const after = rest.slice(close + 1);
    if (after.startsWith(":")) portText = after.slice(1);
    else if (after.length > 0) return undefined;
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon >= 0) {
      host = rest.slice(0, colon);
      portText = rest.slice(colon + 1);
    } else {
      host = rest;
    }
  }
  if (host.length === 0 || /[\s/]/.test(host)) return undefined;
  let port = CLAMAV_DEFAULT_PORT;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) return undefined;
    port = Number(portText);
    if (port < 1 || port > 65535) return undefined;
  }
  return { host, port };
}

/** Parse the declared endpoint value into a {@link ClamavEndpointConfig}. */
function parseEndpoint(raw: string): ClamavEndpointConfig | undefined {
  const sep = raw.indexOf("://");
  if (sep <= 0) return undefined;
  const scheme = raw.slice(0, sep).toLowerCase();
  const rest = raw.slice(sep + 3);
  if (scheme === TCP_SCHEME) return parseTcpAuthority(rest);
  if (UNIX_SCHEMES.has(scheme)) {
    // A Unix socket path must be absolute and free of NULs.
    if (!rest.startsWith("/") || rest.includes("\0")) return undefined;
    return { socketPath: rest };
  }
  return undefined;
}

/** Parse a bounded integer knob; pushes a field issue (never the value) on failure. */
function parseBoundedInt(
  env: EnvSource,
  name: string,
  fallback: number,
  min: number,
  max: number,
  issues: FieldError[],
): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  if (!/^\d{1,19}$/.test(raw)) {
    issues.push({ field: name, message: "must be a non-negative integer." });
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    issues.push({ field: name, message: `must be between ${min} and ${max}.` });
    return fallback;
  }
  return value;
}

/**
 * Parse the full ClamAV configuration from the environment. Returns a bounded
 * {@link ClamavConfig} or a list of content-free {@link FieldError}s (variable names
 * only, never values). Presence-only for the endpoint: a missing/malformed endpoint
 * is an issue, but its value is never echoed.
 */
export function parseClamavConfig(env: EnvSource = process.env): ClamavConfigResult {
  const issues: FieldError[] = [];
  const raw = read(env, MALWARE_SCANNER_ENV);
  const endpoint = raw !== undefined ? parseEndpoint(raw) : undefined;
  if (endpoint === undefined) {
    issues.push({
      field: MALWARE_SCANNER_ENV,
      message:
        "must be a clamd endpoint (clamav://host[:port] or clamav+unix:///path).",
    });
  }
  const timeoutMs = parseBoundedInt(
    env,
    CLAMAV_ENV.timeoutMs,
    CLAMAV_TIMEOUT_MS_DEFAULT,
    CLAMAV_TIMEOUT_MS_MIN,
    CLAMAV_TIMEOUT_MS_MAX,
    issues,
  );
  const maxBytes = parseBoundedInt(
    env,
    CLAMAV_ENV.maxBytes,
    CLAMAV_MAX_BYTES_DEFAULT,
    CLAMAV_MAX_BYTES_MIN,
    CLAMAV_MAX_BYTES_MAX,
    issues,
  );
  if (endpoint === undefined || issues.length > 0) return { ok: false, issues };
  return { ok: true, config: { endpoint, timeoutMs, maxBytes } };
}

const NOT_CONFIGURED_DETAIL =
  "Malware scanning is not configured; an optional ClamAV/clamd scanner can be enabled and deployed, but until it is, uploads are not scanned (and are never reported as scanned).";
const DISABLED_DETAIL =
  "Malware scanning is explicitly disabled; uploads are not scanned. This is stated honestly rather than silently assumed.";
const READY_DETAIL =
  "A ClamAV/clamd malware scanner is configured with a usable endpoint; inputs are streamed to the daemon and scanned before processing.";
const UNAVAILABLE_DETAIL =
  "A malware scanner is selected but its endpoint configuration is missing or malformed, so it cannot connect; uploads would not be scanned.";

/**
 * Resolve the honest, presence-only malware-scan readiness for an environment.
 * Deterministic; `env` injectable. `active` is true ONLY in `ready`. Content-free:
 * it reflects whether a scanner is configured and whether scanning is required,
 * never the endpoint value.
 */
export function resolveScannerReadiness(
  env: EnvSource = process.env,
): MalwareScanReadiness {
  const required = flagOn(env, MALWARE_SCAN_REQUIRED_ENV);
  const token = scannerProviderToken(env);
  let state: MalwareScanState;
  let detail: string;
  switch (token) {
    case "unset":
      state = "not-configured";
      detail = NOT_CONFIGURED_DETAIL;
      break;
    case "disabled":
      state = "disabled";
      detail = DISABLED_DETAIL;
      break;
    case "clamav":
      if (parseClamavConfig(env).ok) {
        state = "ready";
        detail = READY_DETAIL;
      } else {
        state = "unavailable";
        detail = UNAVAILABLE_DETAIL;
      }
      break;
    case "unrecognized":
      state = "unavailable";
      detail = UNAVAILABLE_DETAIL;
      break;
  }
  return { active: state === "ready", state, required, detail };
}
