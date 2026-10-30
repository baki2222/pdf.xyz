import {
  EMPTY_HISTORY,
  commit,
  redo,
  sealHistory,
  undo,
  type Command,
  type History,
} from "@/lib/pdf/editor/history";
import {
  DEFAULT_HIGHLIGHT,
  DEFAULT_NOTE_FILL,
  DEFAULT_STROKE,
  DEFAULT_TEXT_STYLE,
  linkUntouched,
  isCommentObject,
  type EditorObject,
  type MarkGlyph,
  type NoteObject,
  type RedactFill,
  type TextBoxObject,
  type TextEditObject,
  type TextStyle,
} from "@/lib/pdf/editor/model";
import type { RasterImageFormat } from "@/lib/pdf/pdf-lib";
import type { SignatureStyle } from "@/lib/pdf/offered-kinds";
import type { FieldFill } from "@/lib/pdf/editor/fields";
import { isIdentity, sourcePages, type PageRef } from "@/lib/pdf/editor/pages";
import {
  defaultDateFormat,
  type DateFormat,
} from "@/lib/pdf/editor/quick-fields";

/**
 * The editor's state machine. Pure — the component dispatches; nothing here
 * touches the DOM. History lives in `@/lib/pdf/editor/history`; this adds the
 * selection, the active tool, the in-place text edit and the transient
 * preview a drag draws before it is committed as ONE step.
 */

export const TOOLS = [
  "select",
  "text",
  "edittext",
  "image",
  "signature",
  "date",
  "initials",
  "name",
  "check",
  "link",
  "field-text",
  "field-checkbox",
  "field-dropdown",
  "field-radio",
  "field-signature",
  "rect",
  "ellipse",
  "line",
  "arrow",
  "whiteout",
  "redact",
  "highlight",
  "ink",
  "note",
] as const;
export type Tool = (typeof TOOLS)[number];

export interface PendingImage {
  kind: "image" | "signature";
  format: RasterImageFormat;
  bytes: Uint8Array;
  /** Natural size in px, for the placed box's aspect. */
  width: number;
  height: number;
}

/** A typed signature: placed as text in its style's face. */
export interface PendingTyped {
  kind: "typed";
  text: string;
  style: SignatureStyle;
}

export type Pending = PendingImage | PendingTyped;

export interface TextEdit {
  id: string;
  /** Not yet in `objects`: committed as an add when the edit ends. */
  isNew: boolean;
  text: string;
  base: TextBoxObject | NoteObject | TextEditObject;
}

export interface Defaults {
  text: TextStyle;
  note: TextStyle & { fill: string };
  shape: {
    stroke: string | null;
    strokeWidth: number;
    fill: string | null;
    opacity: number;
  };
  line: { stroke: string; strokeWidth: number; opacity: number };
  highlight: { color: string; opacity: number };
  ink: { stroke: string; strokeWidth: number; opacity: number };
  redact: { fill: RedactFill };
  mark: { glyph: MarkGlyph; color: string };
  /** How Date writes today. */
  date: { format: DateFormat };
  /**
   * The name Initials and Name write: a typed signature's, or typed for
   * them. Kept for this session only — never stored.
   */
  person: { name: string };
}

export const INITIAL_DEFAULTS: Defaults = {
  text: DEFAULT_TEXT_STYLE,
  note: { ...DEFAULT_TEXT_STYLE, size: 11, fill: DEFAULT_NOTE_FILL },
  shape: { stroke: DEFAULT_STROKE, strokeWidth: 2, fill: null, opacity: 1 },
  line: { stroke: DEFAULT_STROKE, strokeWidth: 2, opacity: 1 },
  highlight: { color: DEFAULT_HIGHLIGHT, opacity: 0.4 },
  ink: { stroke: "#1d4ed8", strokeWidth: 2.5, opacity: 1 },
  redact: { fill: "black" },
  mark: { glyph: "check", color: "#111827" },
  date: { format: "dmy" },
  person: { name: "" },
};

export interface EditorState {
  objects: EditorObject[];
  history: History;
  selected: string[];
  tool: Tool;
  editing: TextEdit | null;
  /** Objects drawn in place of their committed selves during a drag. */
  preview: Record<string, EditorObject> | null;
  pending: Pending | null;
  defaults: Defaults;
  /** The last thing done, for the live region. */
  said: { message: string; n: number };
  /** The pages as displayed: order, turns, blank and deleted pages (`pages.ts`). */
  pages: PageRef[];
  /** Values typed into the file's own form fields, by name. Not undoable. */
  fills: Record<string, FieldFill>;
  /** The file's own links, by origin ref, as they were read (once). */
  importedLinks: string[] | null;
  /**
   * The author's restrictions, while they hold: an encrypted PDF opened
   * without its owner password (`@/lib/pdf/security/protected-pdf`). Null = every tool.
   */
  lock: EditorLock | null;
}

