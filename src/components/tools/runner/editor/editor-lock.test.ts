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
      underline: "highlight",
      strikeout: "highlight",
      ink: "ink",
      marker: "ink",
      note: "note",
      comment: "note",
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

/**
 * The help beside a restricted page (review of 62aa1808, 2026-11-08) listed
 * "Highlight, Draw, Note and the shapes" while the lock had also enabled
 * Underline, Strikethrough, Highlighter and Comment. It is now built from
 * COMMENT_TOOLS by button label (`lockedCommentHelp` in `toolbar.tsx`).
 */
describe("the locked help names every tool the lock allows", () => {
  it("names every Mark up tool in COMMENT_TOOLS by its label, and the shapes", async () => {
    const { lockedCommentHelp, TOOL_BUTTONS, TOOL_GROUPS } =
      await import("./toolbar");
    const markUp = TOOL_GROUPS.find((g) => g.name === "Mark up")!.tools;
    const allowed = markUp.filter((t) => COMMENT_TOOLS.has(t));
    // Health: the group and the set overlap in more than the old four.
    expect(allowed.length).toBeGreaterThanOrEqual(7);
    const help = lockedCommentHelp();
    const missing = allowed
      .map((t) => TOOL_BUTTONS.find((b) => b.tool === t)!.label)
      .filter((label) => !new RegExp(`\\b${label}\\b`).test(help));
    expect(missing).toEqual([]);
    expect(help).toMatch(/\bthe shapes\b/);
    // Control: the typed sentence it replaced misses four of them.
    const old =
      "Highlight, Draw, Note and the shapes are saved as comments, which this PDF's author allows.";
    expect(
      allowed
        .map((t) => TOOL_BUTTONS.find((b) => b.tool === t)!.label)
        .filter((label) => !new RegExp(`\\b${label}\\b`).test(old)),
    ).toEqual(["Underline", "Strikethrough", "Highlighter", "Comment"]);
  });

  it("the editor shows that help, not a typed copy of it", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/components/tools/runner/editor/wysiwyg-editor.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /state\.lock\.annotate\s*\?\s*lockedCommentHelp\(\)/,
    );
    expect(source).not.toMatch(/are saved as comments, which this PDF/);
  });

  /*
   * The reader of that help is the page, and the page is read by Playwright,
   * which this suite does not run. b4ff355b changed the help and left
   * e2e/restricted-pdf.spec.ts asserting the typed four-tool sentence word
   * for word, a red the next CI run would have been first to see. Every e2e
   * literal of the help (found by its wording, not by file name) must be
   * what lockedCommentHelp() returns today.
   */
  it("every e2e spec that asserts the help asserts lockedCommentHelp()", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const { lockedCommentHelp } = await import("./toolbar");
    const dir = path.join(process.cwd(), "e2e");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.ts$/.test(f))
      .map((f) => path.join(dir, f));
    // Health: the e2e tree was found and is not a stub.
    expect(files.length).toBeGreaterThan(20);
    const literal = /"([^"\n]*saved as comments, which this PDF[^"\n]*)"/g;
    const found = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(literal)].map((m) => ({
        file: path.relative(process.cwd(), f).split(path.sep).join("/"),
        text: m[1]!,
      })),
    );
    // Positive control: restricted-pdf.spec.ts asserts it.
    expect(found.map((x) => x.file)).toContain("e2e/restricted-pdf.spec.ts");
    expect(found.filter((x) => x.text !== lockedCommentHelp())).toEqual([]);
  });
});
