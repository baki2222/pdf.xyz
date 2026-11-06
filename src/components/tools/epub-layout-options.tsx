"use client";

/**
 * EPUB to PDF's page options: the paper and margins a reflowable book is
 * printed on. Every value comes from `@/lib/jobs/epub-render-options`, the
 * list the job API and the worker validate against.
 */
import {
  EPUB_MARGINS,
  EPUB_PAGE_SIZES,
  type EpubMargin,
  type EpubPageSize,
  type EpubRenderOptions,
} from "@/lib/jobs/epub-render-options";

const SELECT =
  "border-line bg-wash text-fg focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none";

/** What the controls do not reach: said under them, always. */
export const EPUB_FIXED_LAYOUT_NOTE =
  "A fixed-layout book (one whose pages are drawn to an exact size, as in many comics and picture books) keeps each page's own size, with no margins.";

export function EpubLayoutOptions({
  value,
  onChange,
  disabled,
}: {
  value: EpubRenderOptions;
  onChange: (next: EpubRenderOptions) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-fg text-xs font-medium">Page layout</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-muted flex flex-col gap-1 text-xs">
          Page size
          <select
            value={value.pageSize}
            onChange={(e) =>
              onChange({ ...value, pageSize: e.target.value as EpubPageSize })
            }
            className={SELECT}
          >
            {EPUB_PAGE_SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted flex flex-col gap-1 text-xs">
          Margins
          <select
            value={value.margin}
            onChange={(e) =>
              onChange({ ...value, margin: e.target.value as EpubMargin })
            }
            className={SELECT}
          >
            {EPUB_MARGINS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-muted text-xs leading-relaxed">
        {EPUB_FIXED_LAYOUT_NOTE}
      </p>
    </fieldset>
  );
}
