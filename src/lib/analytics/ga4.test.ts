// @vitest-environment jsdom
/**
 * The properties that make consent-gated GA4 honest, each pinned:
 *
 *  1. Enabling injects exactly one gtag script and declares the consent
 *     defaults BEFORE config — with every advertising signal denied.
 *  2. Enabling routes `track()` events to gtag, already-redacted.
 *  3. Disabling tells a loaded tag to stop persisting and detaches the sink,
 *     so a `track()` after withdrawal reaches Google exactly never.
 */
import { afterEach, describe, expect, it } from "vitest";
import { track, resetTelemetry } from "@/lib/telemetry/track";
import {
  GA4_MEASUREMENT_ID,
  GTAG_SRC,
  disableGa4,
  enableGa4,
  resetGa4ForTests,
} from "./ga4";

type TestWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};
const win = window as TestWindow;

afterEach(() => {
  resetGa4ForTests();
  resetTelemetry();
  delete win.dataLayer;
  delete win.gtag;
  document
    .querySelectorAll("script[src^='https://www.googletagmanager.com']")
    .forEach((node) => node.remove());
});

describe("enableGa4", () => {
  it("injects the gtag script for the measurement id, exactly once", () => {
    enableGa4();
    enableGa4(); // consent re-affirmed from the privacy page
    const scripts = document.querySelectorAll(`script[src="${GTAG_SRC}"]`);
    expect(scripts).toHaveLength(1);
    expect(GTAG_SRC).toContain(GA4_MEASUREMENT_ID);
  });

  it("declares consent defaults before config, with every ad signal denied", () => {
    enableGa4();
    const calls = win.dataLayer!.map((entry) => Array.from(entry as unknown[]));
    const consentIndex = calls.findIndex((call) => call[0] === "consent");
    const configIndex = calls.findIndex((call) => call[0] === "config");
    expect(consentIndex).toBeGreaterThanOrEqual(0);
    expect(configIndex).toBeGreaterThan(consentIndex);
    expect(calls[consentIndex]![2]).toEqual({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
    expect(calls[configIndex]![1]).toBe(GA4_MEASUREMENT_ID);
  });

  it("routes track() events to gtag with the redacted payload", () => {
    enableGa4();
    const before = win.dataLayer!.length;
    track({
      name: "gated_tool_interest",
      toolSlug: "translate-pdf",
      capability: "ai",
    });
    const pushed = win
      .dataLayer!.slice(before)
      .map((entry) => Array.from(entry as unknown[]));
    expect(pushed).toEqual([
      [
        "event",
        "gated_tool_interest",
        { toolSlug: "translate-pdf", capability: "ai" },
      ],
    ]);
  });
});

describe("disableGa4", () => {
  it("tells a loaded tag to stop persisting, and later events reach it never", () => {
    enableGa4();
    disableGa4();
    const afterDisable = win.dataLayer!.length;
    const updates = win
      .dataLayer!.map((entry) => Array.from(entry as unknown[]))
      .filter((call) => call[0] === "consent" && call[1] === "update");
    expect(updates).toEqual([
      ["consent", "update", { analytics_storage: "denied" }],
    ]);
    track({
      name: "gated_tool_interest",
      toolSlug: "translate-pdf",
      capability: "ai",
    });
    expect(win.dataLayer!.length).toBe(afterDisable);
  });

  it("is a no-op when the tag was never loaded — nothing to stop, nothing pushed", () => {
    disableGa4();
    expect(win.dataLayer).toBeUndefined();
    expect(document.querySelector(`script[src="${GTAG_SRC}"]`)).toBeNull();
  });
});
