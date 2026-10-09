"use client";

import dynamic from "next/dynamic";

/**
 * The home desk, in a chunk of its own — still rendered on the server, so
 * its markup, its picker and its task links are in the HTML before any
 * script runs.
 *
 * WHY NOT A PLAIN IMPORT. The build files `next/link`'s client chunks under
 * the HOME page's chunk group, so every page that renders a Link from the
 * server — /workspace and the 404 among them — loads the home page's own
 * chunk (read in their client manifests, 2026-10-10). Whatever the home page
 * bundles there, those pages download. Behind this boundary the desk's code
 * is fetched by the home page alone.
 */
export const HeroDeskIsland = dynamic(() =>
  import("./hero-desk").then((mod) => mod.HeroDesk),
);
