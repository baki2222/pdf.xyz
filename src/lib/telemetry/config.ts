/**
 * Presence-only configuration for client telemetry.
 *
 * Mirrors the honest, presence-only env pattern used by the worker layer
 * (`@/lib/jobs/config`): telemetry is **off** unless a deployment explicitly
 * points it at an ingest endpoint. When unset, every reporter call no-ops — no
 * beacons, no console noise, no dead cross-origin requests. This keeps the
 * default build (and the e2e suite that exercises it) completely quiet.
 *
 * The endpoint is intentionally a `NEXT_PUBLIC_` variable: the browser must read
 * it to send a beacon, so it is public by nature and is NOT a secret (unlike the
 * server-only `PDFXYZ_*` worker variables, which must never be `NEXT_PUBLIC_`).
 * Only a same-origin path or an absolute http(s) URL is accepted; anything else
 * is ignored and telemetry stays disabled. If the endpoint is cross-origin, the
 * deployment must also add its origin to the CSP `connect-src` — `next.config`
 * does this automatically from the same variable at build time.
 *
 * `resolveTelemetryConfig` is pure and takes raw strings, so every branch is
 * unit-testable; `getTelemetryConfig` is the thin wrapper that reads the two
 * `process.env.NEXT_PUBLIC_*` members as static expressions (required for Next's
 * build-time inlining — a dynamic `env[name]` lookup would not be replaced).
 */

/** The public endpoint a deployment points telemetry at (unset ⇒ disabled). */
export const TELEMETRY_ENDPOINT_ENV = "NEXT_PUBLIC_TELEMETRY_ENDPOINT";
/** Optional 0–1 sampling rate; unset ⇒ 1 (report everything that is enabled). */
export const TELEMETRY_SAMPLE_RATE_ENV = "NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE";

export interface TelemetryConfig {
  /** True only when a valid endpoint is present AND the sample rate is > 0. */
  enabled: boolean;
  /** The validated ingest endpoint (same-origin path or absolute URL), or null. */
  endpoint: string | null;
  /** Fraction of events to send, clamped to [0, 1]. Defaults to 1. */
  sampleRate: number;
}

const DISABLED: TelemetryConfig = { enabled: false, endpoint: null, sampleRate: 0 };

/** Accept only a same-origin path (`/…`) or an absolute http(s) URL. */
function normalizeEndpoint(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  // Same-origin path: covered by CSP `connect-src 'self'`, always safe.
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null; // not a URL and not a path → ignore, stay disabled
  }
}

/** Parse a 0–1 sample rate; unparseable ⇒ 1, out-of-range ⇒ clamped. */
function normalizeSampleRate(raw: string | undefined): number {
  if (typeof raw !== "string" || raw.trim().length === 0) return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * Derive the telemetry config from raw env strings. Pure and injectable so the
 * enabled/disabled, endpoint-validation, and sampling rules are all testable.
 */
export function resolveTelemetryConfig(
  endpoint: string | undefined,
  sampleRate?: string | undefined,
): TelemetryConfig {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) return { ...DISABLED };
  const rate = normalizeSampleRate(sampleRate);
  return { enabled: rate > 0, endpoint: normalized, sampleRate: rate };
}

/**
 * The active telemetry config for this build. Reads the two `NEXT_PUBLIC_*`
 * members as static expressions so Next inlines them at build time; with neither
 * set (the default), telemetry is disabled and all reporters no-op.
 */
export function getTelemetryConfig(): TelemetryConfig {
  return resolveTelemetryConfig(
    process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT,
    process.env.NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE,
  );
}

/** Convenience: is client telemetry configured and active in this build? */
export function isTelemetryEnabled(): boolean {
  return getTelemetryConfig().enabled;
}
