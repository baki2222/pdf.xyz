import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { siteConfig } from "@/lib/site";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { WebVitals } from "@/components/telemetry/web-vitals";
import { isTelemetryEnabled } from "@/lib/telemetry";
import { cn } from "@/lib/utils";
import "./globals.css";

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
  themeColor: "#060611",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(GeistSans.variable, GeistMono.variable)}
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
      <body className="min-h-dvh bg-ink font-sans text-slate-200 antialiased">
        <a
          href="#main"
          className="sr-only rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100]"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        {/* Privacy-safe Web Vitals — only mounted when a telemetry endpoint is
            configured; otherwise this is not rendered and ships no listener. */}
        {isTelemetryEnabled() && <WebVitals />}
      </body>
    </html>
  );
}
