// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PDFName } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import type { BookmarkNode } from "@/lib/pdf/bookmark-tree";
import { readOutlineTree } from "@/lib/pdf/bookmarks";
import { getToolBySlug } from "@/lib/tools";
import { addOutline, blankPages, fitDest } from "@/tests/bookmark-fixtures";
import { InToolPage } from "@/tests/in-tool-page";
import {
  BOOKMARK_ADD_LABEL,
  BOOKMARK_GENERATE_LABEL,
  BOOKMARK_RESULT_TITLE,
  BOOKMARK_RUN_LABEL,
  BookmarksEditor,
} from "./bookmarks-editor";
import { MetadataRunner } from "./metadata-runner";

/**
 * Edit PDF Bookmarks' panel as a reader meets it: the real engine reads the
 * real fixture into the list, the row buttons edit it, and the result is
 * read back from the saved copy — checked here against an independent
 * reading of the downloaded bytes, never against what was asked for.
 */

let downloads: Blob[] = [];

beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloads.push(blob);
    return "blob:bookmarks-test";
  });
  URL.revokeObjectURL = vi.fn();
  // jsdom has no layout: an anchor's click() would try to navigate.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

/** The PDF the Download button handed the browser, read by the engine. */
async function downloaded() {
  fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  expect(downloads).toHaveLength(1);
  const bytes = new Uint8Array(await downloads[0]!.arrayBuffer());
  return readOutlineTree(bytes);
}

function shape(items: readonly BookmarkNode[]): unknown[] {
  return items.map((n) => [
    n.title,
    n.target.kind === "page" ? n.target.page : n.target.kind,
    ...(n.children.length ? [shape(n.children)] : []),
  ]);
}

/** Five pages; "Part A" (open) holds "A.1" and "A.2"; then "Part B", "Part C". */
async function fixture(): Promise<Uint8Array> {
  const doc = await blankPages(5);
  addOutline(doc, [
    {
      title: "Part A",
      dest: fitDest(doc, 0),
      open: true,
      kids: [
        { title: "A.1", dest: fitDest(doc, 1) },
        { title: "A.2", dest: fitDest(doc, 2) },
      ],
    },
    { title: "Part B", dest: fitDest(doc, 3) },
    { title: "Part C", dest: fitDest(doc, 4) },
  ]);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  return doc.save();
}

async function mount(bytes: Uint8Array) {
  const file = new File([new Uint8Array(bytes)], "handbook.pdf", {
    type: "application/pdf",
  });
  render(
    <BookmarksEditor
      pdf={{
        file,
        bytes,
        pageCount: 5,
        rotations: [0, 0, 0, 0, 0],
        digitalSignatures: 0,
      }}
      onReset={() => {}}
    />,
  );
  await screen.findByRole("button", { name: BOOKMARK_ADD_LABEL });
  return screen.queryByRole("list", { name: "Bookmarks" });
}

const titleInputs = () =>
  screen
    .getAllByRole("textbox", { name: /^Title, level/ })
    .map((el) => (el as HTMLInputElement).value);

function more(title: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `More actions for “${title}”` }),
  );
  return screen.getByRole("group", { name: `Actions for “${title}”` });
}

const live = () =>
  document.querySelector('[aria-live="polite"][role="status"]')!.textContent;

async function save() {
  fireEvent.click(screen.getByRole("button", { name: BOOKMARK_RUN_LABEL }));
  const panel = await screen.findByRole("group", {
    name: new RegExp(BOOKMARK_RESULT_TITLE, "i"),
  });
  return panel;
}

