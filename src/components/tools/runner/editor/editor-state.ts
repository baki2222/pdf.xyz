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
  type EditorObject,
  type NoteObject,
  type TextBoxObject,
  type TextStyle,
} from "@/lib/pdf/editor/model";
import type { RasterImageFormat } from "@/lib/pdf/pdf-lib";
import type { SignatureStyle } from "@/lib/pdf/offered-kinds";

/**
 * The editor's state machine. Pure — the component dispatches; nothing here
 * touches the DOM. History lives in `@/lib/pdf/editor/history`; this adds the
 * selection, the active tool, the in-place text edit and the transient
 * preview a drag draws before it is committed as ONE step.
 */

export const TOOLS = [
  "select",
  "text",
  "image",
  "signature",
  "rect",
  "ellipse",
  "line",
  "arrow",
  "whiteout",
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
  base: TextBoxObject | NoteObject;
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
}

export const INITIAL_DEFAULTS: Defaults = {
  text: DEFAULT_TEXT_STYLE,
  note: { ...DEFAULT_TEXT_STYLE, size: 11, fill: DEFAULT_NOTE_FILL },
  shape: { stroke: DEFAULT_STROKE, strokeWidth: 2, fill: null, opacity: 1 },
  line: { stroke: DEFAULT_STROKE, strokeWidth: 2, opacity: 1 },
  highlight: { color: DEFAULT_HIGHLIGHT, opacity: 0.4 },
  ink: { stroke: "#1d4ed8", strokeWidth: 2.5, opacity: 1 },
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
}

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
};

/** A fresh editor opened on `tool` (Annotate PDF opens on Highlight, Sign PDF on Sign). */
export function initialEditorState(tool: Tool): EditorState {
  return { ...INITIAL_STATE, tool };
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
  | { type: "say"; message: string };

function say(state: EditorState, message: string): EditorState["said"] {
  return { message, n: state.said.n + 1 };
}

/** Finish an in-place text edit: an add, a retype, a delete, or nothing. */
function finishEdit(state: EditorState): EditorState {
  const edit = state.editing;
  if (!edit) return state;
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

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "commit": {
      const base = finishEdit(state);
      const done = commit(base.objects, base.history, action.command);
      const alive = new Set(done.objects.map((o) => o.id));
      return {
        ...base,
        ...done,
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
      return {
        ...base,
        objects: step.objects,
        history: step.history,
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
  }
}
