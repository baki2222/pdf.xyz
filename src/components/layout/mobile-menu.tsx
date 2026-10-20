"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavLinks } from "./nav-links";

interface Recent {
  readonly slug: string;
  readonly name: string;
}

/** Recent tools, named — read when the menu opens, never with the page. */
async function readRecentTools(): Promise<Recent[]> {
  const [{ readRecents }, { getToolBySlug }] = await Promise.all([
    import("@/lib/intent/recents"),
    import("@/lib/tools"),
  ]);
  return readRecents()
    .map((r) => ({ slug: r.slug, name: getToolBySlug(r.slug)?.name ?? "" }))
    .filter((r) => r.name)
    .slice(0, 4);
}

/**
 * The phone's navigation (below `md`): a toggle, and a modal `<dialog>` —
 * the whole screen on a phone, as the ticket dialog is — with the primary
 * links (a landmark named "Menu", so it never duplicates the desktop
 * "Primary"), the recent tools when this browser has any, and a full-width
 * "Open workspace". (The spec's sheet sliding down from the top needed CSS
 * the stylesheet's 15 KB budget did not have; this reuses the dialogs'.)
 *
 * Open FOR a pathname: the menu is open only while the route it was opened
 * on is still current, so any navigation closes it — a link, back/forward —
 * with no effect writing state. Escape, the close button and the backdrop
 * close it too, and focus goes back to the toggle. While it is open the
 * page behind holds still: the root's overflow is hidden, by an inline
 * style, not a stylesheet rule — the stylesheet had no room (15 KB gz,
 * shipped-css.test.ts).
 *
 * The recent tools come with the menu: their names are the catalogue's,
 * which is not this layout's to load (`bundle-budget.test.ts`), so they are
 * fetched as it opens, into a list that is absent until there is something
 * to list.
 */
export function MobileMenu() {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const [recent, setRecent] = useState<Recent[]>([]);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  // The dialog follows `open`; its own close (Escape, backdrop) is reported
  // back, and every close returns focus to the toggle.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      document.documentElement.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      document.documentElement.style.overflow = "";
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      toggleRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      document.documentElement.style.overflow = "";
      setOpenOn(null);
      toggleRef.current?.focus({ preventScroll: true });
    };
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("close", onClose);
      document.documentElement.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    readRecentTools().then(
      (list) => live && setRecent(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open]);

  const close = () => setOpenOn(null);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpenOn(open ? null : pathname)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-haspopup="dialog"
        className="border-line text-fg hover:bg-wash rounded-ctl grid size-10 shrink-0 place-items-center border transition-colors md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        id="mobile-menu"
        aria-labelledby={headingId}
        data-motion-ui=""
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className={cn(
          "bg-canvas text-fg border-line m-auto overflow-auto border p-0 md:hidden",
          // A phone's whole screen, as the ticket dialog is (the same classes).
          "max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:border-0",
          "backdrop:bg-scrim",
          // M7, with the dialogs' own classes (no new CSS): it fades in at the
          // top in 180ms and out in 120ms. The spec's −8px drop was new CSS
          // the stylesheet budget did not have (shipped-css.test.ts).
          "opacity-0 open:opacity-100",
          "motion-safe:transition-[opacity,translate,display,overlay] motion-safe:transition-discrete motion-safe:duration-120 motion-safe:ease-(--ease-snap) motion-safe:open:duration-180",
          "motion-safe:starting:open:opacity-0",
          "backdrop:opacity-0 open:backdrop:opacity-100",
          "motion-safe:backdrop:transition-[opacity,display,overlay] motion-safe:backdrop:transition-discrete motion-safe:backdrop:duration-120 motion-safe:starting:open:backdrop:opacity-0",
        )}
      >
        {open && (
          <div className="flex flex-col gap-4 px-5 pt-3 pb-5">
            <div className="flex h-11 items-center justify-between">
              <h2 id={headingId} className="kicker text-faint">
                Menu
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="border-line text-fg hover:bg-wash rounded-ctl grid size-10 place-items-center border transition-colors"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <nav aria-label="Menu" className="flex flex-col gap-1">
              <NavLinks variant="menu" onNavigate={close} />
            </nav>

            {recent.length > 0 && (
              <div className="border-line flex flex-col gap-1 border-t pt-4">
                <h3
                  id={`${headingId}-recent`}
                  className="kicker text-faint px-3"
                >
                  Recent tools
                </h3>
                <ul
                  aria-labelledby={`${headingId}-recent`}
                  className="flex flex-col"
                >
                  {recent.map((r) => (
                    <li key={r.slug}>
                      <Link
                        href={`/tools/${r.slug}`}
                        onClick={close}
                        className="text-fg hover:bg-wash rounded-ctl flex h-11 items-center px-3 text-sm transition-colors"
                      >
                        {r.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href="/workspace"
              onClick={close}
              className={cn(
                buttonVariants({ variant: "primary", size: "md" }),
                "h-11 w-full",
              )}
            >
              Open workspace
            </Link>
          </div>
        )}
      </dialog>
    </>
  );
}
