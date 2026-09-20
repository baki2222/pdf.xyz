import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { siteConfig } from "@/lib/site";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { WebVitals } from "@/components/telemetry/web-vitals";
import { ConsentBanner } from "@/components/analytics/consent-banner";
import { Ga4Gate } from "@/components/analytics/ga4-gate";
import { LiveRegion } from "@/components/a11y/live-region";
import { isTelemetryEnabled } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import "./globals.css";

/**
 * The display voice of the prepress redesign: a grotesque with real bone
 * structure for headlines, against Geist Sans for UI and Geist Mono for the
 * data and annotations. The serif retired with the cream palette — a PDF is
 * a produced artefact, not a novel. Self-hosted at build time by next/font,
 * so no runtime font request leaves the page.
 */
const displayFace = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display-face",
  display: "swap",
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
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    creator: "@pdfxyz",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
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
