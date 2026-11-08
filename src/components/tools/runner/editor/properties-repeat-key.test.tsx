// @vitest-environment jsdom
/**
 * A link's fields were drawn TWICE in the panel (feat/w3-client e2e,
 * editor-phase3 "links: edit the file's own …", 2026-11-08): two "Link
 * address" boxes after a click selected the file's link. The editor keys
 * its "Repeat on" control by the selection's ids (audit sign-pdf#6), which
 * for one object is the same key LinkFields carries as its sibling inside
 * the panel, and React mis-reconciles siblings that share a key. The panel
 * now gives the slot its own key, whatever key the caller chose.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EditorObject, LinkObject } from "@/lib/pdf/editor/model";
import { initialEditorState } from "./editor-state";
import { PropertiesPanel } from "./properties";

afterEach(() => cleanup());

const link = (id: string, uri: string): LinkObject => ({
  id,
  page: 0,
  kind: "link",
  x: 10,
  y: 10,
  width: 100,
  height: 20,
  target: { type: "uri", uri },
});

const state = initialEditorState({ tool: "select", pageCount: 2 });

function view(selection: EditorObject[], keyRepeat: boolean) {
  return (
    <PropertiesPanel
      selection={selection}
      bucket={null}
      defaults={state.defaults}
      onPatch={() => {}}
      onDelete={() => {}}
      onDuplicate={() => {}}
      repeat={
        keyRepeat && selection.length > 0 ? (
          // As the editor keys it: the selection's ids.
          <div key={selection.map((o) => o.id).join(" ")} data-repeat-probe="">
            Repeat on
          </div>
        ) : undefined
      }
    />
  );
}

/** Select one link, then another, then the first again, as clicks do. */
function clickThrough(keyRepeat: boolean) {
  const a = link("obj-1", "https://a.example.org/");
  const b = link("obj-2", "https://b.example.org/");
  const { rerender } = render(view([a], keyRepeat));
  rerender(view([b], keyRepeat));
  rerender(view([a], keyRepeat));
}

describe("a link's panel beside a Repeat on control", () => {
  it("shows one Link address through selection changes, though Repeat on is keyed by the link's id", () => {
    clickThrough(true);
    expect(screen.getAllByLabelText("Link address")).toHaveLength(1);
    expect(
      (screen.getByLabelText("Link address") as HTMLInputElement).value,
    ).toBe("https://a.example.org/");
    // Health: the repeat slot really rendered beside it.
    expect(document.querySelectorAll("[data-repeat-probe]")).toHaveLength(1);
  });

  it("CONTROL: with no Repeat on, still exactly one", () => {
    clickThrough(false);
    expect(screen.getAllByLabelText("Link address")).toHaveLength(1);
  });
});
