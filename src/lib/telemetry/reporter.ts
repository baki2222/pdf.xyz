/**
 * Privacy-safe client error + Web-Vitals reporter.
 *
 * This is the ONLY seam that may send data off the device, and it upholds the
 * product promise: it never transmits file bytes, file names, handoff tokens, or
 * a full URL whose query embeds one. Every field of every payload is built by a
 * pure `build*Report` helper that runs it through `./redact` first, so redaction
 * is enforced structurally and unit-tested — not left to careful callers.
 *
 * When telemetry is not configured (the default), every entry point no-ops: no
 * beacon, no fetch, no console output. When it is configured, payloads are sent
 * with `navigator.sendBeacon` (falling back to `fetch(..., {keepalive})`) and any
 * transport error is swallowed — telemetry must never break the app or surface
 * to the user. See `./config` for the presence-only activation model.
 */

import {
  getTelemetryConfig,
  type TelemetryConfig,
} from "./config";
import { redactText, redactUrl, redactValue } from "./redact";

/** Where/how an error was caught, for coarse triage (never user data). */
export type ClientErrorKind =
  | "route" // an App Router route-segment error (error.tsx)
  | "global" // a root error that took out the layout (global-error.tsx)
  | "boundary" // a React error boundary in the tree
  | "unhandled" // window 'error' / 'unhandledrejection'
  | "manual"; // an explicitly reported, handled error

export interface ClientErrorContext {
  /** Fixed label of the catch site, e.g. "tool-runner". Not user-derived. */
  boundary?: string;
  /** Next.js error digest (an opaque hash), when available. */
  digest?: string;
  /** Extra diagnostic keys; deep-scrubbed by {@link redactValue} before send. */
  extra?: Record<string, unknown>;
}

/** A single Web Vital as emitted by `next/web-vitals` (structurally typed). */
export interface WebVitalMetric {
  id: string;
  name: string;
  value: number;
  label?: string;
  rating?: string;
  delta?: number;
  navigationType?: string;
}

export interface ClientErrorReport {
  type: "error";
  kind: ClientErrorKind;
  name: string;
  message: string;
  stack?: string;
  digest?: string;
  boundary?: string;
  /** Origin + pathname only — never the query string (which may hold a token). */
  url: string;
  ts: number;
  extra?: Record<string, unknown>;
}

export interface WebVitalReport {
  type: "web-vital";
  name: string;
  id: string;
  value: number;
  rating?: string;
  delta?: number;
  navigationType?: string;
  url: string;
  ts: number;
}

/** Ambient facts about the browser, injected so builders stay pure/testable. */
export interface ReportEnv {
  now: number;
  /** The raw current URL; redacted to origin+path inside the builder. */
  url: string;
}

const MAX_STACK_CHARS = 1600;

/** Coarse `name` for a thrown value that may not be an `Error`. */
function errorName(error: unknown): string {
  if (error instanceof Error && typeof error.name === "string" && error.name) {
    return error.name;
  }
  return typeof error;
}

function errorMessageText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/** A safe, opaque digest string if the error/context carries one. */
function digestOf(error: unknown, context?: ClientErrorContext): string | undefined {
  if (context?.digest) return String(context.digest);
  if (error && typeof error === "object" && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") return digest;
  }
  return undefined;
}

/**
 * Build a fully-redacted error report. Pure: no DOM, no clock, no network — the
 * caller supplies `now`/`url`. The message, stack, URL, and extra are all passed
 * through the redactor here, so the transport can never emit a raw value.
 */
export function buildErrorReport(
  error: unknown,
  kind: ClientErrorKind,
  context: ClientErrorContext | undefined,
  env: ReportEnv,
): ClientErrorReport {
  const rawStack =
    error instanceof Error && typeof error.stack === "string"
      ? error.stack
      : undefined;
  const report: ClientErrorReport = {
    type: "error",
    kind,
    name: redactText(errorName(error)),
    message: redactText(errorMessageText(error)),
    url: redactUrl(env.url),
    ts: env.now,
  };
  if (rawStack) report.stack = redactText(rawStack).slice(0, MAX_STACK_CHARS);
  const digest = digestOf(error, context);
  if (digest) report.digest = redactText(digest);
  if (context?.boundary) report.boundary = redactText(context.boundary);
  if (context?.extra) {
    const scrubbed = redactValue(context.extra);
    if (scrubbed && typeof scrubbed === "object") {
      report.extra = scrubbed as Record<string, unknown>;
    }
  }
  return report;
}

