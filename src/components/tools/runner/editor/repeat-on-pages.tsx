"use client";

import { useId, useState } from "react";
import { CopyPlus } from "lucide-react";
import { PageRangeError } from "@/lib/pdf/ranges";
import {
  REPEAT_TARGETS,
  REPEAT_TARGET_LABEL,
  repeatPages,
  type RepeatTarget,
} from "@/lib/pdf/editor/repeat-on-pages";

/**
 * "Repeat on": all pages, the last page, or custom pages, for a selected
 * signature, initials, name or date (audit sign-pdf#6). It hands the
 * 0-based target pages to `onRepeat`, which places one copy on each at the
 * same spot as one undoable step; it says why when there is nowhere to go.
 */
export function RepeatOnPages({
  pageCount,
  from,
  onRepeat,
}: {
  pageCount: number;
  /** The page the selection is on (0-based): never a target. */
  from: number;
  onRepeat: (pages: number[]) => void;
}) {
  const id = useId();
  const [target, setTarget] = useState<RepeatTarget>("all");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (pageCount < 2) return null;

  const repeat = () => {
    try {
      const pages = repeatPages(target, custom, pageCount, from);
      if (pages.length === 0) {
        setError(
          target === "last"
            ? "It is already on the last page."
            : "It is already on every page you named.",
        );
        return;
      }
      setError(null);
      onRepeat(pages);
    } catch (err) {
      if (!(err instanceof PageRangeError)) throw err;
      setError(err.message);
    }
  };

  const control =
    "border-line bg-canvas text-fg rounded-ctl h-11 border px-2 text-xs";
  return (
    <div className="flex flex-col gap-1.5" data-repeat-on="">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1" htmlFor={`${id}-target`}>
          <span className="text-muted text-[11px] font-medium">Repeat on</span>
          <select
            id={`${id}-target`}
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as RepeatTarget);
              setError(null);
            }}
            className={control}
          >
            {REPEAT_TARGETS.map((t) => (
              <option key={t} value={t}>
                {REPEAT_TARGET_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {target === "custom" && (
          <label className="flex flex-col gap-1" htmlFor={`${id}-pages`}>
            <span className="text-muted text-[11px] font-medium">Pages</span>
            <input
              id={`${id}-pages`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. 2-4, 7"
              inputMode="numeric"
              className={`${control} tnum w-28`}
            />
          </label>
        )}
        <button
          type="button"
          onClick={repeat}
          className="border-line text-muted hover:text-fg rounded-ctl inline-flex h-11 items-center gap-1.5 border px-2.5 text-xs"
        >
          <CopyPlus className="size-3.5" aria-hidden />
          Repeat
        </button>
      </div>
      {error && (
        <p role="alert" className="text-err text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