/**
 * What a restricted PDF's author allows the editor without the owner
 * password. Two things can be written back under the author's encryption
 * (an incremental update): the file's own fields filled, and — when the
 * author allows comments — highlights, drawings, notes, shapes and lines
 * saved as comments. Everything else the editor makes is page content,
 * which the author withheld.
 */
export interface EditorLock {
  /** The existing form fields may be filled (/P bit 9 or 6). */
  fill: boolean;
  /** Comments may be added (/P bit 6): the comment tools work. */
  annotate?: boolean;
}

/**
 * The tools that place comments ("Save markups as comments" writes their
 * objects as annotations) — what a restricted PDF whose author allows
 * comments keeps, beside Select. Each places a kind of
 * `@/lib/pdf/offered-kinds`'s COMMENT_KINDS (`editor-lock.test.ts`).
 */
export const COMMENT_TOOLS: ReadonlySet<Tool> = new Set<Tool>([
  "rect",
  "ellipse",
  "line",
  "arrow",
  "highlight",
  "ink",
  "note",
]);

/** May `tool` be picked under `lock`? */
export function toolAllowed(tool: Tool, lock: EditorLock | null): boolean {
  if (!lock || tool === "select") return true;
  return lock.annotate === true && COMMENT_TOOLS.has(tool);
}

/** Under `lock`, may this command land? Only comments, and never a page change. */
function commandAllowed(command: Command, lock: EditorLock): boolean {
  if (!lock.annotate || command.pages) return false;
  return command.changes.every(
    (c) =>
      (c.before === null || isCommentObject(c.before)) &&
      (c.after === null || isCommentObject(c.after)),
  );
}

/** What the editor says when a locked action is tried. */
export const LOCKED_ACTION_MESSAGE =
  "The author of this PDF doesn't allow changes to its pages. Enter the owner password to unlock every tool.";
/** …and when filling is not allowed either. */
export const LOCKED_FILL_MESSAGE =
  "The author of this PDF doesn't allow filling in its form. Enter the owner password to unlock every tool.";

export const INITIAL_STATE: EditorState = {
  objects: [],
  history: EMPTY_HISTORY,
  selected: [],
  tool: "select",
  editing: null,
  preview: null,
  pending: null,
  defaults: INITIAL_DEFAULTS,
  said: { message: "", n: 0 },
  pages: [],
  fills: {},
  importedLinks: null,
  lock: null,
};

/**
 * A fresh editor on a file of `pageCount` pages, opened on `tool` (Annotate
 * PDF opens on Highlight, Sign PDF on Sign).
 */
export function initialEditorState({
  tool,
  pageCount,
  locale,
  lock = null,
}: {
  tool: Tool;
  pageCount: number;
  locale?: string;
  lock?: EditorLock | null;
}): EditorState {
  return {
    ...INITIAL_STATE,
    // Locked, the tool asked for if it places comments the author allows
    // (Annotate PDF's Highlight), else Select (it is what fills a field).
    tool: toolAllowed(tool, lock) ? tool : "select",
    lock,
    pages: sourcePages(pageCount),
    defaults: {
      ...INITIAL_DEFAULTS,
      date: { format: defaultDateFormat(locale) },
    },
  };
}

/** The file's links that were deleted (they are absent from the objects now). */
export function removedLinks(state: EditorState): string[] {
  const present = new Set(
    state.objects.flatMap((o) =>
      o.kind === "link" && o.origin ? [o.origin.ref] : [],
    ),
  );
  return (state.importedLinks ?? []).filter((ref) => !present.has(ref));
}

/**
 * Is there anything to apply? An object placed or changed, a file link
 * deleted, a page operation, or a field filled. The file's own links, as
 * read, do not count.
 */
export function hasEdits(state: EditorState, pageCount: number): boolean {
  return (
    state.objects.some(
      (o) =>
        !(o.kind === "link" && linkUntouched(o)) &&
        !((o.kind === "text" || o.kind === "note") && !o.text.trim()),
    ) ||
    removedLinks(state).length > 0 ||
    !isIdentity(state.pages, pageCount) ||
    Object.keys(state.fills).length > 0
  );
}

