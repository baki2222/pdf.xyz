/**
 * Analytics consent — the switch everything else in `src/lib/analytics` obeys.
 *
 * The product's privacy stance is consent-first in the strictest sense: no
 * analytics code LOADS, and no request to Google leaves the browser, until the
 * visitor has pressed "Allow analytics" (Google calls this *basic* consent
 * mode — the tag simply is not there before consent, as opposed to *advanced*
 * mode, which loads the tag and sends cookieless pings to Google anyway).
 * Decline — or say nothing — and the network tab stays empty forever.
 *
 * The decision lives in localStorage under {@link CONSENT_STORAGE_KEY} so the
 * banner asks exactly once per browser. `null` means "never answered", and the
 * server snapshot is always `null` — during SSR and hydration the decision is
 * genuinely unknown, and rendering the friendlier of two unverified claims
 * there is the bug #50 already paid for on the upload disclosure.
 */

import { useSyncExternalStore } from "react";
import { CONSENT_STORAGE_KEY } from "./consent-key";

/** A decision the visitor actually made. Absence of one is `null`, never a default. */
export type AnalyticsConsent = "granted" | "denied";

export { CONSENT_STORAGE_KEY };

/** Same-tab change notifications (the `storage` event only fires cross-tab). */
const CONSENT_EVENT = "pdfxyz:analytics-consent";

function isConsent(value: unknown): value is AnalyticsConsent {
  return value === "granted" || value === "denied";
}

/** The stored decision, or `null` when the visitor has not answered (or storage is unavailable). */
export function readStoredConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return isConsent(raw) ? raw : null;
  } catch {
    return null; // Private mode / blocked storage: treat as undecided, load nothing.
  }
}

/** Record a decision and wake every subscriber in this tab. */
export function storeConsent(decision: AnalyticsConsent): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, decision);
  } catch {
    // Storage refused the write: subscribers still hear the in-memory decision
    // for this page view; the banner will ask again next visit.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
}

/** Subscribe to consent changes from this tab and others. Returns the unsubscribe. */
export function subscribeToConsent(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONSENT_STORAGE_KEY) onChange();
  };
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The visitor's decision as React state: `"granted"`, `"denied"`, or `null`
 * while unknown — which includes the entire server render, so nothing
 * consent-gated can ever appear in served HTML.
 */
export function useAnalyticsConsent(): AnalyticsConsent | null {
  return useSyncExternalStore(
    subscribeToConsent,
    readStoredConsent,
    () => null,
  );
}
