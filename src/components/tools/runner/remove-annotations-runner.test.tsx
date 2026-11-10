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
import { PDFDocument } from "pdf-lib";
import {
  FULL_FIXTURE_GROUPS,
  addToPage,
  annot,
  fullFixture,
} from "@/tests/annotation-fixtures";
import { InToolPage } from "@/tests/in-tool-page";
import { MetadataRunner } from "./metadata-runner";
import {
  PAGE_LIST_FOLD,
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

/*
 * Review round 1 (2026-11-10): the button and "By page" summed the ticked
 * kinds' inventory counts, while the run also removes every reply to what
 * it removes — ticking only markup said "Remove 1 annotation" and removed
 * 2. The label above was only ever checked with DEFAULT_GROUPS, where
 * comments are ticked anyway, so it never met the case.
 */
describe("the button and By page count the run's own closure", () => {
  const pageRows = () =>
    [...document.querySelectorAll("[data-annotations-pages] li")].map(
      (li) => li.textContent,
    );

  for (const group of ANNOTATION_GROUPS) {
    it(`only ${group.id} ticked: the button's number is what the run removes`, async () => {
      const bytes = await fullFixture();
      const expected = await removeAnnotations(bytes, new Set([group.id]));
      await mount(bytes);
      for (const g of ANNOTATION_GROUPS) {
        if (box(g.label).checked !== (g.id === group.id))
          fireEvent.click(box(g.label));
      }
      expect(
        screen.getByRole("button", {
          name: removeRunLabel(expected.removedTotal),
        }),
      ).toBeTruthy();
    });
  }

  it("only markup ticked: the reply on page 2 is listed, and said to go too", async () => {
    await mount(await fullFixture());
    for (const g of ANNOTATION_GROUPS) {
      if (box(g.label).checked !== (g.id === "text-markup"))
        fireEvent.click(box(g.label));
    }
    expect(
      screen.getByRole("button", { name: removeRunLabel(2) }),
    ).toBeTruthy();
    expect(pageRows()).toEqual([
      "Page 1: 1 to remove (Highlights and text markup 1)",
      "Page 2: 1 to remove (Comments and notes 1)",
    ]);
    expect(document.querySelector("[data-replies-along]")!.textContent).toMatch(
      /^1 reply goes too/,
    );
  });

  it("lists only pages something goes from, and counts the rest in one line", async () => {
    await mount(await fullFixture());
    for (const g of ANNOTATION_GROUPS) {
      if (box(g.label).checked !== (g.id === "links"))
        fireEvent.click(box(g.label));
    }
    expect(pageRows()).toEqual(["Page 2: 1 to remove (Links 1)"]);
    expect(document.querySelector("[data-pages-untouched]")!.textContent).toBe(
      "1 other page has annotations, none of a ticked kind.",
    );
  });
});

describe("a long document's page list", () => {
  async function linkOnEveryPage(pages: number) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) {
      const page = doc.addPage([200, 200]);
      addToPage(doc, i, annot(doc.context, page.ref, "Link", {}));
    }
    addToPage(doc, 0, annot(doc.context, doc.getPage(0).ref, "Highlight", {}));
    return doc.save();
  }

  it("with links unticked, a link on each of 30 pages is one line, not 29 rows", async () => {
    await mount(await linkOnEveryPage(30));
    expect(
      [...document.querySelectorAll("[data-annotations-pages] li")].map(
        (li) => li.textContent,
      ),
    ).toEqual(["Page 1: 1 to remove (Highlights and text markup 1)"]);
    expect(document.querySelector("[data-pages-untouched]")!.textContent).toBe(
      "29 other pages have annotations, none of a ticked kind.",
    );
  });

  it(`more than ${PAGE_LIST_FOLD} pages to list start folded under a count`, async () => {
    await mount(await linkOnEveryPage(30));
    fireEvent.click(box("Links"));
    const details = document
      .querySelector("[data-annotations-pages]")!
      .closest("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe(
      "30 pages have annotations to remove",
    );
    expect(details.querySelectorAll("li")).toHaveLength(30);
  });
});

describe("the result's notes", () => {
  it("a pinned file the PDF also holds is reported as still in the copy, in words true of any holder", async () => {
    await mount(await fullFixture({ alsoEmbedded: true }));
    fireEvent.click(screen.getByRole("button", { name: /^Remove \d+/ }));
    const panel = await screen.findByRole("group", {
      name: /annotations removed/i,
    });
    expect(panel.textContent).toContain(
      "A file attached through a removed pin is still in the copy: another part of the PDF also holds it",
    );
  });
});

describe("each kind's checkbox is named by its label and described by its consequence", () => {
  it("the spoken name is label and count; the consequence is the description", async () => {
    await mount(await fullFixture());
    for (const group of ANNOTATION_GROUPS) {
      const input = screen.getByRole("checkbox", {
        name: `${group.label} (${FULL_FIXTURE_GROUPS[group.id]})`,
      });
      const why = document.getElementById(
        input.getAttribute("aria-describedby") ?? "",
      );
      expect(why?.textContent, group.id).toBe(group.consequence);
    }
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
