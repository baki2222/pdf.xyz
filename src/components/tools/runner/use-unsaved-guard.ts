"use client";

import { useEffect } from "react";
import { confirmLeave, registerDirty } from "@/lib/intent/unsaved";
import { useToolRun } from "./tool-context";

/**
 * Hold edits a visitor would lose: while `dirty`, the work is registered
 * (`@/lib/intent/unsaved`), so every surface that would throw it away asks
 * first — a file dropped on the editor, a launch from the ticket, the
 * palette or "Continue with" — and so does the page itself:
 *
 *  - leaving by a LINK on the page (the header, the footer, a related tool):
 *    one capture-phase listener on the document asks before the router or
 *    the browser sees the click, and a "Stay" stops both;
 *  - leaving any other way (reload, close, the address bar): the browser's
 *    own `beforeunload` prompt, the only one a page may show there.
 *
 * Both listeners exist only while something is dirty, so a page with
 * nothing unsaved navigates exactly as before. `what` is the work, as the
 * question names it, and the page's tool is added: "your markups in
 * Annotate PDF".
 */
export function useUnsavedGuard(dirty: boolean, what: string): void {
  const tool = useToolRun()?.name;
  const label = tool ? `${what} in ${tool}` : what;
  useEffect(() => {
    if (!dirty) return;
    const release = registerDirty(label);
    holders += 1;
    if (holders === 1) listen(true);
    return () => {
      release();
      holders -= 1;
      if (holders === 0) listen(false);
    };
  }, [dirty, label]);
}

/** Editors holding unsaved work right now; the listeners follow the count. */
let holders = 0;

function listen(on: boolean): void {
  if (on) {
    document.addEventListener("click", onLinkClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
  } else {
    document.removeEventListener("click", onLinkClick, true);
    window.removeEventListener("beforeunload", onBeforeUnload);
  }
}

/**
 * A click on a same-page-origin link that would navigate this tab. Anything
 * the browser opens elsewhere (a modifier, a new tab, a download) leaves
 * the work where it is and is not asked about.
 */
function onLinkClick(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  if (link.hasAttribute("download")) return;
  if (link.target && link.target !== "_self") return;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  // A jump within this page (`#…`) leaves nothing behind.
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    url.hash !== ""
  )
    return;
  if (confirmLeave()) {
    // Agreed: a link that leaves the document (not the app's router) must
    // not be asked about again by the browser's prompt a moment later.
    leftAt = Date.now();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

/** When a link's leave was agreed to, so `beforeunload` does not ask again. */
let leftAt = 0;

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (Date.now() - leftAt < 2000) return;
  event.preventDefault();
  // Still required by some browsers for the prompt to show.
  event.returnValue = "";
}
