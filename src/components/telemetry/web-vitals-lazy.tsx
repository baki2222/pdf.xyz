"use client";

import dynamic from "next/dynamic";

/**
 * `<WebVitals>` behind its own chunk. The root layout mounts it only when a
 * telemetry endpoint is configured, but a client component a server layout
 * IMPORTS is bundled into the layout's entry whether or not it renders — so
 * Next's web-vitals library (~3 KB gz) rode every page's first load on a
 * build with telemetry off, to register nothing.
 *
 * `ssr: false` because it renders nothing; when it does mount, it loads after
 * hydration. The metrics are still complete: web-vitals observes with
 * `buffered: true`, so LCP, CLS, FCP and TTFB entries recorded before the
 * chunk arrived are delivered when it subscribes.
 */
export const LazyWebVitals = dynamic(
  () => import("./web-vitals").then((m) => m.WebVitals),
  { ssr: false },
);
