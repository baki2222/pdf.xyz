"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { clearRecents, useRecents } from "@/lib/intent/recents";
import { confirmLeave } from "@/lib/intent/unsaved";
import { unsupportedWords } from "@/lib/intent/unsupported";
import {
  buildIndex,
  search,
  wordsOf,
  type DocKind,
  type SearchIndex,
} from "@/lib/intent/search";
import { paletteDocs, type PaletteDoc } from "@/lib/intent/palette-index";
import type { PaletteTrigger } from "@/lib/telemetry/events";
import { suggestionOpenedEvent, track } from "@/lib/telemetry/track";
import { cn } from "@/lib/utils";
import { PALETTE_CHUNK_MARKER } from "./palette-chunk";

export { PALETTE_CHUNK_MARKER };

/** The name the trigger, the dialog and the field share. */
export const PALETTE_LABEL = "Find a tool or guide";

/** At most this many options per group for a query; tasks and actions fewer. */
const LIMIT: Record<DocKind, number> = {
  task: 3,
  tool: 6,
  guide: 3,
  page: 3,
  action: 3,
};
const GROUP_NAME: Record<DocKind | "recent", string> = {
  recent: "Recent",
  task: "Tasks",
  tool: "Tools",
  guide: "Guides",
  page: "Pages",
  action: "Actions",
};
/** The order groups take when there is no query to rank them. */
const KIND_ORDER: readonly DocKind[] = [
  "task",
  "tool",
  "guide",
  "page",
  "action",
];
/** Tasks offered before anything is typed: the home page's six. */
const STARTER_TASKS = 6;
const RECENT_SHOWN = 4;

let built: SearchIndex<PaletteDoc> | null = null;
/** The index, built once per page on first open and kept. */
function paletteIndex(): SearchIndex<PaletteDoc> {
  built ??= buildIndex(paletteDocs());
  return built;
}

interface Group {
  readonly key: DocKind | "recent";
  readonly options: readonly PaletteDoc[];
}

interface View {
  readonly groups: readonly Group[];
  readonly mode: "start" | "all" | "closest" | "empty";
  readonly unsupported: string | null;
}

function viewFor(query: string, recentSlugs: readonly string[]): View {
  const index = paletteIndex();
  const docs = index.entries.map((e) => e.doc);
  if (!query.trim()) {
    const recent = recentSlugs
      .map((slug) => docs.find((d) => d.kind === "tool" && d.toolSlug === slug))
      .filter((d): d is PaletteDoc => d !== undefined)
      .slice(0, RECENT_SHOWN);
    const groups: Group[] = [
      { key: "recent", options: recent },
      {
        key: "task",
        options: docs.filter((d) => d.kind === "task").slice(0, STARTER_TASKS),
      },
      { key: "action", options: docs.filter((d) => d.kind === "action") },
    ];
    return {
      groups: groups.filter((g) => g.options.length > 0),
      mode: "start",
      unsupported: null,
    };
  }
  const { results, mode, unsupported } = search(index, query);
  // Groups in the order of their best result, so the top match is the
  // first option whatever its kind.
  const firstAt = new Map<DocKind, number>();
  results.forEach((doc, i) => {
    if (!firstAt.has(doc.kind)) firstAt.set(doc.kind, i);
  });
  const groups = KIND_ORDER.filter((kind) => firstAt.has(kind))
    .sort((a, b) => firstAt.get(a)! - firstAt.get(b)!)
    .map((kind) => ({
      key: kind,
      options: results.filter((d) => d.kind === kind).slice(0, LIMIT[kind]),
    }));
  const answer = unsupported ? unsupportedWords(unsupported) : null;
  return {
    groups,
    mode: groups.length === 0 ? "empty" : mode,
    unsupported: answer
      ? [answer.headline, answer.how].filter(Boolean).join(" ")
      : null,
  };
}

/** Where each group's options start in the flat list. */
function offsets(groups: readonly Group[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const g of groups) {
    out.push(n);
    n += g.options.length;
  }
  return out;
}

/** The name, with the words the query began marked by the mark sweep. */
function highlight(name: string, query: string): ReactNode {
  const tokens = wordsOf(query).filter((t) => t.length >= 2);
  if (tokens.length === 0) return name;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of name.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    const plain = word
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase();
    const token = tokens.find((t) => plain.startsWith(t));
    if (!token) continue;
    const at = match.index;
    parts.push(name.slice(last, at));
    parts.push(
      <mark key={at} className="mark-sweep text-fg">
        {word.slice(0, token.length)}
      </mark>,
    );
    last = at + token.length;
  }
  parts.push(name.slice(last));
  return parts;
}

