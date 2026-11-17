"use client";

import dynamic from "next/dynamic";
import type { MergePageGridProps } from "./merge-page-grid";

/**
 * Merge PDF's Arrange pages grid as a lazy chunk: the tiles, the thumbnail
 * hook and the grid load once Arrange pages is chosen, not with the tool
 * page, so a merge of whole files never pays for them.
 */
export const LazyMergePageGrid = dynamic<MergePageGridProps>(
  () => import("./merge-page-grid").then(({ MergePageGrid }) => MergePageGrid),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
