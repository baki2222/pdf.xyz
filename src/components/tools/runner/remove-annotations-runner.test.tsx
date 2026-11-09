// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import {
  ANNOTATION_GROUPS,
  DEFAULT_GROUPS,
  removeRunLabel,
} from "@/lib/pdf/annotation-groups";
import { removeAnnotations } from "@/lib/pdf/remove-annotations";
import { getToolBySlug } from "@/lib/tools";
import { FULL_FIXTURE_GROUPS, fullFixture } from "@/tests/annotation-fixtures";
import { InToolPage } from "@/tests/in-tool-page";
import { MetadataRunner } from "./metadata-runner";
import {
  REMOVE_ANNOTATIONS_NONE_TICKED,
  RemoveAnnotationsEditor,
} from "./remove-annotations-editor";

/**
 * Remove Annotations' panel as a reader meets it: the real engine reads the
 * real fixture, the checkboxes start as `DEFAULT_GROUPS` says, the button
 * counts what is ticked, and the result's numbers are the engine's count
 * of the saved copy — compared here against an independent run of the
 * engine on the same input, not against the panel's plan.
 */

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

async function mount(bytes: Uint8Array) {
  const file = new File([new Uint8Array(bytes)], "reviewed.pdf", {
    type: "application/pdf",
  });
  render(
    <RemoveAnnotationsEditor
      pdf={{
        file,
        bytes,
        pageCount: 2,
        rotations: [0, 0],
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
  await screen.findByRole("group", { name: /kinds of annotation to remove/i });
}

function box(label: string): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: new RegExp(`^${label}`),
  }) as HTMLInputElement;
}

describe("Remove Annotations' panel", () => {
  it("lists every present kind with its count, ticked as DEFAULT_GROUPS says", async () => {
    await mount(await fullFixture());
    for (const group of ANNOTATION_GROUPS) {
      const input = box(group.label);
      expect(input.checked, group.id).toBe(DEFAULT_GROUPS.has(group.id));
      expect(input.closest("label")!.textContent).toContain(
        `(${FULL_FIXTURE_GROUPS[group.id]})`,
      );
      expect(input.closest("label")!.textContent).toContain(group.consequence);
    }
    const ticked = ANNOTATION_GROUPS.filter((g) => DEFAULT_GROUPS.has(g.id));
    const n = ticked.reduce((s, g) => s + FULL_FIXTURE_GROUPS[g.id], 0);
    expect(
      screen.getByRole("button", { name: removeRunLabel(n) }),
    ).toBeTruthy();
    expect(screen.getByText(/1 signature field is kept/)).toBeTruthy();
  });

  it("the button counts what is ticked, and says why it is greyed out with nothing ticked", async () => {
    await mount(await fullFixture());
    fireEvent.click(box("Links"));
    const withLinks =
      ANNOTATION_GROUPS.filter((g) => DEFAULT_GROUPS.has(g.id)).reduce(
        (s, g) => s + FULL_FIXTURE_GROUPS[g.id],
        0,
      ) + FULL_FIXTURE_GROUPS.links;
    expect(screen.getByRole("button", { name: removeRunLabel(withLinks) }));
    for (const group of ANNOTATION_GROUPS) {
      if (box(group.label).checked) fireEvent.click(box(group.label));
    }
    const button = screen.getByRole("button", { name: removeRunLabel(0) });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(REMOVE_ANNOTATIONS_NONE_TICKED)).toBeTruthy();
  });

  it("the result's numbers are the engine's count of the saved copy", async () => {
    const bytes = await fullFixture();
    const expected = await removeAnnotations(bytes, DEFAULT_GROUPS);
    await mount(bytes);
    fireEvent.click(screen.getByRole("button", { name: /^Remove \d+/ }));
    const panel = await screen.findByRole("group", {
      name: /annotations removed/i,
    });
    const table = panel.querySelector("[data-annotations-result]")!;
    for (const group of ANNOTATION_GROUPS) {
      const row = table.querySelector(`[data-group="${group.id}"]`);
      if (!row) {
        expect(expected.removed[group.id] + expected.kept[group.id]).toBe(0);
        continue;
      }
      const cells = within(row as HTMLElement).getAllByRole("cell");
      expect(cells[0]!.textContent).toBe(String(expected.removed[group.id]));
      expect(cells[1]!.textContent).toBe(String(expected.kept[group.id]));
    }
    expect(panel.textContent).toContain(
      `${expected.removedTotal} annotations removed`,
    );
  });
});

describe("the metadata runner kind mounts the panel for its slug", () => {
  it("on /tools/remove-annotations it is Remove Annotations' drop box", () => {
    render(
      <InToolPage tool={getToolBySlug("remove-annotations")!}>
        <MetadataRunner />
      </InToolPage>,
    );
    expect(
      screen.getByText(/annotations listed and removed locally/),
    ).toBeTruthy();
    expect(screen.queryByText(/metadata read and changed locally/)).toBeNull();
  });

  it("on /tools/edit-pdf-metadata it is still Edit PDF Metadata's (control)", () => {
    render(
      <InToolPage tool={getToolBySlug("edit-pdf-metadata")!}>
        <MetadataRunner />
      </InToolPage>,
    );
    expect(screen.getByText(/metadata read and changed locally/)).toBeTruthy();
    expect(
      screen.queryByText(/annotations listed and removed locally/),
    ).toBeNull();
  });
});
