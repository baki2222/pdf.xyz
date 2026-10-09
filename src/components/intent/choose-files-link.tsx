"use client";

import type { MouseEvent, ReactNode } from "react";
import { isPlainClick } from "@/lib/intent/links";

/**
 * A link to the page's desk that also opens its file picker.
 *
 * It is a plain fragment link first (`#upload`): without JavaScript, or with
 * a modifier held, it scrolls to the desk, and the desk's `hashchange`
 * handler puts focus on "Choose files". Pressed normally, it ALSO opens the
 * desk's picker in the same click (a picker needs a person's click to open),
 * so "Choose files" at the foot of the page does what it says, and the page
 * is at the desk when the files come back.
 */
export function ChooseFilesLink({
  target,
  className,
  children,
}: {
  /** The desk's id. */
  target: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    document
      .getElementById(target)
      ?.querySelector<HTMLInputElement>('input[type="file"]')
      ?.click();
  };
  return (
    <a href={`#${target}`} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
