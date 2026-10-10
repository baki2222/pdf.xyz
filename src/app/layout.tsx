import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { twitterAttribution } from "@/lib/seo";
import { siteConfig } from "@/lib/site";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { WebVitals } from "@/components/telemetry/web-vitals";
import { ConsentBanner } from "@/components/analytics/consent-banner";
import { Ga4Gate } from "@/components/analytics/ga4-gate";
import { LiveRegion } from "@/components/a11y/live-region";
import { HandoffSweep } from "@/components/layout/handoff-sweep";
import { isTelemetryEnabled } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import "./globals.css";

/**
 * The display voice of the prepress redesign: a grotesque with real bone
 * structure for headlines, against Geist Sans for UI and Geist Mono for the
 * data and annotations. The serif retired with the cream palette — a PDF is
 * a produced artefact, not a novel.
 *
 * WAS `next/font/google`, which the comment here described as "self-hosted at
 * build time, so no runtime font request leaves the page" — true of the PAGE,
 * and the reason nobody noticed what it cost the BUILD: every `next build`
 * downloaded the face from fonts.googleapis.com. On 2026-09-27 the production
 * publish for PR #162 failed inside `nextFontGoogleFontLoader` with
 * `TypeError: Cannot read properties of null (reading '1')` — Google answered
 * the runner with something other than the CSS Next's parser expects — and a
 * merged, CI-green commit did not ship. Every deploy of this site depended on
 * a third party answering one request correctly.
 *
 * Now read from `@fontsource-variable/bricolage-grotesque`, pinned in the
 * lockfile like the Noto faces: the same Google Fonts face (Fontsource mirrors
 * it; the Latin file is 40 KB, the same size production was fetching), one
 * variable file covering every weight, and no network at build time.
 * `layout-fonts.test.ts` fails if a `next/font/google` import comes back.
 */
const displayFace = localFont({
  src: "../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-display-face",
  display: "swap",
  // See "Fallback faces" in globals.css. next/font's own Arial fallback (one
  // size-adjust per face, from the file's average glyph width) set these
  // headings 7.0% wide, and the swap re-wrapped them.
  adjustFontFallback: false,
  fallback: ['"pdfxyz Display Fallback"'],
});

/**
 * Geist, from the `geist` package's own files, declared here rather than
 * imported as `GeistSans`/`GeistMono`. The package's declarations fix their
 * fallbacks: Sans takes next/font's single Arial face (4.1% wide on our
 * body text), and Mono takes none. Both now swap in over the measured,
 * per-weight faces in globals.css, which e2e/font-fallback.spec.ts holds
 * to the real faces' widths.
 */
const GeistSans = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-sans",
  display: "swap",
  adjustFontFallback: false,
  fallback: ['"pdfxyz Sans Fallback"'],
});

const GeistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-geist-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ['"pdfxyz Mono Fallback"'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.creator }],
  creator: siteConfig.creator,
  publisher: siteConfig.creator,
  // NO `alternates.canonical`, NO `openGraph.url` and NO `robots` here — this
  // object is inherited by every route that does not override a key, and the
  // one route that never overrides them is the 404. It WAS
  // `alternates: { canonical: "/" }` plus `robots: { index: true, ... }`, so
  // production's https://pdf.xyz/tools/nope answered 404 with
  // `<link rel="canonical" href="https://pdf.xyz"/>`, the home page's title,
  // and `index, follow` beside Next's own `noindex` — every dead URL declared
  // itself a duplicate of the home page. A page's identity is per page:
  // `buildMetadata({ path })` sets canonical, og:url and robots for every
  // page, and `not-found.tsx` declares its own. `not-found-metadata.test.ts`
  // fails if any layout puts these back.
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    ...twitterAttribution(),
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  // The canvas tokens, per scheme — the prepress bench since 2026-08-28.
  // These MUST track --sf-canvas in globals.css: the browser paints this
  // colour behind overscroll and in the tab strip, and a mismatched pair
  // reads as a flash of the previous design on every rubber-band scroll.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1014" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(
        GeistSans.variable,
        GeistMono.variable,
        displayFace.variable,
      )}
      /**
       * We ship `html { scroll-behavior: smooth }` for in-page anchor links.
       * Since Next 16 the router no longer neutralizes that during a route
       * change unless this attribute says to, so every navigation would glide
       * to the top over several hundred ms — the destination page keeps moving
       * under the pointer, and a click landing mid-glide is dropped by the
       * browser (press and release resolve to different elements, so no
       * `click` fires at all). This opts back into an instant navigation
       * scroll and leaves anchor scrolling smooth.
       */
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      {/*
       * No hand-written <head> here. This layout used to render its own
       * <title> alongside the `metadata` export above, so every page below the
       * root shipped TWO title elements — invalid HTML, and the generic brand
       * one came first in the served markup, ahead of the page's real title.
       * `metadata.title.default` covers the root and `.template` wraps every
       * page title, so the export is the single source. See metadata.spec.ts.
       */}
      {/* `.theme-paper` lives here — one application point for the whole app —
          and `:root` shares the token block in globals.css so html-level
          styling (viewport scrollbar, overscroll canvas) resolves the same
          values. Per-route wrappers only carry a scope when they mean to
          CHANGE it (`.theme-ink`). */}
      <body className="theme-paper bg-canvas text-fg min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="bg-invert text-fg-invert sr-only rounded-[3px] px-4 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100]"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        {/* Deletes expired hand-off bytes on every page, on idle — what makes
            the privacy page's hand-off lifetime sentence true. Renders
            nothing; never creates storage for a visitor who has none. */}
        <HandoffSweep />
        {/* The app's single ARIA live region. It lives here, above every route,
            because the one that already existed was rendered inside a runner's
            editor branch and was unmounted by the early return that showed the
            result — silent at the only moment it mattered. */}
        <LiveRegion />
        {/* Privacy-safe Web Vitals — only mounted when a telemetry endpoint is
            configured; otherwise this is not rendered and ships no listener. */}
        {isTelemetryEnabled() && <WebVitals />}
        {/* Consent-first analytics: the banner asks once, the gate acts on the
            stored answer. Until an explicit yes, no analytics code loads and no
            request to any Google origin exists — see src/lib/analytics. */}
        <ConsentBanner />
        <Ga4Gate />
      </body>
    </html>
  );
}
