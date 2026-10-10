/**
 * Where a suggestion goes, and when a click on it is the page's to take.
 *
 * A suggestion is a real link to its tool (`<a href="/tools/merge-pdf">`):
 * without JavaScript, or with a modifier held, it opens the plain tool page,
 * as any link does. Only a plain primary click is taken over — to open the
 * tool WITH the files, which a URL cannot carry. One predicate for every
 * surface that does this (the workspace's suggestions, the ticket), so they
 * cannot disagree about which clicks they own.
 */

/** The tool page a suggestion links to. */
export function toolHref(slug: string): string {
  return `/tools/${encodeURIComponent(slug)}`;
}

/**
 * `/tools`, showing only the tools that take `format` — read in the browser
 * by the explorer (`parseToolsQuery`); the page's canonical stays `/tools`.
 */
export function acceptsHref(format: string): string {
  return `/tools?accepts=${encodeURIComponent(format.toLowerCase())}`;
}

/** What a click reports that decides whose it is. */
export interface ClickLike {
  readonly defaultPrevented: boolean;
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * A plain primary click nothing else handled: the page may open the tool
 * with the files. Anything else — a new tab, a new window, a download, a
 * middle click — is the browser's, and opens the plain page.
 */
export function isPlainClick(event: ClickLike): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
