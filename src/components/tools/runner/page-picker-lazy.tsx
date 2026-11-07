"use client";

import dynamic from "next/dynamic";
import type { PagePickerProps } from "./page-picker";

/**
 * The page picker as a lazy chunk: a runner that offers it pays for the
 * tiles, the thumbnail hook and the picker only once the picker is shown,
 * not on the tool page's first load or when its typed box is all that is used.
 */
export const LazyPagePicker = dynamic<PagePickerProps>(
  () => import("./page-picker").then(({ PagePicker }) => PagePicker),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
