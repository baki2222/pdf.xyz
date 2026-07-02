/**
 * Public entry point for client telemetry. UI code imports the high-level
 * {@link reportClientError} / {@link reportWebVital} and {@link isTelemetryEnabled}
 * from here rather than reaching into the transport or redactor directly.
 *
 * The whole layer is privacy-safe and presence-gated: with no endpoint
 * configured it is inert (see `./config`), and every payload is scrubbed of
 * file names, handoff tokens, and token-bearing URLs before it can leave the
 * browser (see `./redact`).
 */

export {
  getTelemetryConfig,
  isTelemetryEnabled,
  resolveTelemetryConfig,
  TELEMETRY_ENDPOINT_ENV,
  TELEMETRY_SAMPLE_RATE_ENV,
  type TelemetryConfig,
} from "./config";

export {
  buildErrorReport,
  buildWebVitalReport,
  reportClientError,
  reportWebVital,
  shouldSend,
  type ClientErrorContext,
  type ClientErrorKind,
  type ClientErrorReport,
  type WebVitalMetric,
  type WebVitalReport,
} from "./reporter";

export { redactText, redactUrl, redactValue, REDACTED } from "./redact";
