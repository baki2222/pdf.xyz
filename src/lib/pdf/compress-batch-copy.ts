/**
 * Compress PDF's batch on our secure server (audit compress-pdf#5,
 * 2026-11-08): the words the batch panel shows and the tool's copy quotes,
 * named once. Feature-scoped: only the batch runner and the tool's content
 * read it.
 */

import {
  KB,
  MAX_TARGET_BYTES,
  MIN_TARGET_BYTES,
  targetLabel,
} from "./compress-target";
import { formatBytes } from "@/lib/utils";

/** The batch's server choice: the single-file panel's own button label. */
export const BATCH_DEEP_LABEL = "Compress images on our server";

/** The batch's in-browser choice, the default. */
export const BATCH_LOSSLESS_LABEL = "Lossless, in your browser";

/** The legend over the two choices. */
export const BATCH_MODE_HEADING = "Where to compress";

/**
 * What a batch row says after the lock note when the file only restricts
 * changes. The batch refuses such a file in BOTH modes before anything of it
 * is uploaded (review of cb0eb82e): our server writes a copy without the
 * owner's restrictions, and only the single-file panel warns about that first.
 */
export const BATCH_RESTRICTED_NOTE =
  "Compress it on its own to use our secure server.";

/**
 * Said under a batch's Target size, after the single-file hint (audit
 * backlog #15): the target is for each file on its own, and our server
 * refuses a target a file already fits, so such a file goes without it.
 */
export const BATCH_TARGET_NOTE =
  "The size is for each file on its own. A file that already fits it is compressed at your Quality setting instead.";

/**
 * A batch row whose file already fit the target, so it was sent without it.
 * `met` and the words are read from the file the row hands back: a Grayscale
 * copy always ships, and can come back bigger than the file that fit. When
 * the row hands back the file as it came in (`unchanged`: our copy was no
 * smaller), nothing was compressed, so the words claim nothing of the kind.
 */
export function batchTargetAlreadyFits(
  targetBytes: number,
  deliveredBytes: number,
  unchanged = false,
): { met: boolean; text: string } {
  const target = targetLabel(targetBytes);
  if (unchanged && deliveredBytes <= targetBytes) {
    return { met: true, text: `Already fits your ${target} target.` };
  }
  if (deliveredBytes <= targetBytes) {
    return {
      met: true,
      text: `Already fits your ${target} target, so it was compressed at your Quality setting.`,
    };
  }
  return {
    met: false,
    text: `Your file already fit your ${target} target, so it was compressed at your Quality setting; the grayscale copy is ${formatBytes(deliveredBytes)}, above it.`,
  };
}

/** What to type instead of a size no file of the batch can be sent. */
export const BATCH_TARGET_INVALID = `Enter a whole number of KB from ${MIN_TARGET_BYTES / KB} to ${(MAX_TARGET_BYTES / KB).toLocaleString("en-US")}.`;