export type EditorAction =
  | { type: "commit"; command: Command; select?: string[]; say?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; ids: string[] }
  | { type: "tool"; tool: Tool }
  | { type: "preview"; objects: Record<string, EditorObject> | null }
  | { type: "startEdit"; edit: TextEdit }
  | { type: "editText"; text: string }
  | { type: "endEdit" }
  | { type: "pending"; pending: Pending | null }
  | { type: "defaults"; patch: Partial<Defaults> }
  | { type: "seal" }
  | { type: "say"; message: string }
  /** The file's own links, read once when it opens: not an undo step. */
  | { type: "import"; links: EditorObject[] }
  | { type: "fill"; name: string; value: FieldFill | null }
  /** The owner password was verified: every tool, from now on. */
  | { type: "unlock" };

/** Actions that change a page, refused while the author's lock holds. */
const LOCKED_ACTIONS: ReadonlySet<EditorAction["type"]> = new Set([
  "commit",
  "startEdit",
]);

function say(state: EditorState, message: string): EditorState["said"] {
  return { message, n: state.said.n + 1 };
}

/** Finish an in-place text edit: an add, a retype, a delete, or nothing. */
function finishEdit(state: EditorState): EditorState {
  const edit = state.editing;
  if (!edit) return state;
  if (edit.base.kind === "textedit")
    return finishRetext(state, edit, edit.base);
  const empty = edit.text.trim().length === 0;
  const current = state.objects.find((o) => o.id === edit.id) as
    TextBoxObject | NoteObject | undefined;
  let command: Command | null = null;
  let message = "";
  if (edit.isNew) {
    if (!empty) {
      command = {
        label: `Add ${edit.base.kind === "note" ? "note" : "text box"}`,
        changes: [
          {
            id: edit.id,
            before: null,
            after: { ...edit.base, text: edit.text },
            at: state.objects.length,
          },
        ],
      };
      message = `${edit.base.kind === "note" ? "Note" : "Text box"} added`;
    }
  } else if (current) {
    if (empty) {
      command = {
        label: "Delete text box",
        changes: [
          {
            id: edit.id,
            before: current,
            after: null,
            at: state.objects.indexOf(current),
          },
        ],
      };
      message = "Empty text box removed";
    } else if (current.text !== edit.text) {
      command = {
        label: "Edit text",
        changes: [
          {
            id: edit.id,
            before: current,
            after: { ...current, text: edit.text },
            at: state.objects.indexOf(current),
          },
        ],
      };
      message = "Text updated";
    }
  }
  // A box just placed hands back to Select, so the next press can move it.
  const next: EditorState = {
    ...state,
    editing: null,
    tool: edit.isNew ? "select" : state.tool,
  };
  if (!command) return next;
  const done = commit(next.objects, next.history, command);
  return {
    ...next,
    ...done,
    selected: empty ? [] : [edit.id],
    said: say(state, message),
  };
}

/**
 * Finish editing text that was already on the page. A new edit is added
 * only if the words changed; an existing one is updated, or removed (the
 * run is back as it was) when the words are the original again. Empty words
 * are kept: they delete the run.
 */
