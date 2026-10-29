// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_STYLE } from "@/lib/pdf/editor/model";
import {
  LOCKED_ACTION_MESSAGE,
  LOCKED_FILL_MESSAGE,
  TOOLS,
  editorReducer,
  initialEditorState,
  type EditorAction,
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