describe("Edit PDF Bookmarks' panel", () => {
  it("lists the outline nested, each row with its title and page", async () => {
    const list = (await mount(await fixture()))!;
    expect(titleInputs()).toEqual(["Part A", "A.1", "A.2", "Part B", "Part C"]);
    const nested = within(list).getAllByRole("list");
    expect(nested).toHaveLength(1);
    expect(
      within(nested[0]!)
        .getAllByRole("textbox", { name: /^Title/ })
        .map((e) => (e as HTMLInputElement).value),
    ).toEqual(["A.1", "A.2"]);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Page for “A.2”",
        }) as HTMLInputElement
      ).value,
    ).toBe("3");
    expect(
      screen.getByRole("textbox", { name: "Title, level 2, 2 of 2" }),
    ).toBeTruthy();
    const toggle = screen.getByRole("button", {
      name: "Bookmarks inside “Part A”",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(titleInputs()).toEqual(["Part A", "Part B", "Part C"]);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Open with the bookmarks panel showing",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("More actions is a disclosure of named buttons; a move keeps focus and is spoken", async () => {
    await mount(await fixture());
    const opener = screen.getByRole("button", {
      name: "More actions for “Part B”",
    });
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    const group = more("Part B");
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(opener.getAttribute("aria-controls")).toBe(group.id);
    const names = within(group)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Move up: “Part B”",
      "Move down: “Part B”",
      "Indent: “Part B”",
      "Outdent: “Part B”",
      "Add below: “Part B”",
      "Add inside: “Part B”",
      "Delete: “Part B”",
    ]);
    // Outdent cannot act on a top-level row: it says so and keeps focus.
    const outdent = within(group).getByRole("button", { name: /^Outdent/ });
    expect(outdent.getAttribute("aria-disabled")).toBe("true");
    const down = within(group).getByRole("button", { name: /^Move down/ });
    down.focus();
    fireEvent.click(down);
    expect(titleInputs()).toEqual(["Part A", "A.1", "A.2", "Part C", "Part B"]);
    expect(document.activeElement).toBe(down);
    expect(live()).toContain("Moved “Part B” down.");
    expect(down.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(down);
    expect(titleInputs()).toEqual(["Part A", "A.1", "A.2", "Part C", "Part B"]);
  });

  it("indent and outdent nest a row and bring it back; undo and redo walk the history", async () => {
    await mount(await fixture());
    fireEvent.click(
      within(more("Part B")).getByRole("button", { name: /^Indent/ }),
    );
    expect(
      screen.getByRole("textbox", { name: "Title, level 2, 3 of 3" }),
    ).toHaveProperty("value", "Part B");
    expect(live()).toContain("“Part B” is now inside the bookmark above it");
    fireEvent.click(screen.getByRole("button", { name: /^Outdent: “Part B”/ }));
    expect(
      screen.getByRole("textbox", { name: "Title, level 1, 2 of 3" }),
    ).toHaveProperty("value", "Part B");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("textbox", { name: "Title, level 2, 3 of 3" }),
    ).toHaveProperty("value", "Part B");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(
      screen.getByRole("textbox", { name: "Title, level 1, 2 of 3" }),
    ).toHaveProperty("value", "Part B");
  });

  it("delete names what goes with it, moves focus to the next row, and undo brings it back", async () => {
    await mount(await fixture());
    const del = within(more("Part A")).getByRole("button", {
      name: "Delete with 2 inside: “Part A” and 2 bookmarks inside it",
    });
    fireEvent.click(del);
    expect(titleInputs()).toEqual(["Part B", "Part C"]);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Title, level 1, 1 of 2" }),
    );
    expect(live()).toContain("Deleted “Part A” and 2 bookmarks inside it.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(titleInputs()).toEqual(["Part A", "A.1", "A.2", "Part B", "Part C"]);
  });

  it("a page field takes 1 to the page count; empty makes a heading", async () => {
    await mount(await fixture());
    const page = screen.getByRole("textbox", {
      name: "Page for “Part C”",
    }) as HTMLInputElement;
    fireEvent.change(page, { target: { value: "9" } });
    expect(page.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(page);
    expect(page.value).toBe("5");
    fireEvent.change(page, { target: { value: "" } });
    expect(page.value).toBe("");
    expect(page.placeholder).toBe("No page");
    fireEvent.change(page, { target: { value: "2" } });
    expect(page.value).toBe("2");
  });

  it("rename, delete, add and nest, saved: the result and the downloaded copy say the same", async () => {
    const bytes = await fixture();
    await mount(bytes);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Title, level 1, 2 of 3" }),
      {
        target: { value: "Part Bee" },
      },
    );
    fireEvent.click(
      within(more("A.1")).getByRole("button", { name: /^Delete: “A.1”/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: BOOKMARK_ADD_LABEL }));
    // The new row's title has focus and is selected for typing over.
    const fresh = document.activeElement as HTMLInputElement;
    expect(fresh.value).toBe("New bookmark");
    fireEvent.change(fresh, { target: { value: "Index — 索引" } });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Page for “Index — 索引”" }),
      {
        target: { value: "4" },
      },
    );
    fireEvent.click(
      within(more("Part C")).getByRole("button", { name: /^Indent/ }),
    );
    const panel = await save();
    const saved = panel.querySelector("[data-bookmarks-saved]")!;
    expect(
      [...saved.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual([
      "Part A · 1 bookmark inside",
      "Part Bee · 1 bookmark inside",
      "Index — 索引",
    ]);
    expect(within(panel).getByText(/5 bookmarks · 2 levels/)).toBeTruthy();
    // The file the Download button hands over, read independently.
    const copy = await downloaded();
    expect(shape(copy.items)).toEqual([
      ["Part A", 1, [["A.2", 3]]],
      ["Part Bee", 4, [["Part C", 5]]],
      ["Index — 索引", 4],
    ]);
  });

  it("the result uses the read-back, not the request", async () => {
    // A control character typed into a title is written as given; reading
    // the saved copy back shows it as a space. A result drawn from the
    // request would show the raw character.
    await mount(await fixture());
    fireEvent.change(
      screen.getByRole("textbox", { name: "Title, level 1, 3 of 3" }),
      {
        target: { value: "Bell\u0007Title" },
      },
    );
    const panel = await save();
    const items = [...panel.querySelectorAll("[data-bookmarks-saved] li")].map(
      (li) => li.textContent,
    );
    expect(items).toContain("Bell Title");
    expect(items).not.toContain("Bell\u0007Title");
  });

  it("page bookmarks are added from the page count, every N pages", async () => {
    const doc = await blankPages(5);
    await mount(await doc.save());
    expect(screen.getByText(/has no bookmarks yet/)).toBeTruthy();
    fireEvent.change(
      screen.getByRole("textbox", { name: /One bookmark every/ }),
      {
        target: { value: "2" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: BOOKMARK_GENERATE_LABEL }),
    );
    expect(titleInputs()).toEqual(["Page 1", "Page 3", "Page 5"]);
    await save();
  });
});

describe("the metadata runner kind mounts the panel for its slug", () => {
  it("on /tools/edit-pdf-bookmarks it is Edit PDF Bookmarks' drop box", () => {
    render(
      <InToolPage tool={getToolBySlug("edit-pdf-bookmarks")!}>
        <MetadataRunner />
      </InToolPage>,
    );
    expect(screen.getByText(/bookmarks read and changed locally/)).toBeTruthy();
    expect(screen.queryByText(/metadata read and changed locally/)).toBeNull();
    expect(
      screen.queryByText(/annotations listed and removed locally/),
    ).toBeNull();
  });
});
