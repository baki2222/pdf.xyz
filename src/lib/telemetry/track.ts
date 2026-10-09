/**
 * `track()` — the product-event transport for pdf.xyz.
 *
 * This is the counterpart to the error/Web-Vitals `./reporter`: where that seam
 * carries diagnostics, this one carries *product* events (a tool was viewed, a
 * run completed, a handoff was created — see {@link ProductEvent}). It is the
 * public surface for product analytics; call sites import `track` and the event
 * builders from here.
 *
 * Design goals, in order:
 *  1. **Safe by default.** No sink sends anything off the device. In development
 *     the default sink logs to the console so events are visible while building;
 *     in production and test it is a no-op. No third-party SDK, no network call.
 *  2. **Defense in depth.** Although {@link ProductEvent} is typed to be
 *     privacy-safe, every payload is run through {@link redactValue} before it
 *     reaches a sink, so a careless future field can never leak a filename,
 *     handoff token, or URL. Unknown event names are dropped.
 *  3. **Never breaks the app.** `track` swallows every error — analytics must
 *     not take down a render or a tool run.
 *
 * A real destination (a first-party endpoint, or the same beacon transport the
 * error reporter uses) can be wired later with {@link configureTelemetry}
 * without touching a single call site.
 */

import { redactValue } from "./redact";
import {
  isKnownEventName,
  isToolErrorReason,
  type ProductEvent,
} from "./events";

// Re-export the schema so a call site needs a single import from "@/lib/telemetry/track".
export type { ProductEvent, EventName, ToolErrorReason } from "./events";
export {
  EVENT_NAMES,
  TOOL_ERROR_REASONS,
  isKnownEventName,
  isToolErrorReason,
  toolCompletedEvent,
  toolFailedEvent,
  toolErrorReason,
  handoffCreatedEvent,
} from "./events";
export {
  countBucket,
  sizeBucket,
  durationBucket,
  type CountBucket,
  type SizeBucket,
  type DurationBucket,
} from "./buckets";

/** A payload that has passed name validation and deep redaction. */
export interface RedactedEvent {
  name: string;
  [key: string]: unknown;
}

/** A product-analytics destination. Receives only validated, redacted events. */
export type TelemetrySink = (event: RedactedEvent) => void;

/** Discards every event. The default in production and test. */
export const NOOP_SINK: TelemetrySink = () => {};

/** Minimal console shape a sink needs, so it's injectable under test. */
export interface ConsoleLike {
  debug?: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
}

/**
 * A sink that logs each event to the console under a stable prefix — the default
 * only in development, so events are visible while building locally.
 */
export function createConsoleSink(
  target: ConsoleLike = console,
): TelemetrySink {
  return (event) => {
    (target.debug ?? target.log)?.("[telemetry]", event);
  };
}

/**
 * Resolve the default sink for an environment: a console sink in development,
 * a no-op everywhere else. Injectable so the choice is unit-testable.
 */
export function defaultSinkFor(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  target: ConsoleLike = console,
): TelemetrySink {
  return nodeEnv === "development" ? createConsoleSink(target) : NOOP_SINK;
}

let activeSink: TelemetrySink = defaultSinkFor();
let configured = false;
const configuredListeners = new Set<() => void>();

/**
 * Point product telemetry at a sink, or pass `null` to restore the environment
 * default. The wiring for a real destination lives here; call sites never change.
 */
export function configureTelemetry(sink: TelemetrySink | null): void {
  activeSink = sink ?? defaultSinkFor();
  configured = sink !== null;
  if (!configured) return;
  for (const listener of [...configuredListeners]) {
    try {
      listener();
    } catch {
      // One listener's failure must not stop the others.
    }
  }
}

/** True while a real destination (not the environment default) is set. */
export function isTelemetryConfigured(): boolean {
  return configured;
}

/**
 * Call `listener` each time a real destination is configured; returns the
 * unsubscribe. Exists for events that describe the page itself: GA4 is enabled
 * from the ROOT layout's effect, and React runs a child's effects before its
 * parent's — so on a fresh load a tool page's "viewed" event fired into the
 * no-op default and reached nobody.
 */
export function onTelemetryConfigured(listener: () => void): () => void {
  configuredListeners.add(listener);
  return () => {
    configuredListeners.delete(listener);
  };
}

/** Restore the default sink. Primarily for test isolation. */
export function resetTelemetry(): void {
  activeSink = defaultSinkFor();
  configured = false;
  configuredListeners.clear();
}

/**
 * Validate + redact a product event into a sink-ready payload, or `null` if the
 * event is malformed or its name isn't on the allowlist. Exported for tests and
 * for callers that want to inspect what would be emitted.
 */
export function sanitizeEvent(event: ProductEvent): RedactedEvent | null {
  if (!event || !isKnownEventName((event as { name?: unknown }).name)) {
    return null;
  }
  // The type says a failure reason is one of a fixed few; a sender that got
  // around the type (a cast, a spread of a server payload) must not turn an
  // error message into an analytics field.
  if (
    event.name === "tool_failed" &&
    !isToolErrorReason((event as { reason?: unknown }).reason)
  ) {
    return null;
  }
  const { name, ...rest } = event;
  const redacted = redactValue(rest) as Record<string, unknown>;
  return { name, ...redacted };
}

/**
 * Record a product event. Type-checked against {@link ProductEvent}, redacted as
 * defense in depth, then handed to the active sink. Silently drops malformed
 * events and never throws — a telemetry failure must never reach the user.
 */
export function track(event: ProductEvent): void {
  try {
    const safe = sanitizeEvent(event);
    if (safe) activeSink(safe);
  } catch {
    // Product telemetry is best-effort: swallow everything.
  }
}
