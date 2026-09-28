/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== "production";

/**
 * The cross-origin telemetry endpoint's origin, for `connect-src`, or "" when
 * telemetry is unset or same-origin. Presence-only: the value is inspected just
 * enough to extract an origin and is never otherwise read, logged, or exposed.
 */
function telemetryConnectSrc() {
  const raw = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT?.trim();
  if (!raw || raw.startsWith("/")) return ""; // unset or same-origin ('self' covers it)
  try {
    const { origin, protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:" ? origin : "";
  } catch {
    return "";
  }
}

/**
 * Content-Security-Policy, tuned for a Next.js (App Router / SSG) app whose PDF
 * pipeline runs entirely in the browser via pdfjs-dist.
 *
 * Why each non-obvious source is here:
 *  - script-src 'unsafe-inline': Next injects inline bootstrap/flight scripts
 *    into statically-rendered HTML. Without per-request nonces (which don't
 *    survive full static generation) these need 'unsafe-inline'. Tightening
 *    this to a nonce-based policy is tracked in SECURITY.md.
 *  - 'wasm-unsafe-eval': pdfjs v6 decodes some images (JPEG2000/JBIG2) with
 *    WebAssembly, which requires this to instantiate.
 *  - worker-src 'self' blob:: the pdfjs worker is bundled locally (same-origin);
 *    blob: covers browsers that spin the worker up from a blob.
 *  - img-src blob: data:: rendered page thumbnails become blob/data URLs.
 *  - 'unsafe-eval' (dev only): React Fast Refresh evaluates modules in dev.
 *  - connect-src telemetry origin: when (and only when) NEXT_PUBLIC_TELEMETRY_ENDPOINT
 *    points at a cross-origin URL, that origin is allowlisted so the privacy-safe
 *    beacon isn't blocked.
 *  - connect-src storage origin: secure-worker uploads PUT directly to
 *    short-lived signed URLs, so the browser must be allowed to connect to the
 *    storage endpoint — EXACTLY the origin(s) the deployment names in
 *    NEXT_PUBLIC_STORAGE_CONNECT_SRC, and nothing this file adds on its own.
 *    Until 2026-09 it added `https://*.r2.cloudflarestorage.com` itself, and a
 *    comment here called that "narrow (R2 only)". It is every R2 account in
 *    existence: a page script that got injected could PUT stolen document data
 *    into its own bucket, and the CSP would wave it through. Name the account:
 *    `https://<account>.r2.cloudflarestorage.com` (+ `https://*.<account>…`
 *    for virtual-hosted buckets). publish.yml refuses to build without it.
 */
function storageConnectSrc() {
  const extra = process.env.NEXT_PUBLIC_STORAGE_CONNECT_SRC?.trim();
  const configured = extra
    ? extra
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter((value) =>
          /^https:\/\/([*.a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(value),
        )
    : [];
  // Deduped: a CSP listing an origin twice is valid but reads as a mistake to
  // anyone auditing the header — which is the audience this directive exists
  // for.
  return [...new Set(configured)].join(" ");
}

function contentSecurityPolicy() {
  // Consent-gated Google Analytics (src/lib/analytics). The CSP allows these
  // origins on every response, but nothing CONTACTS them until the visitor
  // presses "Allow analytics" — the gtag script is injected only then. A CSP
  // cannot express "after consent", so the gate lives in code and this list
  // merely stops being the thing that breaks it.
  const gtagScriptOrigin = "https://www.googletagmanager.com";
  // script-src gets the gtag PATH, not the host. The whole host also serves
  // `gtm.js?id=GTM-<anyone>` — any Tag Manager container, including an
  // attacker's — which is a known CSP bypass that survives even removing
  // 'unsafe-inline'. A source ending in "/" matches that path prefix, so this
  // allows gtag/js (and gtag/destination, which gtag.js may chain-load) and
  // refuses /gtm.js. `src/deploy/csp-sources.test.ts` pins that GTAG_SRC is
  // covered and gtm.js is not.
  const gtagScriptPath = `${gtagScriptOrigin}/gtag/`;
  const gaCollectOrigins =
    "https://*.google-analytics.com https://*.analytics.google.com";

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    gtagScriptPath,
    isDev ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Same-origin in production, plus the narrow storage endpoint needed for direct
  // signed uploads. Dev adds the HMR websocket. A configured, cross-origin
  // telemetry endpoint (if any) contributes exactly its origin.
  const connectSrc = [
    "'self'",
    storageConnectSrc(),
    gaCollectOrigins,
    gtagScriptOrigin,
    isDev ? "ws: wss:" : "",
    telemetryConnectSrc(),
  ]
    .filter(Boolean)
    .join(" ");

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    // The GA origins appear here too: gtag falls back to image pings where
    // fetch/beacon is unavailable, and a fallback the CSP blocks would drop
    // consented measurements silently.
    `img-src 'self' data: blob: ${gaCollectOrigins}`,
    `font-src 'self' data:`,
    `worker-src 'self' blob:`,
    `media-src 'self' blob:`,
    `connect-src ${connectSrc}`,
    `manifest-src 'self'`,
    // Only meaningful over HTTPS; would break http://localhost in dev.
    isDev ? "" : "upgrade-insecure-requests",
  ].filter(Boolean);

  return directives.join("; ");
}

/**
 * Security headers applied to every response. These harden the app without
 * touching the client-side PDF pipeline.
 */
function securityHeaders() {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: [
        "accelerometer=()",
        "autoplay=()",
        "browsing-topics=()",
        "camera=()",
        "display-capture=()",
        "geolocation=()",
        "gyroscope=()",
        "interest-cohort=()",
        "microphone=()",
        "payment=()",
        "usb=()",
      ].join(", "),
    },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  // HSTS only matters (and should only be sent) over HTTPS in production.
  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

/**
 * The one origin every URL lives on. `www.<apex>` is a proxied CNAME of the
 * apex (docs/DEPLOYMENT.md §4), so the app sees both hosts — and until this
 * rule it answered both with 200, the whole site served twice with only the
 * canonical tag saying which copy counts. Measured 2026-09-27:
 * `https://www.pdf.xyz/tools/merge-pdf` → `200 OK`.
 *
 * `src/deploy/www-redirect.test.ts` derives the www host from
 * `siteConfig.url` and runs this rule through Next's own route matcher, so a
 * domain change that updates one and not the other fails there, not in
 * Search Console.
 */
const CANONICAL_ORIGIN = "https://pdf.xyz";
const WWW_HOST_PATTERN = "www\\.pdf\\.xyz";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Nothing renders through next/image (thumbnails are pre-rendered blobs), so
  // the optimizer endpoint is attack surface with no user: production answered
  // `GET /_next/image?url=%2Ffavicon.ico&w=64&q=75` with 200 while Next carried
  // an unauthenticated RCE in that optimizer (GHSA-2xp9-vwfh-vxw4). With
  // `unoptimized` the server 404s the route before reading a parameter —
  // `src/deploy/dependency-floors.test.ts` pins that against the installed Next.
  images: { unoptimized: true },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async redirects() {
    return [
      {
        // Every path, query string preserved (Next carries it over). The host
        // value is a regex Next anchors, hence the escaped dots. `permanent`
        // → 308: a temporary redirect is a weaker consolidation signal, which
        // is the whole point of this rule. Next exempts `/_next/*` from
        // redirects; nothing links to www assets once no www page is served.
        source: "/:path*",
        has: [{ type: "host", value: WWW_HOST_PATTERN }],
        destination: `${CANONICAL_ORIGIN}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      {
        // The crawler files served from the app's metadata routes (plus the
        // sitemap index, whose Route Handler also sets this itself). This rule
        // lived in `vercel.json` and stopped applying the moment the site left
        // Vercel — silently, because a dropped cache header changes nothing a
        // visitor can see. Measured on production 2026-08-28, before this:
        // `/sitemap.xml` and `/manifest.webmanifest` served
        // `max-age=0, must-revalidate` with `cf-cache-status: DYNAMIC`, so
        // every crawler hit reached a one-vCPU origin that had already
        // rendered the same bytes.
        //
        // What this header does and does not decide. `s-maxage` gives the
        // edge a day and `stale-while-revalidate` means a rebuild never makes
        // a crawler wait — both honoured by Cloudflare, but ONLY for paths its
        // Cache Rule "crawler files: edge-cacheable" makes eligible
        // (docs/DEPLOYMENT.md §2). `max-age=0` is what the ORIGIN asks of
        // browsers, and it is not what browsers get: measured 2026-09-27,
        // every path in that Cache Rule was served `max-age=14400`, while
        // `/sitemaps/pages.xml` (not in the rule, `DYNAMIC`) was served its
        // origin `max-age=0` unchanged — so Cloudflare rewrites the browser
        // TTL on exactly the paths it caches. Until the owner sets that
        // rule's Browser TTL to "Respect origin" (an override scoped to these
        // paths, whether the 4h comes from the rule or the zone default),
        // browsers hold these files for four hours.
        source:
          "/(robots.txt|sitemap.xml|sitemap-index.xml|manifest.webmanifest)",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        // pdfjs's image decoders AND character maps, copied into public/ under a
        // version-stamped
        // path by scripts/copy-pdfjs-wasm.ts. The version is IN the URL, so the
        // bytes at a given URL never change and this can be immutable — a pdfjs
        // bump lands on a new path rather than poisoning a cached one. Without
        // this rule Next serves public/ as `max-age=0, must-revalidate`, and a
        // decoder would be revalidated on every document that needs it.
        source: "/pdfjs-:kind(wasm|cmaps)/:version/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The Noto faces the text tools embed, copied into public/ under a
        // version-stamped path by scripts/copy-noto-fonts.ts. Same argument as
        // above, with a much bigger number attached: the Chinese face is
        // 10.5 MB, and Next's default for public/ is
        // `max-age=0, must-revalidate` — so without this rule a user who
        // watermarks two Chinese documents pays a revalidation round-trip on
        // every one, and any cache in front of us re-fetches the whole file on
        // a stale 200. The version is in the URL, so the bytes at a given path
        // never change.
        source: "/fonts/:version/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
