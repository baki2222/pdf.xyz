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

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

const HIDE = WEBPAGE_CAPTURE_LABELS.hideOverlays;
const SHARE_PCT = Math.round(OVERLAY_MIN_SHARE * 100);

/** The FAQ answer to "Can I hide cookie notices, pop-ups or ads?". */
export const WEBPAGE_OVERLAY_ANSWER = `Cookie notices and pop-ups, usually: tick ${HIDE} under ${WEBPAGE_CAPTURE_GROUP_LABEL}. Before printing, it hides the consent windows of ${CONSENT_MANAGERS.length} widely used cookie-consent tools (${list(CONSENT_MANAGERS.map((m) => m.name))}) and anything pinned to the screen that covers at least ${SHARE_PCT}% of it, unless that holds the page's main content or most of its text, and it turns scrolling back on when a pop-up had locked it. It is off by default because a site can pin real content over the screen too, so glance at the PDF. A small bar pinned to an edge by a tool not on that list stays, and adverts are not removed: the page prints as a new, signed-out visitor sees it.`;

/** The how-to sentence for the Capture group. */
export const WEBPAGE_CAPTURE_SENTENCE = `Under ${WEBPAGE_CAPTURE_GROUP_LABEL}, tick ${HIDE} to print the page without a consent banner or a pop-up over it; left unticked, the page prints as a new visitor first sees it.`;

/** The tool page's layout step, with the Capture group added to it. */
export const WEBPAGE_SETTINGS_STEP = {
  title: "Choose the layout and what to capture, if you want",
  body: `${HTML_LAYOUT_STEP.body} ${WEBPAGE_CAPTURE_SENTENCE}`,
};
