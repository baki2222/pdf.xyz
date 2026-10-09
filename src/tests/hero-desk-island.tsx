/**
 * The home desk for the unit-test renderer: the desk itself, with no
 * `next/dynamic` boundary in front of it.
 *
 * WHY. In production the hero renders the desk through `next/dynamic`
 * (`src/components/intent/hero-desk-island.tsx`), so its code ships in a
 * chunk only the home page loads; Next resolves that boundary while it
 * server-renders, and the desk's markup is in the HTML. Outside Next —
 * `renderToStaticMarkup`, `prerender`, Testing Library — the boundary renders
 * NOTHING (measured 2026-10-10: an empty `<div>` where the desk stands), and
 * every test that reads the rendered home page would silently lose the desk's
 * words, its picker and its task links: a guard over the author's artifact,
 * reading less than the reader receives.
 *
 * So `vitest.config.ts` resolves the island to this module for every test
 * file alike (an alias, not a per-file mock, which `isolate: false` could
 * leak between files). What the boundary itself does is held where it can
 * be seen: the built home page loads the desk's chunk, found by content, and
 * no other page does (`bundle-budget.test.ts`, the desk-island exemption),
 * and the e2e specs drive the desk through the real server render.
 */
export { HeroDesk as HeroDeskIsland } from "@/components/intent/hero-desk";
