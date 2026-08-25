/**
 * Google Analytics 4, loaded only after consent — see `./consent.ts` for the
 * stance this module obeys: before "granted" there is no gtag script, no
 * dataLayer traffic, and no request to any Google origin.
 *
 * Once enabled, the existing product-event seam is pointed here:
 * `configureTelemetry` (src/lib/telemetry/track.ts) receives a sink that
 * forwards each validated, REDACTED event to `gtag('event', …)` — so every
 * `track()` call site ships its events to GA4 without changing, and everything
 * GA4 sees has already been through `redactValue` (no filenames, no handoff
 * tokens, no URLs).
 *
 * The measurement id is public by design: it is served in the page source of
 * every consenting visitor, exactly like every other GA4 site. Keeping it a
 * source constant (not a NEXT_PUBLIC_ bake) means `container.yml`'s
 * no-secrets/no-config build stays byte-identical and no CI wiring exists to
 * drift.
 */

import { configureTelemetry } from "@/lib/telemetry/track";

export const GA4_MEASUREMENT_ID = "G-6HV45S85DY";

export const GTAG_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

let enabled = false;

function gtagOn(win: GtagWindow): (...args: unknown[]) => void {
  win.dataLayer = win.dataLayer ?? [];
  win.gtag =
    win.gtag ??
    function gtag(...args: unknown[]) {
      win.dataLayer!.push(args);
    };
  return win.gtag;
}

/**
 * Load gtag.js and route product telemetry to it. Idempotent — consent can be
 * re-affirmed (e.g. from the privacy page) without a second script tag.
 */
export function enableGa4(
  win: GtagWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as GtagWindow),
  doc: Document | undefined = typeof document === "undefined"
    ? undefined
    : document,
): void {
  if (!win || !doc || enabled) return;
  enabled = true;

  const gtag = gtagOn(win);
  // Consent Mode v2 defaults, declared before config: analytics only. The ad
  // signals are denied PERMANENTLY — this product runs no advertising, and no
  // later consent flow exists that could turn them on.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  gtag("js", new Date());
  gtag("config", GA4_MEASUREMENT_ID);

  if (!doc.querySelector(`script[src="${GTAG_SRC}"]`)) {
    const script = doc.createElement("script");
    script.async = true;
    script.src = GTAG_SRC;
    doc.head.appendChild(script);
  }

  configureTelemetry((event) => {
    const { name, ...params } = event;
    gtag("event", name, params);
  });
}

/**
 * Withdrawn consent: tell an already-loaded tag to stop persisting, and detach
 * the telemetry sink. If the tag was never loaded this is a no-op — there is
 * nothing to stop.
 */
export function disableGa4(
  win: GtagWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as GtagWindow),
): void {
  if (enabled && win?.gtag) {
    win.gtag("consent", "update", { analytics_storage: "denied" });
  }
  enabled = false;
  configureTelemetry(null);
}

/** Test-only: forget the enabled latch without touching any window. */
export function resetGa4ForTests(): void {
  enabled = false;
  configureTelemetry(null);
}
