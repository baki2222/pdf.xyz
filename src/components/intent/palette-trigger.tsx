"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Search } from "lucide-react";
import type { PaletteTrigger as OpenedBy } from "@/lib/telemetry/events";

type Palette = typeof import("./command-palette").default;

/** Fetched once; a failed fetch is not remembered — the next approach retries. */
let pending: Promise<Palette> | null = null;
function loadPalette(): Promise<Palette> {
  pending ??= import("./command-palette").then(
    (mod) => mod.default,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}
const prefetch = () => void loadPalette().catch(() => {});

const noop = () => () => {};
/** "⌘" on Apple keyboards, after hydration; "Ctrl" on the server and elsewhere. */
function useApple(): boolean {
  return useSyncExternalStore(
    noop,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    () => false,
  );
}

/**
 * The header's way into the command palette: at `lg` and up a field-shaped
 * button ("Find a tool or guide", and the shortcut), below that a 44px icon
 * button. The shortcut's slot has a FIXED width, so the swap from "Ctrl K"
 * to "⌘ K" after hydration moves nothing.
 *
 * Ctrl+K or ⌘K opens it from anywhere on the page. The palette itself is a
 * lazy chunk (`./command-palette`), fetched as the pointer or focus reaches
 * this button, or as Ctrl or ⌘ goes down — so it is usually here before it
 * is asked for — and never in any page's first load.
 */
export function PaletteTrigger() {
  const ref = useRef<HTMLButtonElement>(null);
  const [CommandPalette, setPalette] = useState<Palette | null>(null);
  const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null);
  const apple = useApple();

  const show = useCallback((how: OpenedBy) => {
    loadPalette().then(
      (palette) => {
        setPalette(() => palette);
        setOpenedBy((now) => now ?? how);
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        prefetch();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        show("shortcut");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [show]);

  const close = useCallback(() => setOpenedBy(null), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="Find a tool or guide"
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        onClick={() => show("button")}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        className="border-line text-muted hover:text-fg hover:border-line-strong rounded-ctl inline-flex h-11 shrink-0 items-center justify-center gap-2 border px-3.5 transition-colors"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="w-36 text-left text-sm max-lg:hidden">
          Find a tool or guide
        </span>
        <kbd
          aria-hidden
          className="border-line text-faint rounded-tag w-11 shrink-0 border py-px text-center font-mono text-[11px] max-lg:hidden"
        >
          {apple ? "⌘ K" : "Ctrl K"}
        </kbd>
      </button>
      {openedBy && CommandPalette && (
        <CommandPalette trigger={openedBy} returnFocus={ref} onClose={close} />
      )}
    </>
  );
}
