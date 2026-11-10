"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronRight,
  CornerDownRight,
  Download,
  Ellipsis,
  IndentDecrease,
  IndentIncrease,
  ListPlus,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  BOOKMARK_DEPTH_MAX,
  BOOKMARK_EDIT_MAX,
  BOOKMARK_TITLE_MAX,
  bookmarkCount,
  bookmarksOutputName,
} from "@/lib/pdf/bookmark-labels";
import {
  countAll,
  find,
  allNodes,
  indent,
  insertAfter,
  insertChild,
  move,
  movesFor,
  outdent,
  pageBookmarks,
  remove,
  rename,
  retarget,
  setOpen,
  type BookmarkNode,
  type BookmarkTarget,
  type Tree,
} from "@/lib/pdf/bookmark-tree";
import type { BookmarksResult, OutlineReading } from "@/lib/pdf/bookmarks";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import { useUnsavedGuard } from "./use-unsaved-guard";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * Edit PDF Bookmarks' panel. Mounted by the `metadata` runner for its slug
 * (`bookmarks-host.tsx`, through `metadata-runner.tsx`), and fetched when a
 * file opens, with the engine — so it never rides Edit PDF Metadata's or
 * Remove Annotations' first load.
 *
 * The outline is a nested list (`role="list"` on every level, which Safari
 * drops from a styled `<ul>`): each row a title field, a page field, an
 * expand/collapse button for a bookmark with others inside it
 * (`aria-expanded`; it is also the state the saved PDF opens in), and a
 * "More actions" disclosure of ordinary 44 px buttons — move up and down,
 * indent, outdent, add, delete. Every button's name says which bookmark it
 * acts on. Moves and deletes are spoken in a polite live region, and every
 * edit can be undone.
 *
 * Every number on the result is read back from the SAVED copy
 * (`writePdfBookmarks` re-opens it), never from what was asked for.
 */

const engine = () => import("@/lib/pdf/bookmarks");

/*
 * The labels below are quoted BY HAND in the page's steps
 * (`content/edit-pdf-bookmarks.ts`), not imported: what holds the two
 * together is `tool-page-substance.test.ts`, which fails when a quoted label
 * is not a string this panel draws.
 */

/** The run button. */
export const BOOKMARK_RUN_LABEL = "Save bookmarks";

/** The result panel's title. */
export const BOOKMARK_RESULT_TITLE = "Bookmarks saved";

/** The button that adds a top-level bookmark at the end of the list. */
export const BOOKMARK_ADD_LABEL = "Add bookmark";

/** The disclosure on each row that shows its move, nest and delete buttons. */
export const BOOKMARK_MORE_LABEL = "More actions";

/** The page-number generator's button. */
export const BOOKMARK_GENERATE_LABEL = "Add page bookmarks";

/** The heading over the list. */
export const BOOKMARK_LIST_TITLE = "Bookmarks";

/** The download button. */
export const BOOKMARK_DOWNLOAD_LABEL = "Download PDF";

/** Undo steps kept. */
const HISTORY_MAX = 100;

/** Saved-outline titles listed on the result before "and N more". */
const RESULT_TITLES = 8;

/** The history of edits: every entry a whole tree. */
interface History {
  past: Tree[];
  present: Tree;
  future: Tree[];
}

const quoted = (title: string) => `“${title.trim() || "Untitled"}”`;

