import { useLayoutEffect, useState } from "react";

/**
 * Keep what a reader typed into a server-rendered textarea before React
 * hydrated.
 *
 * Text to PDF and Markdown to PDF render their box on the server, so on a slow
 * phone it accepts typing before the client bundle runs. React then hydrates
 * the box as a controlled `value=""` and wipes the words: measured 2026-10-24,
 * the box empty after hydration and "Create PDF" making nothing.
 *
 * The words are read DURING the first client render (hydration), while the DOM
 * still holds them, into a state value that is never rendered — not into the
 * rendered text: a first render that differs
 * from the server's (its character count, say) is a hydration mismatch, React
 * error #418, and React re-renders the boundary from scratch with the words
 * already gone. The typed text is handed to `adopt` once hydration commits.
 *
 * `id` must be the textarea's own id from `useId()`, which is identical on the
 * server and the client.
 */
export function usePreHydrationText(
  id: string,
  adopt: (text: string) => void,
): void {
  // A lazy state initialiser runs once, during the first client render: the
  // one moment the DOM still holds the typed words. Never rendered, so it
  // cannot make the hydration differ from the server's markup.
  const [early] = useState(() => {
    if (typeof document === "undefined") return "";
    const el = document.getElementById(id);
    return el instanceof HTMLTextAreaElement ? el.value : "";
  });
  useLayoutEffect(() => {
    const typed = early;
    if (typed) adopt(typed);
    // Mount only: the window is the first client render, never again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