/** Build a redacted Web-Vitals report. Metrics carry only numbers + enum-ish
 *  strings, but ids/urls are still scrubbed for defense in depth. */
export function buildWebVitalReport(
  metric: WebVitalMetric,
  env: ReportEnv,
): WebVitalReport {
  const report: WebVitalReport = {
    type: "web-vital",
    name: redactText(String(metric.name)),
    id: redactText(String(metric.id)),
    value: Number.isFinite(metric.value) ? metric.value : 0,
    url: redactUrl(env.url),
    ts: env.now,
  };
  if (metric.rating) report.rating = redactText(String(metric.rating));
  if (Number.isFinite(metric.delta)) report.delta = metric.delta;
  if (metric.navigationType) {
    report.navigationType = redactText(String(metric.navigationType));
  }
  return report;
}

/** Decide whether an event should be sent, given config + a sampling roll. */
export function shouldSend(config: TelemetryConfig, roll: number): boolean {
  if (!config.enabled || !config.endpoint) return false;
  if (config.sampleRate >= 1) return true;
  return roll < config.sampleRate;
}

// ── Injectable seams (tests only), matching the repo's __set*ForTests idiom ──

/** A transport delivers a serialized payload to the endpoint. */
export type TelemetryTransport = (endpoint: string, body: string) => void;

let configOverride: TelemetryConfig | null = null;
let transportOverride: TelemetryTransport | null = null;

/** Override the active config in tests (null restores env-derived config). */
export function __setTelemetryConfigForTests(config: TelemetryConfig | null): void {
  configOverride = config;
}
/** Override the transport in tests (null restores the beacon/fetch default). */
export function __setTelemetryTransportForTests(
  transport: TelemetryTransport | null,
): void {
  transportOverride = transport;
}

function activeConfig(): TelemetryConfig {
  return configOverride ?? getTelemetryConfig();
}

/** The default transport: sendBeacon when available, else keepalive fetch. */
function defaultTransport(endpoint: string, body: string): void {
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
    if (typeof fetch === "function") {
      void fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        // Telemetry is best-effort; don't let it hold up navigation.
        mode: "cors",
      }).catch(() => {});
    }
  } catch {
    // A blocked beacon / thrown fetch must never surface — swallow it.
  }
}

/** Serialize + deliver a report if telemetry is enabled and the sample passes. */
function dispatch(report: ClientErrorReport | WebVitalReport): void {
  const config = activeConfig();
  if (!shouldSend(config, Math.random()) || !config.endpoint) return;
  let body: string;
  try {
    body = JSON.stringify(report);
  } catch {
    return; // non-serializable payload → drop rather than throw
  }
  (transportOverride ?? defaultTransport)(config.endpoint, body);
}

/** Best-effort browser env snapshot for a report; SSR-safe. */
function currentEnv(): ReportEnv {
  const url =
    typeof window !== "undefined" && window.location
      ? window.location.href
      : "";
  return { now: Date.now(), url };
}

/**
 * Report a client error. Fire-and-forget and exception-proof: builds a redacted
 * payload and sends it only when telemetry is configured; otherwise no-ops.
 */
export function reportClientError(
  error: unknown,
  kind: ClientErrorKind = "manual",
  context?: ClientErrorContext,
): void {
  try {
    const config = activeConfig();
    if (!config.enabled) return; // fast path: nothing configured → do nothing
    dispatch(buildErrorReport(error, kind, context, currentEnv()));
  } catch {
    // Reporting must never throw into the app.
  }
}

/** Report a single Web Vital. No-ops unless telemetry is configured. */
export function reportWebVital(metric: WebVitalMetric): void {
  try {
    const config = activeConfig();
    if (!config.enabled) return;
    dispatch(buildWebVitalReport(metric, currentEnv()));
  } catch {
    // Never throw from a metrics callback.
  }
}
