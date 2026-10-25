"use client";

/**
 * HTML to PDF and Webpage to PDF's page layout: page size, orientation,
 * margins, screen width and "one long page". Every value comes from
 * `@/lib/jobs/html-render-options`, the list the job API and the worker
 * validate against, so the menu cannot offer what the worker refuses.
 */
import {
  HTML_MARGINS,
  HTML_ONE_PAGE_MAX_INCHES,
  HTML_ORIENTATIONS,
  HTML_PAGE_SIZES,
  HTML_VIEWPORTS,
  htmlPrintGeometry,
  type HtmlMargin,
  type HtmlOrientation,
  type HtmlPageSize,
  type HtmlRenderOptions,
  type HtmlViewport,
} from "@/lib/jobs/html-render-options";

const SELECT =
  "border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none";

/** The sentence under the controls: what the chosen layout will do. */
export function htmlLayoutNote(options: HtmlRenderOptions): string | null {
  const notes: string[] = [];
  const g = htmlPrintGeometry(options);
  const screen = HTML_VIEWPORTS.find((v) => v.id === options.viewport);
  if (screen?.width) {
    notes.push(
      g.scaleClamped
        ? `This paper is too ${g.scale < 1 ? "narrow" : "wide"} to fit a ${screen.width}px screen: the page is laid out ${Math.round(g.layoutWidthPx)}px wide instead.`
        : `The page is laid out as on a ${screen.width}px-wide screen, then scaled to fit the paper.`,
    );
  }
  if (options.onePage)
    notes.push(
      `One long page: the PDF is a single page as tall as the content, up to ${HTML_ONE_PAGE_MAX_INCHES} inches; anything longer continues on more pages.`,
    );
  if (!g.preferCSSPageSize && options.pageSize === "auto")
    notes.push("The paper is Letter, whatever page size the page asks for.");
  return notes.length > 0 ? notes.join(" ") : null;
}

export function HtmlRenderLayoutOptions({
  value,
  onChange,
  disabled,
}: {
  value: HtmlRenderOptions;
  onChange: (next: HtmlRenderOptions) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof HtmlRenderOptions>(
    key: K,
    v: HtmlRenderOptions[K],
  ) => onChange({ ...value, [key]: v });
  const note = htmlLayoutNote(value);
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-fg text-xs font-medium">Page layout</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Page size
          <select
            value={value.pageSize}
            onChange={(e) => set("pageSize", e.target.value as HtmlPageSize)}
            className={SELECT}
          >
            {HTML_PAGE_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Orientation
          <select
            value={value.orientation}
            onChange={(e) =>
              set("orientation", e.target.value as HtmlOrientation)
            }
            className={SELECT}
          >
            {HTML_ORIENTATIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Margins
          <select
            value={value.margin}
            onChange={(e) => set("margin", e.target.value as HtmlMargin)}
            className={SELECT}
          >
            {HTML_MARGINS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Screen width
          <select
            value={value.viewport}
            onChange={(e) => set("viewport", e.target.value as HtmlViewport)}
            className={SELECT}
          >
            {HTML_VIEWPORTS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-fg flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.onePage}
          onChange={(e) => set("onePage", e.target.checked)}
          className="accent-accent size-4"
        />
        One long page
      </label>
      <p className="text-muted text-xs leading-relaxed" aria-live="polite">
        {note}
      </p>
    </fieldset>
  );
}
