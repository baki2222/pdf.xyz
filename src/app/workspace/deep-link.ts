import type { WorkspaceToolSummary } from "./summary";

/**
 * The tool a `/workspace?tool=<slug>` deep link names — honoured only for a
 * real catalogue tool, so a stale or hand-typed slug opens the plain
 * workspace rather than a card for a tool that does not exist.
 *
 * Read in the browser, not on the server. `workspace/page.tsx` used to await
 * `searchParams` for this one value, which made the route dynamic
 * (`Cache-Control: private, no-store`, a server render per hit and per
 * prefetch) although everything else on it is static. The workspace is
 * client-only state anyway: nothing the server could render depends on it.
 */
export function deepLinkedToolSlug(
  search: string,
  tools: readonly Pick<WorkspaceToolSummary, "slug">[],
): string | undefined {
  const slug = new URLSearchParams(search).get("tool");
  return slug !== null && tools.some((tool) => tool.slug === slug)
    ? slug
    : undefined;
}
