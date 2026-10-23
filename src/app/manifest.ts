import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

/**
 * Web App Manifest — makes pdf.xyz installable and gives the browser proper
 * name/theme metadata. Icons: a scalable SVG (the favicon's rounded tile)
 * plus 192/512 PNGs generated at build time from the shared brand mark (see
 * src/app/manifest-icon-*.png) — the Folded P on a petrol ground that runs to
 * every edge, the P inside the 80% safe circle, so the 512 is a true maskable
 * icon and not the rounded tile cropped by a launcher's mask.
 *
 * `theme_color` is the brand petrol, as the phone browser's toolbar is
 * (2026-10-23): an installed app's title bar is the same bar. It WAS the
 * canvas, when `theme-palette-copies.test.ts` bound every chrome colour to
 * `--sf-canvas`; that test now holds a toolbar to the petrol and a
 * background (the splash) to the canvas.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${siteConfig.name} — ${siteConfig.tagline}`,
    short_name: siteConfig.shortName,
    description: siteConfig.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // The installed app's splash (`--sf-canvas`, the LIGHT value, because
    // the site is paper-first and a manifest gets one colour, not a media
    // query) and title bar (the brand petrol, as above).
    //
    // WERE `#060611`, the retired near-black of the pre-prepress dark theme,
    // for as long as the redesign has been live: install the PWA and the
    // splash was a colour the site no longer paints anywhere. Nothing caught
    // it — `theme-palette-copies.test.ts` was written the same day and named
    // its three copies by hand; this was the fourth. It now discovers them by
    // the PROPERTY NAME instead, so a file declaring browser chrome cannot
    // opt out by not being on a list.
    background_color: "#f4f6f8",
    theme_color: "#07567a",
    categories: ["productivity", "utilities", "business"],
    lang: "en-US",
    dir: "ltr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/manifest-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/manifest-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/manifest-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