export interface CommandPaletteProps {
  /** How it was opened, for `palette_opened`. */
  readonly trigger: PaletteTrigger;
  /** Called once, when the dialog has closed. */
  readonly onClose: () => void;
  /** Where focus goes back to when it closes: the header's trigger. */
  readonly returnFocus?: { readonly current: HTMLElement | null };
}

/**
 * The command palette (E.7): every tool, task, guide, page and action,
 * ranked by the site's one search, one shortcut away.
 *
 * A native `<dialog>` opened with `showModal()`, portalled to the end of
 * `<body>`: the focus trap, the inert page and Escape are the browser's.
 * The field is a `combobox` controlling a grouped `listbox`; the active
 * option is `aria-activedescendant`, so focus never leaves the field. Enter
 * opens the active option after the unsaved-work question; Escape closes and
 * focus returns to the trigger. A file dropped on it closes it and goes to
 * the ticket dialog. Full-screen below `sm`, with a Cancel.
 *
 * LAZY: the header's trigger fetches this module (and the index with it) on
 * approach; `lazy-chunks.test.ts` holds that no page loads it up front and
 * that the fetch stays under 12 KB gz beyond the shared catalogue.
 */
export default function CommandPalette({
  trigger,
  onClose,
  returnFocus,
}: CommandPaletteProps) {
  const router = useRouter();
  const recents = useRecents();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const [query, setQuery] = useState("");
  const [activeAt, setActiveAt] = useState(0);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  const focusRef = useRef(returnFocus);
  useEffect(() => {
    closeRef.current = onClose;
    focusRef.current = returnFocus;
  }, [onClose, returnFocus]);

  const recentSlugs = useMemo(() => recents.map((r) => r.slug), [recents]);
  const view = useMemo(() => viewFor(query, recentSlugs), [query, recentSlugs]);
  const flat = useMemo(() => view.groups.flatMap((g) => g.options), [view]);
  // Where each group's options start in `flat`: an option's id and rank.
  const starts = useMemo(() => offsets(view.groups), [view]);
  const active = flat.length > 0 ? Math.min(activeAt, flat.length - 1) : -1;
  const optionId = (i: number) => `${uid}-o${i}`;

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else closeRef.current();
  }, []);

  // Open as a modal. Its own close (Escape, Cancel, a choice, the backdrop)
  // tells the trigger once, and puts focus back on it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    inputRef.current?.focus();
    const onDialogClose = () => {
      focusRef.current?.current?.focus({ preventScroll: true });
      closeRef.current();
    };
    dialog.addEventListener("close", onDialogClose);
    return () => {
      dialog.removeEventListener("close", onDialogClose);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  // Measured once per opening; never what is typed (E.13).
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    track({ name: "palette_opened", trigger });
  }, [trigger]);

  // A file dropped on the open palette: it closes, and the files go to the
  // ticket dialog — the page's fallback — whatever the page's own target is.
  // Claimed (`preventDefault`) so the drop layer's window handler leaves it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files") ||
      (e.dataTransfer?.files?.length ?? 0) > 0;
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      close();
      if (files.length === 0) return;
      void import("@/lib/intent/page-target").then((registry) =>
        registry.deliverToFallback(files, "drop", { kind: "none" }),
      );
    };
    dialog.addEventListener("dragover", onOver);
    dialog.addEventListener("drop", onDrop);
    return () => {
      dialog.removeEventListener("dragover", onOver);
      dialog.removeEventListener("drop", onDrop);
    };
  }, [close]);

  // The count, said in the dialog once typing settles.
  useEffect(() => {
    const words =
      view.mode === "start"
        ? ""
        : view.mode === "empty"
          ? "No results"
          : `${view.mode === "closest" ? "No exact match. Closest: " : ""}${flat.length} ${flat.length === 1 ? "result" : "results"}`;
    const timer = setTimeout(() => setStatus(words), 300);
    return () => clearTimeout(timer);
  }, [view, flat.length]);

  // Keep the active option in view as the arrows move it.
  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const choose = (doc: PaletteDoc, rank: number) => {
    if (doc.action === "open-file") {
      close();
      void import("@/lib/intent/page-target").then((registry) =>
        registry.requestFilePick(),
      );
      return;
    }
    if (doc.action === "clear-history") {
      clearRecents();
      setNotice("Clearing this browser's history…");
      void Promise.allSettled([
        import("@/lib/workspace/storage").then((m) => m.clearPersisted()),
        import("@/lib/handoff").then((m) => m.clearHandoffs()),
      ]).then(() =>
        setNotice(
          "Cleared: recent tools, the saved workspace list and files waiting to be handed to a tool, in this browser.",
        ),
      );
      return;
    }
    const href = doc.action === "workspace" ? "/workspace" : doc.href;
    if (!href) return;
    if (!confirmLeave()) return;
    if (doc.toolSlug) {
      track(
        suggestionOpenedEvent({
          toolSlug: doc.toolSlug,
          source: "palette",
          rank,
          carried: false,
        }),
      );
    }
    close();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = flat.length;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (n) setActiveAt((active + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (n) setActiveAt((active - 1 + n) % n);
        break;
      case "Home":
        if (!n) break;
        e.preventDefault();
        setActiveAt(0);
        break;
      case "End":
        if (!n) break;
        e.preventDefault();
        setActiveAt(n - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (active >= 0) choose(flat[active]!, active + 1);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={PALETTE_LABEL}
      data-chunk={PALETTE_CHUNK_MARKER}
      data-command-palette=""
      data-motion-ui=""
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className={cn(
        "bg-panel text-fg border-line shadow-lift m-auto border p-0",
        "max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:border-0",
        "sm:rounded-panel sm:mt-6 sm:w-[35rem] sm:max-w-[calc(100vw-2rem)]",
        "backdrop:bg-scrim",
        // M7: in 180ms, out 120ms — the ticket dialog's own classes, so the
        // palette adds no CSS for them (shipped-css.test.ts: 15 KB gz). It
        // rises 4px rather than scaling from .985: a scale was 0.4 KB of new
        // CSS the budget did not have.
        "opacity-0 open:opacity-100 sm:translate-y-1 sm:open:translate-y-0",
        "motion-safe:transition-[opacity,translate,display,overlay] motion-safe:transition-discrete motion-safe:duration-120 motion-safe:ease-(--ease-snap) motion-safe:open:duration-180",
        "motion-safe:starting:open:opacity-0 motion-safe:sm:starting:open:translate-y-1",
        "backdrop:opacity-0 open:backdrop:opacity-100",
        "motion-safe:backdrop:transition-[opacity,display,overlay] motion-safe:backdrop:transition-discrete motion-safe:backdrop:duration-120 motion-safe:starting:open:backdrop:opacity-0",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="border-line flex items-center gap-3 border-b px-4">
          <Search className="text-faint size-4 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={PALETTE_LABEL}
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search tools, guides and pages"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveAt(0);
              setNotice(null);
            }}
            onKeyDown={onKeyDown}
            className="placeholder:text-faint h-14 w-0 flex-1 bg-transparent text-base outline-none"
          />
          <button
            type="button"
            onClick={close}
            className="text-muted hover:text-fg h-11 shrink-0 px-1 text-sm sm:hidden"
          >
            Cancel
          </button>
        </div>

        <div
          ref={listRef}
          className="max-h-[58vh] flex-1 overflow-auto p-2 max-sm:max-h-none"
        >
          {view.unsupported && (
            <p className="text-muted px-3 py-2 text-sm" role="note">
              {view.unsupported}
            </p>
          )}
          <div
            id={listboxId}
            role="listbox"
            aria-label="Results"
            className="flex flex-col gap-2"
          >
            {view.groups.map((group, g) => (
              <div
                key={group.key}
                role="group"
                aria-label={GROUP_NAME[group.key]}
              >
                <div
                  aria-hidden
                  className="kicker text-faint px-3 pt-2 pb-1 text-[11px]"
                >
                  {GROUP_NAME[group.key]}
                </div>
                {group.options.map((doc, j) => {
                  const i = starts[g]! + j;
                  const selected = i === active;
                  return (
                    <div
                      key={`${group.key}:${doc.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      aria-label={doc.name}
                      data-href={
                        doc.action === "workspace" ? "/workspace" : doc.href
                      }
                      onMouseMove={() => {
                        if (!selected) setActiveAt(i);
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(doc, i + 1)}
                      className={cn(
                        "rounded-ctl flex min-h-10 cursor-pointer flex-col justify-center px-3 py-1.5",
                        selected ? "bg-select" : "hover:bg-wash",
                      )}
                    >
                      <span className="text-fg text-sm leading-5">
                        {highlight(doc.name, query)}
                      </span>
                      {doc.detail && (
                        <span className="text-muted line-clamp-1 text-xs leading-4">
                          {doc.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {view.mode === "empty" && (
            <p className="text-muted px-3 py-6 text-center text-sm">
              No tool, guide or page matches &ldquo;{query.trim()}&rdquo;. Try
              fewer words, or{" "}
              <Link
                href="/tools"
                onClick={(e) => {
                  if (!confirmLeave()) {
                    e.preventDefault();
                    return;
                  }
                  close();
                }}
                className="text-fg decoration-line-strong hover:decoration-accent underline underline-offset-4"
              >
                browse every tool
              </Link>
              .
            </p>
          )}
        </div>

        <p
          role="status"
          className="text-faint border-line border-t px-4 py-2.5 text-xs leading-4"
        >
          {notice ?? status}
        </p>
      </div>
    </dialog>,
    document.body,
  );
}
