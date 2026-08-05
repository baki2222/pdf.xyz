"use client";

import { useSyncExternalStore } from "react";
import {
  hasUploadedThisSession,
  subscribeToUploadFlag,
} from "@/lib/uploads/session-uploads";

/**
 * The one place the crash fallbacks are allowed to say anything about uploads.
 *
 * Three surfaces (`ErrorBoundary`, `app/error.tsx`, `app/global-error.tsx`) each
 * carried their own hand-written copy of this sentence, which is how all three
 * came to state something the product could not know. Keeping the wording here
 * means the honest and dishonest versions cannot drift apart again — the same
 * reason #47 collapsed seventeen run triggers into one `WorkerRunButton`.
 */

export const NO_UPLOAD_DISCLOSURE =
  "Nothing was uploaded and your files are untouched.";

export const AFTER_UPLOAD_DISCLOSURE =
  "A file had already been uploaded to the secure worker to run this tool; your local copy is untouched.";

/**
 * The honest one-line disclosure for a crash fallback, or `null` when it is not
 * yet knowable.
 *
 * `null` is the point, not a limitation. The flag lives in browser-only module
 * state, so on the server — and in the hydration pass that must match it —
 * neither sentence is established. Printing the reassuring one there is
 * precisely the bug this replaces, and printing the other would be a different
 * false claim; saying nothing about uploads is the only honest output in that
 * instant. `getServerSnapshot` is therefore `() => null` rather than a
 * convenient `false`.
 *
 * A crash fallback usually mounts long after hydration, where there is no server
 * snapshot to match and the correct sentence renders on the very first paint.
 */
export function useUploadDisclosure(): string | null {
  const uploaded = useSyncExternalStore<boolean | null>(
    subscribeToUploadFlag,
    hasUploadedThisSession,
    () => null,
  );

  if (uploaded === null) return null;
  return uploaded ? AFTER_UPLOAD_DISCLOSURE : NO_UPLOAD_DISCLOSURE;
}
