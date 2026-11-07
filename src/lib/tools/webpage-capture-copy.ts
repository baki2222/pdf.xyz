/**
 * Webpage to PDF's sentences about its Capture options, built from the
 * labels the panel draws (`@/lib/jobs/webpage-capture-options`) and the list
 * the worker hides (`@/lib/workers/html-render/overlays`), so the tool page
 * and the guide say what the code does, and a consent tool added to or
 * removed from that list reaches the copy.
 *
 * Read off the implementation (2026-11-08):
 *  - the panel: src/components/tools/webpage-capture-options.tsx — a
 *    "Capture" group of checkboxes, url mode only, every default the render
 *    as it was;
 *  - the worker: src/lib/workers/html-render/native.ts runs
 *    HIDE_OVERLAYS_SCRIPT in an isolated world after the page's time budget
 *    and before anything is measured or printed;
 *  - proven on a real Chromium in capture.chromium.test.ts (a OneTrust
 *    banner, a full-screen pop-up and a scroll lock, read back from the PDF).
 */
import {
  OVERLAY_MIN_SHARE,
  WEBPAGE_CAPTURE_LABELS,
  WEBPAGE_CAPTURE_GROUP_LABEL,
} from "@/lib/jobs/webpage-capture-options";
import { CONSENT_MANAGERS } from "@/lib/workers/html-render/overlays";
import { HTML_LAYOUT_STEP } from "@/lib/tools/html-layout-copy";
import { LAZY_SCROLL_MAX_STEPS } from "@/lib/workers/html-render/lazy-scroll";
import { stampDate } from "@/lib/workers/html-render/stamp";

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

const HIDE = WEBPAGE_CAPTURE_LABELS.hideOverlays;
const PRINT = WEBPAGE_CAPTURE_LABELS.printStyles;
const STAMP = WEBPAGE_CAPTURE_LABELS.stamp;

/**
 * What the print adds (audit webpage-to-pdf#7, `@/lib/workers/html-render/
 * stamp`): nothing unless the stamp is ticked; then the footer template the
 * worker prints — the address the job asked for and the time in UTC — with
 * an empty header, so never the page's <title> or page numbers.
 */
export const WEBPAGE_STAMP_SENTENCE = `The PDF carries the page and nothing else unless you tick ${STAMP}: then a line at the foot of every page gives the address you entered and the time it was captured, in UTC, such as ${stampDate(new Date(Date.UTC(2026, 10, 8, 14, 3)))}. pdf.xyz never adds the page's title or page numbers.`;

/** Bookmarks from the headings, on every webpage render (`WEBPAGE_OUTLINE_PARAMS`). */
export const WEBPAGE_OUTLINE_SENTENCE =
  "The page's headings become the PDF's bookmarks, so a long page can be navigated from your PDF reader's bookmark panel.";

/** The privacy consequence of the stamp, for the retention answer. */
export const WEBPAGE_STAMP_RETENTION_SENTENCE = `With ${STAMP} ticked, the address is also printed inside the PDF, and stays there in every copy you keep or share.`;
const SHARE_PCT = Math.round(OVERLAY_MIN_SHARE * 100);

/** The FAQ answer to "Can I hide cookie notices, pop-ups or ads?". */
export const WEBPAGE_OVERLAY_ANSWER = `Cookie notices and pop-ups, usually: tick ${HIDE} under ${WEBPAGE_CAPTURE_GROUP_LABEL}. Before printing, it hides the consent windows of ${CONSENT_MANAGERS.length} widely used cookie-consent tools (${list(CONSENT_MANAGERS.map((m) => m.name))}) and anything pinned to the screen that covers at least ${SHARE_PCT}% of it, unless that holds the page's main content or most of its text, and it turns scrolling back on when a pop-up had locked it. It is off by default because a site can pin real content over the screen too, so glance at the PDF. A small bar pinned to an edge by a tool not on that list stays, and adverts are not removed: the page prints as a new, signed-out visitor sees it.`;

/**
 * What "Use the site's print styles" does (audit webpage-to-pdf#3): on by
 * default, the print as it always was; unticked, native.ts sends
 * `Emulation.setEmulatedMedia {media: "screen"}` before measuring and
 * printing.
 */
export const WEBPAGE_PRINT_STYLES_SENTENCE = `A site that ships a print stylesheet gets that layout while ${PRINT} stays ticked; untick it to print the page with its screen styles, as a browser window shows it.`;

/**
 * The scroll pass (audit webpage-to-pdf#4), from `./lazy-scroll`'s bounds:
 * native.ts scrolls a webpage, never an upload, after its first budget.
 */
export const WEBPAGE_SCROLL_SENTENCE = `Before printing, our server scrolls the page down a screen at a time, up to ${LAZY_SCROLL_MAX_STEPS} screens, and gives it a moment at each stop, so images a site loads only as you scroll usually come in. An endless feed prints only what those ${LAZY_SCROLL_MAX_STEPS} screens load, and a page that scrolls inside a box of its own, rather than as a whole, is not scrolled.`;

/** The how-to sentence for the Capture group. */
export const WEBPAGE_CAPTURE_SENTENCE = `Under ${WEBPAGE_CAPTURE_GROUP_LABEL}, tick ${HIDE} to print the page without a consent banner or a pop-up over it, untick ${PRINT} to get the layout a browser window shows instead of the one the site made for printing, and tick ${STAMP} to record where and when the page was captured.`;

/** The tool page's layout step, with the Capture group added to it. */
export const WEBPAGE_SETTINGS_STEP = {
  title: "Choose the layout and what to capture, if you want",
  body: `${HTML_LAYOUT_STEP.body} ${WEBPAGE_CAPTURE_SENTENCE}`,
};