function finishRetext(
  state: EditorState,
  edit: TextEdit,
  base: TextEditObject,
): EditorState {
  const text = edit.text.replace(/[\r\n\t]+/g, " ");
  const current = state.objects.find((o) => o.id === edit.id) as
    TextEditObject | undefined;
  const next: EditorState = { ...state, editing: null };
  let command: Command | null = null;
  let message = "";
  if (edit.isNew || !current) {
    if (text !== base.original) {
      command = {
        label: text.trim() ? "Edit text" : "Delete text",
        changes: [
          {
            id: edit.id,
            before: null,
            after: { ...base, text },
            at: state.objects.length,
          },
        ],
      };
      message = text.trim() ? "Text edited" : "Text deleted";
    }
  } else if (text === current.original) {
    command = {
      label: "Restore text",
      changes: [
        {
          id: edit.id,
          before: current,
          after: null,
          at: state.objects.indexOf(current),
        },
      ],
    };
    message = "Original text restored";
  } else if (text !== current.text) {
    command = {
      label: "Edit text",
      changes: [
        {
          id: edit.id,
          before: current,
          after: { ...current, text },
          at: state.objects.indexOf(current),
        },
      ],
    };
    message = text.trim() ? "Text edited" : "Text deleted";
  }
  if (!command) return next;
  const done = commit(next.objects, next.history, command);
  const alive = done.objects.some((o) => o.id === edit.id);
  return {
    ...next,
    ...done,
    selected: alive ? [edit.id] : [],
    said: say(state, message),
  };
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  // The lock is enforced HERE, under every tool, shortcut, paste and drop:
  // a control that forgets to disable itself still cannot change a page the
  // author locked. (The writer refuses too — `@/lib/pdf/security/incremental`.)
  // With comments allowed, a commit of comment objects only, a note's text
  // edit, and the comment tools pass; nothing else does.
  if (state.lock) {
    const lock = state.lock;
    const allowed =
      action.type === "commit"
        ? commandAllowed(action.command, lock)
        : action.type === "startEdit"
          ? lock.annotate === true && action.edit.base.kind === "note"
          : action.type === "tool"
            ? toolAllowed(action.tool, lock)
            : !LOCKED_ACTIONS.has(action.type);
    if (!allowed) return { ...state, said: say(state, LOCKED_ACTION_MESSAGE) };
    if (action.type === "fill" && !state.lock.fill)
      return { ...state, said: say(state, LOCKED_FILL_MESSAGE) };
  }
  switch (action.type) {
    case "unlock":
      return { ...state, lock: null };
    case "commit": {
      const base = finishEdit(state);
      const done = commit(base.objects, base.history, action.command);
      const alive = new Set(done.objects.map((o) => o.id));
      return {
        ...base,
        ...done,
        pages: action.command.pages?.after ?? base.pages,
        preview: null,
        selected: (action.select ?? base.selected).filter((id) =>
          alive.has(id),
        ),
        said: action.say ? say(base, action.say) : base.said,
      };
    }
    case "undo":
    case "redo": {
      const base = finishEdit(state);
      const step =
        action.type === "undo"
          ? undo(base.objects, base.history)
          : redo(base.objects, base.history);
      if (!step.command) {
        return {
          ...base,
          said: say(
            base,
            action.type === "undo" ? "Nothing to undo" : "Nothing to redo",
          ),
        };
      }
      const alive = new Set(step.objects.map((o) => o.id));
      const touched = step.command.changes
        .map((c) => c.id)
        .filter((id) => alive.has(id));
      const pages = step.command.pages
        ? action.type === "undo"
          ? step.command.pages.before
          : step.command.pages.after
        : base.pages;
      return {
        ...base,
        objects: step.objects,
        history: step.history,
        pages,
        preview: null,
        selected: touched,
        said: say(
          base,
          `${action.type === "undo" ? "Undid" : "Redid"}: ${step.command.label}`,
        ),
      };
    }
    case "select":
      return {
        ...state,
        selected: action.ids,
        history: sealHistory(state.history),
      };
    case "tool": {
      const base = finishEdit(state);
      return {
        ...base,
        tool: action.tool,
        selected: action.tool === "select" ? base.selected : [],
        // A signature made once is kept for the next press of Sign (another
        // copy, another page); a picked image is placed once.
        pending:
          base.pending &&
          (base.pending.kind !== "image" || action.tool === "image")
            ? base.pending
            : null,
      };
    }
    case "preview":
      return { ...state, preview: action.objects };
    case "startEdit": {
      const base = finishEdit(state);
      return {
        ...base,
        editing: action.edit,
        selected: [action.edit.id],
      };
    }
    case "editText":
      return state.editing
        ? { ...state, editing: { ...state.editing, text: action.text } }
        : state;
    case "endEdit":
      return finishEdit(state);
    case "pending":
      return { ...state, pending: action.pending };
    case "defaults":
      return { ...state, defaults: { ...state.defaults, ...action.patch } };
    case "seal":
      return { ...state, history: sealHistory(state.history) };
    case "say":
      return { ...state, said: say(state, action.message) };
    case "import": {
      // Once per session: the editor remounts after "adjust", and must not
      // read the file's links in a second time.
      if (state.importedLinks !== null) return state;
      const refs = action.links.flatMap((o) =>
        o.kind === "link" && o.origin ? [o.origin.ref] : [],
      );
      return {
        ...state,
        objects: [...action.links, ...state.objects],
        importedLinks: refs,
      };
    }
    case "fill": {
      const fills = { ...state.fills };
      if (action.value === null) delete fills[action.name];
      else fills[action.name] = action.value;
      return { ...state, fills };
    }
  }
}
