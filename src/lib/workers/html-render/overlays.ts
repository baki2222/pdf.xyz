/**
 * "Hide cookie notices and pop-ups" (Webpage to PDF, audit webpage-to-pdf#1):
 * exactly what is hidden, as data the copy is built from and the script the
 * renderer runs. Pure — no Node built-in — so the tool page can name the
 * consent tools from the same list the worker hides.
 *
 * Run once, after the page's time budget and before printing, in an isolated
 * world (page scripts cannot redefine what it calls). It hides, with an
 * inline `display: none !important`:
 *   1. the containers of the consent tools in {@link CONSENT_MANAGERS}, by
 *      the element ids and classes those tools render;
 *   2. any `position: fixed` or `sticky` element that covers at least
 *      {@link OVERLAY_MIN_SHARE} of the window — a pop-up or the dimmed
 *      backdrop behind one — UNLESS it holds a `main`, `article` or
 *      `[role=main]` element or more than half of the page's text, so a
 *      site whose whole layout is a fixed full-screen frame keeps it.
 * Then, because consent pop-ups lock scrolling, a vertical `overflow:
 * hidden` (or `clip`) on the root and body is set back to `visible`, so the
 * print is not cut at the first screen. The lock is read from the vertical
 * axis only, so a site's own `overflow-x: hidden` (computed as `hidden auto`)
 * is not mistaken for one; both axes are then reset, because `visible` on
 * one axis beside `hidden` on the other computes to `auto`, and the body
 * stays a one-screen scroll box (capture.chromium.test.ts went red on that).
 *
 * What it does NOT do: block adverts, block any request, or hide a small bar
 * pinned to an edge that is not one of the listed tools. It can still hide
 * real content a site chose to pin over half the screen, which is why the
 * option is off by default.
 */
import { OVERLAY_MIN_SHARE } from "@/lib/jobs/webpage-capture-options";

export { OVERLAY_MIN_SHARE };

export interface ConsentManager {
  /** The product's name, as the tool page lists it. */
  name: string;
  /** CSS selectors for the containers it renders. */
  selectors: readonly string[];
}

export const CONSENT_MANAGERS: readonly ConsentManager[] = [
  {
    name: "OneTrust",
    selectors: ["#onetrust-consent-sdk", "#onetrust-banner-sdk"],
  },
  {
    name: "Cookiebot",
    selectors: ["#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay"],
  },
  { name: "Didomi", selectors: ["#didomi-host", ".didomi-popup-container"] },
  {
    name: "Quantcast Choice",
    selectors: [".qc-cmp2-container", "#qc-cmp2-container"],
  },
  {
    name: "Usercentrics",
    selectors: ["#usercentrics-root", "#usercentrics-cmp-ui"],
  },
  { name: "Google Funding Choices", selectors: [".fc-consent-root"] },
  { name: "Sourcepoint", selectors: ['[id^="sp_message_container_"]'] },
  {
    name: "TrustArc",
    selectors: [
      "#truste-consent-track",
      "#consent_blackbar",
      ".truste_overlay",
      ".truste_box_overlay",
    ],
  },
  { name: "Osano", selectors: [".osano-cm-window", ".osano-cm-dialog"] },
  { name: "Iubenda", selectors: ["#iubenda-cs-banner"] },
  { name: "CookieYes", selectors: [".cky-consent-container", ".cky-overlay"] },
  {
    name: "Complianz",
    selectors: ["#cmplz-cookiebanner-container", ".cmplz-cookiebanner"],
  },
  { name: "Cookie Notice", selectors: ["#cookie-notice"] },
  {
    name: "GDPR Cookie Consent",
    selectors: ["#cookie-law-info-bar", ".cli-modal-backdrop"],
  },
  { name: "cookieconsent.js", selectors: [".cc-window"] },
  { name: "consentmanager", selectors: ["#cmpbox", "#cmpbox2", ".cmpboxBG"] },
  { name: "Borlabs Cookie", selectors: ["#BorlabsCookieBox"] },
  { name: "Termly", selectors: ["#termly-code-snippet-support"] },
];

/** Every selector of {@link CONSENT_MANAGERS}, flat. */
export const CONSENT_SELECTORS: readonly string[] = CONSENT_MANAGERS.flatMap(
  (m) => m.selectors,
);

/**
 * The expression the renderer evaluates. It returns how many elements it
 * hid, by rule, so a test can see which rule fired.
 */
export const HIDE_OVERLAYS_SCRIPT = `(() => {
  const SELECTORS = ${JSON.stringify(CONSENT_SELECTORS)};
  const SHARE = ${OVERLAY_MIN_SHARE};
  const hidden = new Set();
  const hide = (el) => {
    el.style.setProperty("display", "none", "important");
    hidden.add(el);
  };
  const isHidden = (el) => {
    for (let n = el; n; n = n.parentElement) if (hidden.has(n)) return true;
    return false;
  };
  let consent = 0;
  for (const selector of SELECTORS) {
    let found = [];
    try { found = document.querySelectorAll(selector); } catch { found = []; }
    for (const el of found) if (!isHidden(el)) { hide(el); consent += 1; }
  }
  const body = document.body;
  const pageText = body ? (body.textContent || "").trim().length : 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  let overlays = 0;
  if (body && vw > 0 && vh > 0) {
    for (const el of body.querySelectorAll("*")) {
      if (isHidden(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (w * h < vw * vh * SHARE) continue;
      if (el.querySelector("main, article, [role=main]")) continue;
      if ((el.textContent || "").trim().length * 2 > pageText) continue;
      hide(el);
      overlays += 1;
    }
  }
  let unlocked = 0;
  for (const el of [document.documentElement, body]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (/hidden|clip/.test(cs.overflowY)) {
      el.style.setProperty("overflow", "visible", "important");
      unlocked += 1;
    }
  }
  return { consent, overlays, unlocked };
})()`;
