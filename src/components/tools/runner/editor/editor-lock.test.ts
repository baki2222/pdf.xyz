// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_STYLE, type EditorObject } from "@/lib/pdf/editor/model";
import { COMMENT_KINDS } from "@/lib/pdf/offered-kinds";
import {
  LOCKED_ACTION_MESSAGE,
  LOCKED_FILL_MESSAGE,
  COMMENT_TOOLS,
  TOOLS,
  editorReducer,
  initialEditorState,
  type EditorAction,
  type Tool,
} from "./editor-state";

/**
 * A restricted PDF's lock, held by the REDUCER — under every button,
 * shortcut, paste and drop — so a control that forgets to disable itself
 * still cannot change a page the author locked.
 */

const locked = (fill: boolean) =>
  initialEditorState({ tool: "highlight", pageCount: 2, lock: { fill } });

const addText: EditorAction = {
  type: "commit",
  command: {
    label: "Add text box",
    changes: [
      {
        id: "t1",
        before: null,
        after: {
          ...DEFAULT_TEXT_STYLE,
          id: "t1",
          kind: "text",
          page: 0,
          x: 10,
          y: 10,
          width: 100,
          text: "x",
        },
        at: 0,
      },
    ],
  },
};

describe("the editor lock", () => {
  it("opens on Select whatever tool the runner asked for", () => {
    expect(locked(true).tool).toBe("select");
    expect(initialEditorState({ tool: "highlight", pageCount: 2 }).tool).toBe(
      "highlight",
    );
  });

  it("refuses every tool but Select, and every commit, and says why", () => {
    let s = locked(true);
    for (const tool of TOOLS.filter((t) => t !== "select")) {
      s = editorReducer(s, { type: "tool", tool });
      expect(s.tool).toBe("select");
    }
    s = editorReducer(s, addText);
    expect(s.objects).toEqual([]);
    expect(s.said.message).toBe(LOCKED_ACTION_MESSAGE);
  });

  it("fills a field when the author allows it, and not when they don't", () => {
    const yes = editorReducer(locked(true), {
      type: "fill",
      name: "a",
      value: "b",
    });
    expect(yes.fills).toEqual({ a: "b" });
    const no = editorReducer(locked(false), {
      type: "fill",
      name: "a",
      value: "b",
    });
    expect(no.fills).toEqual({});
    expect(no.said.message).toBe(LOCKED_FILL_MESSAGE);
  });

  it("CONTROL: unlocked, the same commit lands", () => {
    const s = editorReducer(
      editorReducer(locked(true), { type: "unlock" }),
      addText,
    );
    expect(s.lock).toBeNull();
    expect(s.objects).toHaveLength(1);
  });
});

describe("the editor lock, when the author allows comments (/P bit 6)", () => {
  const commenting = (tool: Tool = "highlight") =>
    initialEditorState({
      tool,
      pageCount: 2,
      lock: { fill: true, annotate: true },
    });
  const add = (obj: EditorObject): EditorAction => ({
    type: "commit",
    command: {
      label: "Add",
      changes: [{ id: obj.id, before: null, after: obj, at: 0 }],
    },
  });
  const highlight: EditorObject = {
    id: "h1",
    kind: "highlight",
    page: 0,
    x: 10,
    y: 10,
    width: 50,
    height: 12,
    color: "#facc15",
    opacity: 0.4,
  };

  it("keeps the comment tools and Select, and only those", () => {
    // Annotate PDF opens on Highlight, and it stays there.
    expect(commenting().tool).toBe("highlight");
    expect(commenting("text").tool).toBe("select");
    for (const tool of TOOLS) {
      const s = editorReducer(commenting("select"), { type: "tool", tool });
      expect(s.tool).toBe(
        tool === "select" || COMMENT_TOOLS.has(tool) ? tool : "select",
      );
    }
  });

  it("every comment tool places a kind saved as a comment, and every such kind has a tool", () => {
    // The tool → kind each one places (wysiwyg-editor's placement).
    const places: Partial<Record<Tool, string>> = {
      rect: "shape",
      ellipse: "shape",
      line: "line",
      arrow: "line",
      highlight: "highlight",
      ink: "ink",
      note: "note",
    };
    const kinds = new Set([...COMMENT_TOOLS].map((t) => places[t]));
    expect(kinds.has(undefined)).toBe(false);
    expect([...kinds].sort()).toEqual([...COMMENT_KINDS].sort());
    // Health check: the set is not empty, and not everything.
    expect(COMMENT_TOOLS.size).toBeGreaterThan(0);
    expect(COMMENT_TOOLS.size).toBeLessThan(TOOLS.length - 1);
  });

  it("lands a highlight, refuses a text box, a whiteout and a page change", () => {
    let s = editorReducer(commenting(), add(highlight));
    expect(s.objects.map((o) => o.id)).toEqual(["h1"]);
    s = editorReducer(s, addText);
    expect(s.objects.map((o) => o.id)).toEqual(["h1"]);
    expect(s.said.message).toBe(LOCKED_ACTION_MESSAGE);
    s = editorReducer(
      s,
      add({
        id: "w1",
        kind: "whiteout",
        page: 0,
        x: 0,
        y: 0,
        width: 9,
        height: 9,
      }),
    );
    expect(s.objects.map((o) => o.id)).toEqual(["h1"]);
    const pages = s.pages;
    s = editorReducer(s, {
      type: "commit",
      command: {
        label: "Delete page",
        changes: [],
        pages: { before: pages, after: pages.slice(1) },
      },
    });
    expect(s.pages).toEqual(pages);
  });

  it("types into a note, not into a text box", () => {
    const note = {
      ...DEFAULT_TEXT_STYLE,
      id: "n1",
      kind: "note" as const,
      page: 0,
      x: 10,
      y: 10,
      width: 100,
      text: "",
      fill: "#fef08a",
    };
    const s = editorReducer(commenting("note"), {
      type: "startEdit",
      edit: { id: "n1", isNew: true, text: "", base: note },
    });
    expect(s.editing?.id).toBe("n1");
    const t = editorReducer(commenting("note"), {
      type: "startEdit",
      edit: {
        id: "t1",
        isNew: true,
        text: "",
        base: { ...note, kind: "text", id: "t1" } as never,
      },
    });
    expect(t.editing).toBeNull();
  });

  it("CONTROL: without the grant, the same highlight is refused", () => {
    const s = editorReducer(locked(true), add(highlight));
    expect(s.objects).toEqual([]);
  });
});

describe("the editor lock — unlock", () => {
  it("CONTROL: unlocked, the same commit lands", () => {
    const s = editorReducer(
      editorReducer(locked(true), { type: "unlock" }),
      addText,
    );
    expect(s.lock).toBeNull();
    expect(s.objects).toHaveLength(1);
  });
});
