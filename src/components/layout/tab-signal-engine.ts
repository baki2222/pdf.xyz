import { subscribeActivity } from "@/lib/activity/bus";
import { tileSvg } from "@/lib/brand";

/** A run shorter than this ended before anyone looked away (spec C.2). */
export const TAB_SIGNAL_MIN_MS = 3000;

const DONE = "Done · ";
const ATTENTION = "Needs attention · ";

/** The page's SVG icon link — the one a tab shows. */
const iconLink = () =>
  document.head.querySelector<HTMLLinkElement>(
    'link[rel~="icon"][type="image/svg+xml"]',
  );

/**
 * The tab icon of a run that finished while nobody watched: the favicon
 * itself — the Folded P on its petrol tile, drawn by `tileSvg` from the same
 * module `icon.svg` restates — with a ring in its lower corner: a dot in the
 * page's accent, set off from the tile by the page's canvas. The ring's
 * colours are the page's own tokens, read at run time, so none is typed here.
 *
 * WAS the accent square on an ink ground with a ring round it — the retired
 * registration mark, so a finished run swapped the tab to a mark the site no
 * longer used.
 */
function signalIcon(): string {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--sf-accent").trim() || "currentColor";
  const canvas = style.getPropertyValue("--sf-canvas").trim() || "transparent";
  const ring =
    `<circle cx="102" cy="102" r="22" fill="${accent}" ` +
    `stroke="${canvas}" stroke-width="10"/>`;
  return `data:image/svg+xml,${encodeURIComponent(tileSvg("favicon", ring))}`;
}

/**
 * A hidden tab says when its work is done (spec C.2). When a run of at least
 * {@link TAB_SIGNAL_MIN_MS} ends while the tab is hidden, the title gains
 * "Done · " (or "Needs attention · " for a failure) and the tab's icon gains
 * a ring. Shown again, both are put back exactly as they were. Reads only
 * the activity bus, and nothing leaves the tab. Returns the stop.
 */
export function startTabSignal(): () => void {
  let saved: { title: string; icon: string | null } | null = null;

  const restore = () => {
    if (!saved) return;
    const prefix = document.title.startsWith(DONE)
      ? DONE
      : document.title.startsWith(ATTENTION)
        ? ATTENTION
        : "";
    // A page that changed its own title meanwhile keeps it, unmarked.
    document.title = prefix ? document.title.slice(prefix.length) : saved.title;
    const link = iconLink();
    if (link && saved.icon !== null) link.setAttribute("href", saved.icon);
    saved = null;
  };

  const off = subscribeActivity((activity) => {
    if (activity.state !== "done" && activity.state !== "failed") return;
    if (document.visibilityState !== "hidden") return;
    if ((activity.ranMs ?? 0) < TAB_SIGNAL_MIN_MS) return;
    const link = iconLink();
    saved ??= {
      title: document.title,
      icon: link?.getAttribute("href") ?? null,
    };
    document.title =
      (activity.state === "done" ? DONE : ATTENTION) + saved.title;
    link?.setAttribute("href", signalIcon());
  });

  const onVisibility = () => {
    if (document.visibilityState === "visible") restore();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    off();
    document.removeEventListener("visibilitychange", onVisibility);
    restore();
  };
}
