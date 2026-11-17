"use client";

/**
 * The paper a page-size control starts on before the person picks one: A4,
 * or US Letter where the browser's first preferred language names a Letter
 * country (`imagePageSizeForLocales`, the CLDR table JPG/PNG to PDF use).
 * Audit backlog #5, 2026-11-16: most of the world prints on A4, and every
 * tool but JPG/PNG to PDF started everyone on one fixed size.
 *
 * Read through `useSyncExternalStore`, whose server snapshot is the world
 * paper: the server cannot know the browser's languages, so its HTML shows
 * A4, hydration reads that same A4 (no mismatch), and a Letter browser then
 * re-renders onto Letter. Only which chip is pressed or which option is
 * selected changes, never the size of anything, so nothing moves.
 */
import { useSyncExternalStore } from "react";
import {
  imagePageSizeForLocales,
  WORLD_PAGE_SIZE,
} from "@/lib/pdf/image-page-defaults";
import type { ImagePageSizeId } from "@/lib/pdf/image-page-layout";

/**
 * The browser's preferred languages, best first: `navigator.languages`, or
 * `navigator.language` alone where the list is missing or empty, or nothing.
 * Non-string members are dropped, so a strange list cannot throw.
 */
export function browserLocales(
  nav:
    | Partial<Pick<Navigator, "languages" | "language">>
    | undefined = typeof navigator === "undefined" ? undefined : navigator,
): readonly string[] {
  if (!nav) return [];
  const list = Array.isArray(nav.languages)
    ? nav.languages.filter((tag): tag is string => typeof tag === "string")
    : [];
  if (list.length > 0) return list;
  return typeof nav.language === "string" && nav.language ? [nav.language] : [];
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
}

const clientPaper = () => imagePageSizeForLocales(browserLocales());
const serverPaper = () => WORLD_PAGE_SIZE;

/** "a4" or "letter" for this browser; "a4" in the server's render. */
export function useRegionalPaper(): ImagePageSizeId {
  return useSyncExternalStore(subscribe, clientPaper, serverPaper);
}

/**
 * The id in `table` for `paper`, matched without case (HTML to PDF's ids are
 * "A4" and "Letter"). Throws when the table has no such size: a control
 * that offers a page size must offer the regional one.
 */
export function regionalChoice<Id extends string>(
  table: readonly { id: Id }[],
  paper: ImagePageSizeId,
): Id {
  const hit = table.find((entry) => entry.id.toLowerCase() === paper);
  if (!hit) throw new Error(`no "${paper}" page size in this control`);
  return hit.id;
}
