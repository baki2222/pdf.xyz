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
 * PAGE VIEWS GO THROUGH THE SAME DISCIPLINE, and until 2026-09 they did not.
 * `gtag("config", ID)` with no options sends an automatic page_view whose
 * `page_location` is `location.href` — query string and all — so every
 * workspace → tool launch (`router.push("/tools/x?handoff=<token>")`) shipped
 * its handoff token to Google, while the privacy page promised events are
 * "stripped of filenames, links, and query strings". Now the config sends no
 * page_view, and {@link sendGa4PageView} sends one per route with
 * `page_location` = origin + pathname: no query, no fragment, by construction.
 * (A GA4 web stream can ALSO send history-change page_views from its
 * server-side "Enhanced measurement" setting; that switch lives in the GA4
 * admin, not in code, and must be off.)
 *
 * AND THE EVENTS DID NOT, until 2026-10-10: "everything GA4 sees has been
 * through redactValue" was true of the event's own fields and silent about
 * the `page_location` gtag.js adds to each one from `location.href`. A
 * `tool_viewed` fired on `?handoff=<token>` carried the token (captured at
 * the wire). Every event now carries {@link pageOf}'s query-free location.
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

/** Google's documented hard opt-out: gtag.js sends nothing while this is true. */
export const GA_DISABLE_PROPERTY = `ga-disable-${GA4_MEASUREMENT_ID}`;

/** A URL (or path) reduced to origin + path: no query, no fragment. */
export function withoutQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

function setDisabled(win: GtagWindow, disabled: boolean): void {
  (win as unknown as Record<string, unknown>)[GA_DISABLE_PROPERTY] = disabled;
}

function gtagOn(win: GtagWindow): (...args: unknown[]) => void {
  win.dataLayer = win.dataLayer ?? [];
  if (!win.gtag) {
    /*
     * THE PUSHED VALUE MUST BE AN `arguments` OBJECT, NOT AN ARRAY.
     *
     * gtag.js tells a COMMAND (`consent` / `js` / `config` / `event`) from an
     * ordinary data push by that shape alone. The obvious modern spelling,
     * `(...args) => dataLayer.push(args)`, pushes a real Array — which gtag.js
     * files as data and never executes. Nothing throws. Nothing warns. The
     * network stays silent.
     *
     * MEASURED ON PRODUCTION 2026-09-20, twenty-six days after this shipped:
     * the tag was loaded (`gtag/js?id=G-6HV45S85DY` in the document,
     * `google_tag_data` present) and our three commands were sitting in
     * `dataLayer` — while `google_tag_data.tidr.destination` was EMPTY, not one
     * `/g/collect` request had ever been made, and GA4 itself said "No data
     * received from your website yet". Re-pushing the IDENTICAL `config` as an
     * `arguments` object, in that same live page, fired
     * `www.google-analytics.com/g/collect?v=2&tid=G-6HV45S85DY&gtm=...`
     * immediately. Same command, same page, same session: one difference, the
     * shape.
     *
     * Needing `arguments` is why this is a `function` and not an arrow, and why
     * `ga4.test.ts` asserts the pushed value's shape rather than its contents —
     * the test that shipped with the bug read every entry through
     * `Array.from()`, which normalises an Array and an `arguments` object into
     * the same thing and could not see the only difference that mattered.
     */
    win.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params -- see above: the shape IS the contract
      win.dataLayer!.push(arguments);
    };
  }
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

  // Consent given again after a withdrawal on this same page: lift the hard
  // opt-out, and grant with an UPDATE — gtag.js ignores a `consent default`
  // that arrives after it has initialised, so re-sending the default would
  // leave analytics silently denied.
  setDisabled(win, false);
  const alreadyLoaded = !!doc.querySelector(`script[src="${GTAG_SRC}"]`);

  const gtag = gtagOn(win);
  if (alreadyLoaded) {
    gtag("consent", "update", { analytics_storage: "granted" });
  } else {
    // Consent Mode v2 defaults, declared before config: analytics only. The ad
    // signals are denied PERMANENTLY — this product runs no advertising, and
    // no later consent flow exists that could turn them on.
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted",
    });
  }
  gtag("js", new Date());
  // No automatic page_view: it would report location.href, query included.
  gtag("config", GA4_MEASUREMENT_ID, { send_page_view: false });

  if (!alreadyLoaded) {
    const script = doc.createElement("script");
    script.async = true;
    script.src = GTAG_SRC;
    doc.head.appendChild(script);
  }

  configureTelemetry((event) => {
    const { name, ...params } = event;
    gtag("event", name, { ...params, ...pageOf(win, doc) });
  });
}