export function BookmarksEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [reading, setReading] = useState<OutlineReading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [showPanel, setShowPanel] = useState(true);
  const [menu, setMenu] = useState<string | null>(null);
  const [said, setSaid] = useState({ text: "", n: 0 });
  const [every, setEvery] = useState("1");
  const focusNext = useRef<string | null>(null);
  const titles = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const counter = useRef(0);
  const { busy, error, result, run, reset } = useAsyncRun<BookmarksResult>();

  useEffect(() => {
    let alive = true;
    engine()
      .then(({ readOutlineTree }) => readOutlineTree(pdf.bytes))
      .then((found) => {
        if (!alive) return;
        setReading(found);
        setHistory({ past: [], present: found.items, future: [] });
        // The file's own choice; on when it made none.
        setShowPanel(found.pageMode !== "other");
      })
      .catch((err) => {
        if (alive) setReadError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const items = history?.present ?? [];
  const dirty = Boolean(reading && history && items !== reading.items);
  useUnsavedGuard(dirty && !result, "your bookmark changes");

  const say = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));

  const commit = useCallback((next: Tree) => {
    setHistory((h) =>
      h && next !== h.present
        ? {
            past: [...h.past, h.present].slice(-HISTORY_MAX),
            present: next,
            future: [],
          }
        : h,
    );
  }, []);

  /** A title edit: one undo step per field visit, not per keystroke. */
  const typing = useRef<string | null>(null);
  const editTitle = (id: string, title: string) => {
    setHistory((h) => {
      if (!h) return h;
      const next = rename(h.present, id, title);
      if (typing.current === id) return { ...h, present: next };
      typing.current = id;
      return {
        past: [...h.past, h.present].slice(-HISTORY_MAX),
        present: next,
        future: [],
      };
    });
  };

  // Focus a row's title after an add or a delete changed which rows exist.
  useLayoutEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    if (id === "add") {
      addButton.current?.focus();
      return;
    }
    const input = titles.current.get(id);
    input?.focus();
    input?.select();
  });

  const registerTitle = useCallback(
    (id: string, el: HTMLInputElement | null) => {
      if (el) titles.current.set(id, el);
      else titles.current.delete(id);
    },
    [],
  );

  const newId = () => `n${(counter.current += 1)}`;
  const fresh = (page: number): BookmarkNode => ({
    id: newId(),
    title: "New bookmark",
    target: { kind: "page", page },
    open: false,
    children: [],
  });
  const total = countAll(items);
  const full = total >= BOOKMARK_EDIT_MAX;

  const act = {
    add: () => {
      if (full) return;
      const node = fresh(1);
      commit([...items, node]);
      focusNext.current = node.id;
      say("Added a bookmark at the end.");
    },
    addBelow: (id: string) => {
      const at = find(items, id);
      if (!at || full) return;
      const node = fresh(at.target.kind === "page" ? at.target.page : 1);
      commit(insertAfter(items, id, node));
      focusNext.current = node.id;
      setMenu(null);
      say(`Added a bookmark after ${quoted(at.title)}.`);
    },
    addInside: (id: string) => {
      const at = find(items, id);
      if (!at || full) return;
      const node = fresh(at.target.kind === "page" ? at.target.page : 1);
      commit(insertChild(items, id, node));
      focusNext.current = node.id;
      setMenu(null);
      say(`Added a bookmark inside ${quoted(at.title)}.`);
    },
    move: (id: string, by: -1 | 1) => {
      const at = find(items, id);
      const can = movesFor(items, id);
      if (!at || !(by < 0 ? can.up : can.down)) return;
      commit(move(items, id, by));
      say(`Moved ${quoted(at.title)} ${by < 0 ? "up" : "down"}.`);
    },
    indent: (id: string) => {
      const at = find(items, id);
      if (!at || !movesFor(items, id).indent) return;
      const next = indent(items, id);
      const parentPath = allNodes(next).find((f) => f.node.id === id);
      commit(next);
      say(
        `${quoted(at.title)} is now inside the bookmark above it, at level ${parentPath?.depth ?? 2}.`,
      );
    },
    outdent: (id: string) => {
      const at = find(items, id);
      if (!at || !movesFor(items, id).outdent) return;
      const next = outdent(items, id);
      const level = allNodes(next).find((f) => f.node.id === id)?.depth ?? 1;
      commit(next);
      say(`${quoted(at.title)} moved out one level, to level ${level}.`);
    },
    remove: (id: string) => {
      const at = find(items, id);
      if (!at) return;
      const order = allNodes(items).map((f) => f.node.id);
      const gone = new Set(allNodes([at]).map((f) => f.node.id));
      const index = order.indexOf(id);
      const after = order.slice(index + 1).find((x) => !gone.has(x));
      const before = order
        .slice(0, index)
        .reverse()
        .find((x) => !gone.has(x));
      commit(remove(items, id));
      setMenu(null);
      focusNext.current = after ?? before ?? "add";
      const inside = countAll(at.children);
      say(
        `Deleted ${quoted(at.title)}${inside ? ` and ${bookmarkCount(inside)} inside it` : ""}. Undo brings ${inside ? "them" : "it"} back.`,
      );
    },
    toggle: (id: string, open: boolean) => commit(setOpen(items, id, open)),
    target: (id: string, target: BookmarkTarget) =>
      commit(retarget(items, id, target)),
    undo: () => {
      typing.current = null;
      setHistory((h) =>
        h && h.past.length
          ? {
              past: h.past.slice(0, -1),
              present: h.past.at(-1)!,
              future: [h.present, ...h.future],
            }
          : h,
      );
      say("Undone.");
    },
    redo: () => {
      typing.current = null;
      setHistory((h) =>
        h && h.future.length
          ? {
              past: [...h.past, h.present],
              present: h.future[0]!,
              future: h.future.slice(1),
            }
          : h,
      );
      say("Redone.");
    },
  };

  const generate = () => {
    const step = Number(every);
    if (!Number.isInteger(step) || step < 1 || !reading) return;
    const made = pageBookmarks(reading.pageCount, step, newId);
    if (total + made.length > BOOKMARK_EDIT_MAX) return;
    commit([...items, ...made]);
    say(`Added ${bookmarkCount(made.length)} at the end.`);
  };

  const onRun = () => {
    typing.current = null;
    void run(async () =>
      (await engine()).writePdfBookmarks(pdf.bytes, {
        items,
        showPanel,
      }),
    );
  };

  if (result) {
    const name = bookmarksOutputName(pdf.file.name);
    const saved = result.saved;
    const top = saved.items.slice(0, RESULT_TITLES);
    return (
      <ResultPanel
        title={BOOKMARK_RESULT_TITLE}
        summary={`${bookmarkCount(saved.total)} · ${saved.depth} ${saved.depth === 1 ? "level" : "levels"} · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={() => {
          typing.current = null;
          reset();
        }}
        expectedPages={pdf.pageCount}
      >
        <div className="flex flex-col gap-3">
          {top.length > 0 ? (
            <ol
              data-bookmarks-saved=""
              className="border-line bg-wash rounded-panel flex max-w-2xl flex-col gap-1 border px-4 py-3 text-sm"
            >
              {top.map((n) => (
                <li key={n.id} className="text-fg min-w-0 wrap-anywhere">
                  {n.title || "Untitled"}
                  {n.children.length > 0 && (
                    <span className="text-muted">
                      {` · ${bookmarkCount(countAll(n.children))} inside`}
                    </span>
                  )}
                </li>
              ))}
              {saved.items.length > top.length && (
                <li className="text-muted">
                  {`and ${(saved.items.length - top.length).toLocaleString("en-US")} more at the top level`}
                </li>
              )}
            </ol>
          ) : (
            <p className="text-muted max-w-2xl text-sm">
              The copy has no bookmarks.
            </p>
          )}
          {saved.total > 0 && (
            <p className="text-muted max-w-2xl text-sm">
              {saved.pageMode === "outlines"
                ? "It opens with the bookmarks panel showing."
                : "It does not ask readers to show the bookmarks panel when it opens."}
            </p>
          )}
          {result.droppedActions > 0 && (
            <p role="status" className="text-muted max-w-2xl text-sm">
              {result.droppedActions === 1
                ? "1 bookmark action from the original — a script, a launched file or a jump into another file — is not in the copy."
                : `${result.droppedActions.toLocaleString("en-US")} bookmark actions from the original — scripts, launched files or jumps into other files — are not in the copy.`}
            </p>
          )}
          {pdf.digitalSignatures > 0 && (
            <p className="text-muted max-w-2xl text-sm">
              The original was digitally signed. The copy is a rewritten file,
              so that signature no longer verifies in it.
            </p>
          )}
          <button
            type="button"
            onClick={() => downloadBytes(result.bytes, name)}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Download className="size-4" aria-hidden />
            {BOOKMARK_DOWNLOAD_LABEL}
          </button>
        </div>
      </ResultPanel>
    );
  }

  const canUndo = Boolean(history?.past.length);
  const canRedo = Boolean(history?.future.length);
  const step = Number(every);
  const toGenerate =
    reading && Number.isInteger(step) && step >= 1
      ? Math.ceil(reading.pageCount / step)
      : 0;
  const generateBlocked =
    toGenerate === 0 || total + toGenerate > BOOKMARK_EDIT_MAX;

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />
      <p aria-live="polite" role="status" className="sr-only">
        {said.text}
        {said.n % 2 ? " " : ""}
      </p>

      {readError ? (
        <ErrorNote message={readError} />
      ) : !reading || !history ? (
        <p className="text-muted inline-flex items-center gap-2 text-sm">
          <Spinner /> Reading bookmarks…
        </p>
      ) : (
        <>
          <ReadingNotes reading={reading} />
          <RunnerSection
            title={BOOKMARK_LIST_TITLE}
            aside={
              <span className="text-muted tnum text-xs">
                {bookmarkCount(total)}
              </span>
            }
          >
            <div className="flex flex-wrap gap-2">
              <button
                ref={addButton}
                type="button"
                onClick={act.add}
                aria-disabled={full || undefined}
                className={buttonVariants({ variant: "secondary" })}
              >
                <Plus className="size-4" aria-hidden />
                {BOOKMARK_ADD_LABEL}
              </button>
              <button
                type="button"
                onClick={act.undo}
                aria-disabled={!canUndo || undefined}
                className={buttonVariants({ variant: "ghost" })}
              >
                <Undo2 className="size-4" aria-hidden />
                Undo
              </button>
              <button
                type="button"
                onClick={act.redo}
                aria-disabled={!canRedo || undefined}
                className={buttonVariants({ variant: "ghost" })}
              >
                <Redo2 className="size-4" aria-hidden />
                Redo
              </button>
            </div>
            {full && (
              <p className="text-muted max-w-2xl text-xs">
                {`This list holds ${BOOKMARK_EDIT_MAX.toLocaleString("en-US")} bookmarks, the most this tool saves.`}
              </p>
            )}
            {items.length === 0 ? (
              <p className="text-muted max-w-2xl text-sm">
                No bookmarks. Saving now gives a copy without any.
              </p>
            ) : (
              <>
                <p className="text-muted max-w-2xl text-xs">
                  A bookmark shown expanded here opens expanded in the saved
                  PDF. Leave the page empty for a heading that opens no page.
                </p>
                <BookmarkList
                  items={items}
                  depth={1}
                  pageCount={reading.pageCount}
                  menu={menu}
                  setMenu={setMenu}
                  registerTitle={registerTitle}
                  act={act}
                  editTitle={editTitle}
                  endTyping={() => {
                    typing.current = null;
                  }}
                  full={full}
                />
              </>
            )}
          </RunnerSection>

          <RunnerSection title="From page numbers">
            <div className="flex flex-wrap items-end gap-2">
              <EveryField value={every} onChange={setEvery} />
              <button
                type="button"
                onClick={generate}
                aria-disabled={generateBlocked || undefined}
                className={buttonVariants({ variant: "secondary" })}
              >
                <ListPlus className="size-4" aria-hidden />
                {BOOKMARK_GENERATE_LABEL}
              </button>
            </div>
            <p className="text-muted max-w-2xl text-xs">
              {toGenerate > 0
                ? `Adds ${bookmarkCount(toGenerate)} at the end — “Page 1”${toGenerate > 1 ? `, “Page ${1 + step}”` : ""}${toGenerate > 2 ? " and so on" : ""} — each opening its page.`
                : "Type how many pages apart the bookmarks should be."}
              {toGenerate > 0 && total + toGenerate > BOOKMARK_EDIT_MAX
                ? ` That would pass ${BOOKMARK_EDIT_MAX.toLocaleString("en-US")} bookmarks, the most this tool saves.`
                : ""}
            </p>
          </RunnerSection>

          <label className="flex min-h-11 max-w-2xl cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={showPanel && items.length > 0}
              aria-disabled={items.length === 0 || undefined}
              onChange={(event) => {
                if (items.length > 0) setShowPanel(event.target.checked);
              }}
              className="accent-accent size-5 shrink-0"
            />
            <span className="text-fg">
              Open with the bookmarks panel showing
            </span>
          </label>
        </>
      )}

      <PrivacyLine>
        The PDF is read and saved on your device — nothing is uploaded.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={!history}
            busyLabel="Saving…"
          >
            <Bookmark className="size-4" aria-hidden />
            {BOOKMARK_RUN_LABEL}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

/** What the reading found that a reader should know before saving. */
function ReadingNotes({ reading }: { reading: OutlineReading }) {
  const notes: string[] = [];
  if (reading.total === 0) {
    notes.push(
      "This PDF has no bookmarks yet. Add them one by one, or from page numbers below.",
    );
  }
  if (reading.droppedActions > 0) {
    notes.push(
      reading.droppedActions === 1
        ? "1 bookmark runs a script, launches a file or jumps into another file. That action will not be in the copy; the bookmark stays."
        : `${reading.droppedActions.toLocaleString("en-US")} bookmark actions run scripts, launch files or jump into other files. Those actions will not be in the copy; the bookmarks stay.`,
    );
  }
  if (reading.brokenTargets > 0) {
    notes.push(
      reading.brokenTargets === 1
        ? "1 bookmark points at no page in this PDF. It is shown with no page; give it one or leave it as a heading."
        : `${reading.brokenTargets.toLocaleString("en-US")} bookmarks point at no page in this PDF. They are shown with no page; give them one or leave them as headings.`,
    );
  }
  if (reading.cutLinks > 0) {
    notes.push(
      "This PDF's bookmark list was damaged: it looped back on itself or pointed outside itself. The bad links were cut; every bookmark in it is listed once.",
    );
  }
  if (notes.length === 0) return null;
  return (
    <div data-bookmarks-notes="" className="flex max-w-2xl flex-col gap-1">
      {notes.map((note) => (
        <p key={note} className="text-muted text-sm">
          {note}
        </p>
      ))}
    </div>
  );
}

function EveryField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        One bookmark every … pages
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl min-h-11 w-24 border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
      />
    </div>
  );
}

type Actions = {
  addBelow: (id: string) => void;
  addInside: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
  indent: (id: string) => void;
  outdent: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string, open: boolean) => void;
  target: (id: string, target: BookmarkTarget) => void;
};

interface ListProps {
  items: Tree;
  depth: number;
  pageCount: number;
  menu: string | null;
  setMenu: (id: string | null) => void;
  registerTitle: (id: string, el: HTMLInputElement | null) => void;
  act: Actions;
  editTitle: (id: string, title: string) => void;
  endTyping: () => void;
  full: boolean;
}

/** One level of the outline. Past six levels the indent stops growing. */
function BookmarkList(props: ListProps & { root?: Tree }) {
  const { items, depth } = props;
  const root = props.root ?? items;
  return (
    <ul
      role="list"
      aria-label={depth === 1 ? BOOKMARK_LIST_TITLE : undefined}
      data-bookmark-level={depth}
      className={cn(
        "flex min-w-0 flex-col gap-2",
        depth > 1 &&
          depth <= 6 &&
          "border-line ml-2 border-l pl-2 sm:ml-3 sm:pl-3",
      )}
    >
      {items.map((node, index) => (
        <BookmarkRow
          key={node.id}
          {...props}
          root={root}
          node={node}
          index={index}
          siblings={items.length}
        />
      ))}
    </ul>
  );
}

const ACTION_BUTTON =
  "border-line text-fg hover:bg-wash rounded-ctl inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 border px-3 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

function BookmarkRow({
  node,
  index,
  siblings,
  root,
  ...props
}: ListProps & {
  node: BookmarkNode;
  index: number;
  siblings: number;
  root: Tree;
}) {
  const {
    depth,
    pageCount,
    menu,
    setMenu,
    registerTitle,
    act,
    editTitle,
    endTyping,
  } = props;
  const ids = useId();
  const name = quoted(node.title);
  const moves = movesFor(root, node.id);
  const open = menu === node.id;
  const inside = countAll(node.children);
  const hasKids = node.children.length > 0;
  const actions = `${ids}-actions`;
  const pageId = `${ids}-page`;

  return (
    <li data-bookmark={node.id} className="flex min-w-0 flex-col gap-2">
      <div className="border-line bg-canvas rounded-panel flex min-w-0 flex-col gap-2 border p-2">
        <div className="flex min-w-0 items-center gap-1">
          {hasKids ? (
            <button
              type="button"
              aria-expanded={node.open}
              aria-label={`Bookmarks inside ${name}`}
              onClick={() => act.toggle(node.id, !node.open)}
              className="text-muted hover:text-fg rounded-ctl inline-flex size-11 shrink-0 items-center justify-center"
            >
              <ChevronRight
                className={cn("size-4 transition", node.open && "rotate-90")}
                aria-hidden
              />
            </button>
          ) : (
            <span className="inline-flex size-11 shrink-0 items-center justify-center">
              <Bookmark className="text-faint size-3.5" aria-hidden />
            </span>
          )}
          <input
            ref={(el) => registerTitle(node.id, el)}
            type="text"
            value={node.title}
            maxLength={Math.max(BOOKMARK_TITLE_MAX, node.title.length)}
            aria-label={`Title, level ${depth}, ${index + 1} of ${siblings}`}
            placeholder="Untitled"
            onChange={(event) => editTitle(node.id, event.target.value)}
            onBlur={endTyping}
            className="border-line text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl min-h-11 w-full min-w-0 flex-1 border px-3 py-2 text-sm transition outline-none focus:ring-2"
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 pl-12">
          <PageField
            id={pageId}
            name={name}
            target={node.target}
            pageCount={pageCount}
            onChange={(target) => act.target(node.id, target)}
          />
          <button
            type="button"
            aria-expanded={open}
            aria-controls={actions}
            aria-label={`${BOOKMARK_MORE_LABEL} for ${name}`}
            onClick={() => setMenu(open ? null : node.id)}
            className={cn(ACTION_BUTTON, "ml-auto")}
          >
            <Ellipsis className="size-4" aria-hidden />
            {BOOKMARK_MORE_LABEL}
          </button>
        </div>
        <div
          id={actions}
          role="group"
          aria-label={`Actions for ${name}`}
          hidden={!open}
          className="flex flex-wrap gap-2 pl-12"
        >
          <ActionButton
            label="Move up"
            name={name}
            disabled={!moves.up}
            onClick={() => act.move(node.id, -1)}
          >
            <ArrowUp className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton
            label="Move down"
            name={name}
            disabled={!moves.down}
            onClick={() => act.move(node.id, 1)}
          >
            <ArrowDown className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton
            label="Indent"
            name={name}
            disabled={!moves.indent}
            onClick={() => act.indent(node.id)}
          >
            <IndentIncrease className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton
            label="Outdent"
            name={name}
            disabled={!moves.outdent}
            onClick={() => act.outdent(node.id)}
          >
            <IndentDecrease className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton
            label="Add below"
            name={name}
            disabled={props.full}
            onClick={() => act.addBelow(node.id)}
          >
            <Plus className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton
            label="Add inside"
            name={name}
            disabled={props.full || depth >= BOOKMARK_DEPTH_MAX}
            onClick={() => act.addInside(node.id)}
          >
            <CornerDownRight className="size-4" aria-hidden />
          </ActionButton>
          <ActionButton
            label={inside ? `Delete with ${inside} inside` : "Delete"}
            name={
              inside ? `${name} and ${bookmarkCount(inside)} inside it` : name
            }
            onClick={() => act.remove(node.id)}
          >
            <Trash2 className="size-4" aria-hidden />
          </ActionButton>
        </div>
      </div>
      {hasKids && node.open && (
        <BookmarkList
          {...props}
          root={root}
          items={node.children}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

/**
 * A button that stays focusable when it cannot act (`aria-disabled`): a
 * "Move up" pressed until its row reaches the top must not drop focus.
 */
function ActionButton({
  label,
  name,
  disabled,
  onClick,
  children,
}: {
  label: string;
  name: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${name}`}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={ACTION_BUTTON}
    >
      {children}
      {label}
    </button>
  );
}

