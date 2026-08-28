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
 *  - connect-src R2 origin: secure-worker uploads PUT directly to short-lived R2
 *    signed URLs, so the browser must be allowed to connect to Cloudflare's R2
 *    S3 endpoint. This is still narrow (R2 only), not a wildcard internet policy.
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
  // Deduped: the configured value legitimately repeats the built-in R2
  // wildcard (production sets exactly that string), and a CSP listing an
  // origin twice is valid but reads as a mistake to anyone auditing the
  // header — which is the audience this directive exists for.
  return [
    ...new Set(["https://*.r2.cloudflarestorage.com", ...configured]),
  ].join(" ");
}

function contentSecurityPolicy() {
  // Consent-gated Google Analytics (src/lib/analytics). The CSP allows these
  // origins on every response, but nothing CONTACTS them until the visitor
  // presses "Allow analytics" — the gtag script is injected only then. A CSP
  // cannot express "after consent", so the gate lives in code and this list
  // merely stops being the thing that breaks it.
  const gtagScriptOrigin = "https://www.googletagmanager.com";
  const gaCollectOrigins =
    "https://*.google-analytics.com https://*.analytics.google.com";

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    gtagScriptOrigin,
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

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      {
        // The three files crawlers fetch and users never see. This rule lived
        // in `vercel.json` and stopped applying the moment the site left
        // Vercel — silently, because a dropped cache header changes nothing a
        // visitor can see. Measured on production 2026-08-28, before this:
        // `/sitemap.xml` and `/manifest.webmanifest` served
        // `max-age=0, must-revalidate` with `cf-cache-status: DYNAMIC`, so
        // every crawler hit reached a one-vCPU origin that had already
        // rendered the same bytes.
        //
        // `max-age=0` keeps browsers honest while `s-maxage` lets the edge
        // hold it for a day, and `stale-while-revalidate` means a rebuild
        // never makes a crawler wait. Same values the Vercel file carried, now
        // expressed where the platform we actually run can read them.
        source: "/(robots.txt|sitemap.xml|manifest.webmanifest)",
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