/**
 * The page an event happened on, as GA4 is allowed to see it: origin + path,
 * and the referrer the same way. Attached to EVERY product event, because
 * gtag.js fills a missing `page_location` from `location.href`.
 *
 * Until 2026-10-10 the events carried neither, and gtag did exactly that:
 * captured at the wire against a production build, the `tool_viewed` of a
 * workspace hand-off went to Google as
 * `dl=…/tools/sign-pdf?handoff=h_794b80b9…` — the key to a file waiting in
 * that browser — while /privacy promised events were stripped of query
 * strings. Page views were already stripped (`sendGa4PageView`); the events
 * beside them were not.
 */
function pageOf(
  win: GtagWindow,
  doc: Document,
): { page_location: string; page_referrer?: string } {
  const referrer = withoutQuery(doc.referrer ?? "");
  return {
    page_location: `${win.location.origin}${withoutQuery(win.location.pathname) || "/"}`,
    ...(referrer ? { page_referrer: referrer } : {}),
  };
}

/**
 * One page view for the route the visitor is on, with `page_location` built
 * from origin + pathname — never `location.href`. No-op until consent has
 * enabled the tag, so an undecided or declined visitor sends nothing.
 */
export function sendGa4PageView(
  pathname: string,
  win: GtagWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as GtagWindow),
  doc: Document | undefined = typeof document === "undefined"
    ? undefined
    : document,
): void {
  if (!enabled || !win?.gtag || !doc) return;
  const path = withoutQuery(pathname) || "/";
  const referrer = withoutQuery(doc.referrer ?? "");
  // The tag's OWN hits — `user_engagement` when a page is left, and whatever
  // a property's Enhanced Measurement adds — read their location from the
  // tag's page state, which defaults to `location.href`. Setting it here,
  // per route, gives them the same query-free address (review, 2026-10-10).
  // What gtag.js does with it for those hits is Google's code and was not
  // captured at the wire for this change, so /privacy promises "without its
  // query string" only for the page views and events below.
  win.gtag("set", {
    page_location: `${win.location.origin}${path}`,
    page_referrer: referrer,
  });
  win.gtag("event", "page_view", {
    page_location: `${win.location.origin}${path}`,
    page_path: path,
    page_title: doc.title,
    ...(referrer ? { page_referrer: referrer } : {}),
  });
}

/**
 * Delete every `_ga` / `_ga_*` cookie. GA sets them on the registrable domain
 * (`.pdf.xyz`), and a delete only matches a cookie written with the same
 * domain attribute — so each name is expired at every parent domain of the
 * host AND host-only. A level the browser refuses (a public suffix) is a
 * write that does nothing. Returns the names it found.
 */
export function clearGaCookies(doc: Document, hostname: string): string[] {
  const names = doc.cookie
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  const labels = hostname.split(".").filter(Boolean);
  const domains = labels.map((_, i) => `.${labels.slice(i).join(".")}`);
  const expire = "=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  for (const name of names) {
    doc.cookie = `${name}${expire}`;
    for (const domain of domains)
      doc.cookie = `${name}${expire}; domain=${domain}`;
  }
  return names;
}

/**
 * Withdrawn consent. Three things, because each alone falls short:
 *  - Google's documented hard opt-out (`ga-disable-<id>`), which stops a tag
 *    that is already running from sending ANYTHING. A `consent update` to
 *    denied alone leaves it free to send cookieless pings — Google's
 *    "advanced" mode, which `./consent.ts` rejects;
 *  - `consent update` → denied, so it also stops persisting;
 *  - deleting the `_ga` cookies it already wrote — also when the tag never
 *    loaded on this page, since a choice made on an earlier visit left them.
 * The telemetry sink is detached, so `track()` reaches Google exactly never.
 *
 * Until 2026-09 only the second happened, while the privacy page's control
 * told the visitor "nothing is loaded".
 */
export function disableGa4(
  win: GtagWindow | undefined = typeof window === "undefined"
    ? undefined
    : (window as GtagWindow),
  doc: Document | undefined = typeof document === "undefined"
    ? undefined
    : document,
): void {
  if (win) setDisabled(win, true);
  if (enabled && win?.gtag) {
    win.gtag("consent", "update", { analytics_storage: "denied" });
  }
  if (win && doc) clearGaCookies(doc, win.location.hostname);
  enabled = false;
  configureTelemetry(null);
}

/** Test-only: forget the enabled latch without touching any window. */
export function resetGa4ForTests(): void {
  enabled = false;
  configureTelemetry(null);
}