/**
 * The page a bookmark opens. Empty means none: a heading. A link or a viewer
 * action shows what it does until a page is typed over it.
 */
function PageField({
  id,
  name,
  target,
  pageCount,
  onChange,
}: {
  id: string;
  name: string;
  target: BookmarkTarget;
  pageCount: number;
  onChange: (target: BookmarkTarget) => void;
}) {
  const shown = target.kind === "page" ? String(target.page) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? shown;
  const n = Number(value);
  const invalid =
    value !== "" && !(Number.isInteger(n) && n >= 1 && n <= pageCount);
  const placeholder =
    target.kind === "uri"
      ? "Link"
      : target.kind === "named"
        ? "Action"
        : "No page";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        Page
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        aria-label={`Page for ${name}`}
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={
          invalid || target.kind !== "page" ? `${id}-what` : undefined
        }
        onChange={(event) => {
          const text = event.target.value.replace(/\D/g, "");
          const page = Number(text);
          if (text === "") {
            setDraft(null);
            if (target.kind === "page") onChange({ kind: "none" });
          } else if (Number.isInteger(page) && page >= 1 && page <= pageCount) {
            setDraft(null);
            onChange({ kind: "page", page });
          } else setDraft(text);
        }}
        onBlur={() => setDraft(null)}
        className="border-line text-fg placeholder:text-muted focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl aria-invalid:border-danger min-h-11 w-20 border px-3 py-2 text-sm transition outline-none focus:ring-2"
      />
      {(invalid || target.kind !== "page") && (
        <span
          id={`${id}-what`}
          className="text-muted min-w-0 text-xs wrap-anywhere"
        >
          {invalid
            ? `1 to ${pageCount.toLocaleString("en-US")}`
            : target.kind === "uri"
              ? `Opens ${target.uri}`
              : target.kind === "named"
                ? `Viewer action: ${target.action}`
                : null}
        </span>
      )}
    </div>
  );
}
