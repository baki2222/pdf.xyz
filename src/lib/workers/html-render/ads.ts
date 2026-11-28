/**
 * "Hide common ads" (Webpage to PDF, audit wave 2 webpage-to-pdf#1): exactly
 * what is blocked and hidden, as data the copy is built from and the code
 * the renderer runs. Pure — no Node built-in.
 *
 * Two halves, both only when the option is ticked:
 *   1. REQUESTS. Any request whose host is one of {@link AD_HOSTS}, or a
 *      subdomain of one, is refused by the renderer before it reaches the
 *      network (`native.ts`, through {@link isAdRequestUrl}) — scripts,
 *      frames, images and beacons alike.
 *   2. SLOTS. After the page's time budget and before printing, in an
 *      isolated world, every element matching {@link AD_SELECTORS}, and
 *      every frame whose address is on an ad host, gets an inline
 *      `display: none !important`, so a blocked ad leaves no empty box.
 *
 * It is a SMALL IN-HOUSE LIST of well-known ad companies' servers and the slot
 * markup they ask sites to use, not a third-party filter list (adopting
 * one is a licence decision nobody has made). So it hides COMMON ads, never
 * all of them: an ad served from the site's own host, or from a network
 * not listed, still prints. The copy says "common ads" for that reason.
 */

/**
 * Ad-serving hosts, by the company that runs them (review of
 * webpage-to-pdf#1, 2026-11-28: the copy once said "18 of the largest ad
 * networks", counting host names; Google runs four of them). The copy names
 * {@link AD_EXAMPLE_COMPANIES} from here and states no count.
 */
export const AD_COMPANIES: readonly {
  name: string;
  hosts: readonly string[];
}[] = [
  {
    name: "Google",
    hosts: [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "adservice.google.com",
    ],
  },
  { name: "Amazon", hosts: ["amazon-adsystem.com"] },
  { name: "Taboola", hosts: ["taboola.com"] },
  { name: "Criteo", hosts: ["criteo.com", "criteo.net"] },
  { name: "Microsoft (Xandr)", hosts: ["adnxs.com"] },
  { name: "Outbrain", hosts: ["outbrain.com"] },
  { name: "PubMatic", hosts: ["pubmatic.com"] },
  { name: "Magnite", hosts: ["rubiconproject.com"] },
  { name: "OpenX", hosts: ["openx.net"] },
  { name: "The Trade Desk", hosts: ["adsrvr.org"] },
  { name: "Index Exchange", hosts: ["casalemedia.com"] },
  { name: "Equativ", hosts: ["smartadserver.com"] },
  { name: "Teads", hosts: ["teads.tv"] },
];

/** The companies the copy names as examples: the first four of the table. */
export const AD_EXAMPLE_COMPANIES: readonly string[] = AD_COMPANIES.slice(
  0,
  4,
).map((c) => c.name);

/** Ad-serving hosts. A request to one of these, or a subdomain, is refused. */
export const AD_HOSTS: readonly string[] = AD_COMPANIES.flatMap((c) => c.hosts);

/** The slot markup the listed networks ask a page to carry. */
export const AD_SELECTORS: readonly string[] = [
  "ins.adsbygoogle",
  '[id^="google_ads_iframe"]',
  '[id^="div-gpt-ad"]',
  "[data-ad-slot]",
  "[data-ad-client]",
  "[data-google-query-id]",
  ".trc_rbox_container",
  ".OUTBRAIN",
  ".ad-slot",
  ".advertisement",
];

/** True when `host` is one of {@link AD_HOSTS} or a subdomain of one. */
export function isAdHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return AD_HOSTS.some((ad) => h === ad || h.endsWith(`.${ad}`));
}

/** True when `url` parses and its host is an ad host. Never throws. */
export function isAdRequestUrl(url: string): boolean {
  try {
    return isAdHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The expression the renderer evaluates. Returns how many elements it hid,
 * by rule, so a test can see which rule fired.
 */
export const HIDE_ADS_SCRIPT = `(() => {
  const SELECTORS = ${JSON.stringify(AD_SELECTORS)};
  const HOSTS = ${JSON.stringify(AD_HOSTS)};
  const adHost = (h) => {
    h = String(h || "").toLowerCase();
    return HOSTS.some((a) => h === a || h.endsWith("." + a));
  };
  const hide = (el) => el.style.setProperty("display", "none", "important");
  let slots = 0;
  for (const selector of SELECTORS) {
    let found = [];
    try { found = document.querySelectorAll(selector); } catch { found = []; }
    for (const el of found) { hide(el); slots += 1; }
  }
  let frames = 0;
  for (const el of document.querySelectorAll("iframe[src], frame[src]")) {
    let host = "";
    try { host = new URL(el.getAttribute("src"), location.href).hostname; } catch { host = ""; }
    if (adHost(host)) { hide(el); frames += 1; }
  }
  return { slots, frames };
})()`;
