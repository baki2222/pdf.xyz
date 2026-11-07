// @vitest-environment jsdom
/**
 * The panel beside the page with the Comment tool chosen and nothing
 * selected (review of 62aa1808, 2026-11-08). It showed the Note controls —
 * font, size, line height, paper — titled "New note", because the Comment
 * tool shares the note's style bucket, though a comment's words are drawn
 * by the reader's popup in its own font: only its colour is the editor's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { STICKY_LABEL } from "@/lib/pdf/editor/sticky";
import { initialEditorState } from "./editor-state";
import { PropertiesPanel, bucketOfTool } from "./properties";

afterEach(() => cleanup());

function panel(tool: "comment" | "note") {
  const state = initialEditorState({ tool, pageCount: 1 });
  render(
    <PropertiesPanel
      selection={[]}
      bucket={bucketOfTool(tool)}
      tool={tool}
      defaults={state.defaults}
      onPatch={() => {}}
      onDelete={() => {}}
      onDuplicate={() => {}}
    />,
  );
}

describe("the panel with the Comment tool chosen", () => {
  it("is titled for a comment and offers only its colour", () => {
    panel("comment");
    expect(screen.getByRole("heading").textContent).toBe(
      `New ${STICKY_LABEL.toLowerCase()}`,
    );
    expect(screen.getByLabelText(`${STICKY_LABEL} colour`)).toBeTruthy();
    expect(screen.queryByLabelText("Font")).toBeNull();
  });

  it("CONTROL: the Note tool still shows the note's controls", () => {
    panel("note");
    expect(screen.getByLabelText("Font")).toBeTruthy();
    expect(screen.queryByLabelText(`${STICKY_LABEL} colour`)).toBeNull();
  });
});
