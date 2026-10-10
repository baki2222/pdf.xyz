"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GuideDesk as LiveDesk, GuideDeskProps } from "./guide-desk";

/**
 * Where a guide's desk goes: its server-drawn shell (`children`, a
 * `GuideDeskShell`) until the live desk (`./guide-desk`) arrives, fetched as
 * the page mounts rather than with it — then the live desk, in place.
 *
 * WHY NOT WITH THE PAGE. A guide is prose; the desk was the route's first
 * client code, and with its drop sheet it put about 3.8 KB gz in the first
 * load of every guide — 205.3 KB against the page's 203.5 ceiling, past
 * its whole redesign allowance (WP-07 review). With this slot in its place
 * the guide weighs 201.5 (`bundle-budget.test.ts` holds it), and the shell
 * is the sheet to the pixel (`drop-sheet-shell.test.tsx`), so the swap
 * moves nothing.
 *
 * NOTHING PICKED IS LOST. The shell's picker is a native input: a file
 * picked before the live desk arrives — before the page hydrated, even — is
 * read from it at the swap and handed to the live desk (`early`), focus that
 * was on it goes to the live desk's picker (`refocus`), and a pick whose
 * dialog is still open across the swap lands through the page's registry,
 * where the live desk is the target. A file released on the page meanwhile
 * is the drop layer's, as on any page without a target yet.
 */
export function GuideDeskSlot({
  desk,
  children,
}: {
  desk: GuideDeskProps;
  /** The shell, drawn by the server. */
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{
    Desk: typeof LiveDesk;
    early: File[];
    refocus: boolean;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    let swapped = false;
    const input =
      shell.current?.querySelector<HTMLInputElement>('input[type="file"]') ??
      null;
    // A pick whose dialog closed after the swap: the shell's input is gone
    // from the page, and the live desk takes it as the page's target.
    const late = () => {
      const files = Array.from(input?.files ?? []);
      if (!swapped || files.length === 0) return;
      if (input) input.value = "";
      void import("@/lib/intent/page-target").then((registry) =>
        registry.deliverFiles(files, "pick"),
      );
    };
    input?.addEventListener("change", late);
    import("./guide-desk").then(
      ({ GuideDesk }) => {
        if (!mounted) return;
        swapped = true;
        const early = Array.from(input?.files ?? []);
        if (input) input.value = "";
        setLive({
          Desk: GuideDesk,
          early,
          refocus: !!shell.current?.contains(document.activeElement),
        });
      },
      // Offline, or a deploy replaced the chunk: the shell stays, and its
      // picker is still a picker — the page's layer says what failed if a
      // file is dropped.
      () => {},
    );
    return () => {
      mounted = false;
      input?.removeEventListener("change", late);
    };
  }, []);

  if (live) {
    const { Desk, early, refocus } = live;
    return <Desk {...desk} early={early} refocus={refocus} />;
  }
  return (
    <div ref={shell} className="contents">
      {children}
    </div>
  );
}
