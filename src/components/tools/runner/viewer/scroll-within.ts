/**
 * Scroll `container`, and only `container`, so that `el` is in its view:
 * vertically to the `block` position, horizontally to the nearest edge.
 *
 * Not `el.scrollIntoView()`: that scrolls EVERY scrollable ancestor,
 * including the window. With the viewer partly below the fold, following
 * the current page in the thumbnail list moved the whole web page ~345 px
 * under a reader scrolling the pages, and revealing a search match pushed
 * the search field off screen (review, 2026-11-10).
 */
export function scrollWithin(
  container: HTMLElement,
  el: HTMLElement,
  block: "nearest" | "center",
): void {
  const box = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // The container's own view, inside its borders.
  const top = box.top + container.clientTop;
  const left = box.left + container.clientLeft;
  const height = container.clientHeight;
  const width = container.clientWidth;
  let dy = 0;
  if (block === "center") {
    dy = r.top + r.height / 2 - (top + height / 2);
  } else if (r.top < top) {
    dy = r.top - top;
  } else if (r.bottom > top + height) {
    dy = Math.min(r.bottom - (top + height), r.top - top);
  }
  let dx = 0;
  if (r.left < left) dx = r.left - left;
  else if (r.right > left + width) {
    dx = Math.min(r.right - (left + width), r.left - left);
  }
  if (dy !== 0) container.scrollTop += dy;
  if (dx !== 0) container.scrollLeft += dx;
}
