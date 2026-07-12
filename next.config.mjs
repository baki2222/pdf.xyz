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
        .filter((value) => /^https:\/\/([*.a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(value))
    : [];
  return ["https://*.r2.cloudflarestorage.com", ...configured].join(" ");
}

function contentSecurityPolicy() {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
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
    `img-src 'self' data: blob:`,
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
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
