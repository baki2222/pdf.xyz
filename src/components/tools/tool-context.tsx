"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The tool a runner or panel belongs to, as its page names it. */
export interface ToolIdentity {
  readonly slug: string;
  readonly name: string;
}

const Tool = createContext<ToolIdentity | null>(null);

/**
 * The tool page's own identity, around its runner or worker panel, so what
 * the page says about a file it is handed can name the tool — "Release to
 * add to Merge PDF" — without each of the 23 drop zones being told by hand.
 * Set by `src/app/tools/[slug]/page.tsx` from the catalogue entry the page
 * is rendered from; WP-08 widens it (the continue targets the page computes).
 */
export function ToolContextProvider({
  slug,
  name,
  children,
}: ToolIdentity & { children: ReactNode }) {
  return <Tool.Provider value={{ slug, name }}>{children}</Tool.Provider>;
}

/** The surrounding tool page's identity; null outside one (a test, a dialog). */
export function useToolContext(): ToolIdentity | null {
  return useContext(Tool);
}
