"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportWebVital } from "@/lib/telemetry";

/**
 * Reports Core Web Vitals (LCP, CLS, INP, FCP, TTFB, …) through the privacy-safe
 * telemetry reporter. Web Vitals are pure performance measurements — numbers and
 * fixed metric names, never anything document-derived — but the report still
 * runs through the same redaction path for defense in depth.
 *
 * This renders nothing and no-ops unless telemetry is configured. The parent
 * (`app/layout`) only mounts it when {@link isTelemetryEnabled} is true, so an
 * unconfigured build ships zero measurement overhead and sends zero beacons.
 */
export function WebVitals() {
  useReportWebVitals((metric) => reportWebVital(metric));
  return null;
}
