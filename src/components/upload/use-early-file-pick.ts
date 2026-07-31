"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Recover a file chosen *before* React hydrated the input.
 *
 * Our dropzones are server-rendered, so the `<input type="file">` is clickable
 * as soon as the HTML lands — well before the client bundle boots. If the user
 * picks a file in that window, the browser fires `change` against an element
 * that has no React listener yet. The event is gone for good, but the chosen
 * file is still sitting in `input.files`, so the input looks "filled" while the
 * app shows an untouched dropzone: a silent dead end the user can only escape
 * by picking the *same* file again (which, being an unchanged value, may not
 * even re-fire `change`).
 *
 * This hook closes that window: on mount — i.e. the first moment React is
 * actually listening — it adopts anything already in the input and clears the
 * element, so the normal `onChange` path owns every pick from then on.
 *
 * @param inputRef the file input to adopt from
 * @param emit the same handler the input's `onChange` uses
 */
export function useEarlyFilePick(
  inputRef: RefObject<HTMLInputElement | null>,
  emit: (files: FileList | null) => void,
): void {
  // The pre-hydration window closes once we've looked, so only ever look once —
  // and stay idempotent under StrictMode's double-invoked effects.
  const adoptedRef = useRef(false);

  useEffect(() => {
    if (adoptedRef.current) return;
    adoptedRef.current = true;
    const input = inputRef.current;
    if (!input?.files?.length) return;
    emit(input.files);
    input.value = "";
  }, [inputRef, emit]);
}
