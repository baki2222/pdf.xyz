// @vitest-environment jsdom
/**
 * The command palette, as a keyboard and a screen reader receive it.
 *
 * The browser half — Ctrl+K from the page, the lazy chunk, a real file
 * chooser and the ticket dialog behind it — is `e2e/palette.spec.ts`. This
 * half holds the combobox contract (E.7, C.2) against the component itself:
 * the roles and names, which option is active and how the arrows move it,
 * what Enter and Escape do, and the actions.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RECENTS_STORAGE_KEY } from "@/lib/intent/recents-key";
import {
  registerFallback,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import { resetRecentsForTests } from "@/lib/intent/recents";
import { resetUnsavedForTests } from "@/lib/intent/unsaved";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import CommandPalette from "./command-palette";
import { PALETTE_CHUNK_MARKER } from "./palette-chunk";

let pushed: string[] = [];
const ROUTER = {
  push: (href: string) => pushed.push(href),
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  Element.prototype.scrollIntoView ??= () => {};
});

let events: RedactedEvent[] = [];
beforeEach(() => {
  pushed = [];
  events = [];
  localStorage.clear();
  resetRecentsForTests();
  resetPageTargetsForTests();
  resetUnsavedForTests();
  configureTelemetry((e) => events.push(e));
});
afterEach(() => {
  resetTelemetry();
  resetPageTargetsForTests();
  // `open()` appends its trigger to <body>, outside what RTL's cleanup
  // unmounts. Left there, every "trigger" outlived this file: with
  // `isolate: false` the next file to share the document (use-zip-download,
  // whenever the sequencer happened to order it after this one) found a
  // dozen buttons where it asked for one, and failed for a reason of ours.
  for (const el of document.body.querySelectorAll(":scope > button"))
    if (el.textContent === "trigger") el.remove();
});

function open(props: Partial<Parameters<typeof CommandPalette>[0]> = {}): {
  closed: () => number;
  trigger: HTMLButtonElement;
} {
  const trigger = document.createElement("button");
  trigger.textContent = "trigger";
  document.body.appendChild(trigger);
  let closes = 0;
  render(
    <AppRouterContext.Provider value={ROUTER}>
      <CommandPalette
        trigger="shortcut"
        returnFocus={{ current: trigger }}
        onClose={() => {
          closes += 1;
        }}
        {...props}
      />
    </AppRouterContext.Provider>,
  );
  return { closed: () => closes, trigger };
}

const box = () =>
  screen.getByRole("combobox", { name: "Find a tool or guide" });
const active = () => {
  const id = box().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};
const type = (text: string) =>
  act(() => {
    fireEvent.change(box(), { target: { value: text } });
  });
const key = (k: string) =>
  act(() => {
    fireEvent.keyDown(box(), { key: k });
  });

/** The listbox as a reader hears it: each group's name and its options. */
function snapshot(): { group: string; options: string[] }[] {
  const listbox = screen.getByRole("listbox");
  return within(listbox)
    .getAllByRole("group")
    .map((g) => ({
      group: g.getAttribute("aria-label") ?? "",
      options: within(g)
        .getAllByRole("option")
        .map((o) => o.getAttribute("aria-label") ?? o.textContent ?? ""),
    }));
}

describe("the combobox contract", () => {
  it("roles and names: a modal dialog, a combobox controlling a grouped listbox", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Find a tool or guide" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(dialog.getAttribute("data-chunk")).toBe(PALETTE_CHUNK_MARKER);
    const input = box();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(document.activeElement).toBe(input);
    // Empty query: tasks to start from, then the actions. No recents yet.
    const groups = snapshot();
    expect(groups.map((g) => g.group)).toEqual(["Tasks", "Actions"]);
    expect(groups[1]!.options).toEqual([
      "Open a file…",
      "Open workspace",
      "Clear local history",
    ]);
    // The first option is active, and it is an option of this listbox.
    expect(active()?.getAttribute("role")).toBe("option");
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    expect(listbox.contains(active())).toBe(true);
    // The count lives in the dialog, as a status.
    expect(within(dialog).getByRole("status")).toBeTruthy();
  });

  it("shows Recent first when this browser has finished a job", () => {
    localStorage.setItem(
      RECENTS_STORAGE_KEY,
      JSON.stringify({ version: 1, items: [{ slug: "merge-pdf", at: 1 }] }),
    );
    open();
    const groups = snapshot();
    expect(groups[0]).toEqual({ group: "Recent", options: ["Merge PDF"] });
  });

  it("'shrink' makes Compress PDF the active option, and Enter goes there", () => {
    const { closed } = open();
    type("shrink");
    expect(active()?.getAttribute("data-href")).toBe("/tools/compress-pdf");
    key("Enter");
    expect(pushed).toEqual(["/tools/compress-pdf"]);
    expect(closed()).toBe(1);
  });

  it("the arrows move the active option, and wrap", () => {
    open();
    type("pdf");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(3);
    expect(active()).toBe(options[0]);
    key("ArrowDown");
    expect(active()).toBe(options[1]);
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    key("ArrowUp");
    expect(active()).toBe(options[0]);
    key("ArrowUp");
    expect(active()).toBe(options[options.length - 1]);
    key("Home");
    expect(active()).toBe(options[0]);
    key("End");
    expect(active()).toBe(options[options.length - 1]);
  });

  it("highlights what matched with the mark sweep", () => {
    open();
    type("merge");
    const first = screen.getAllByRole("option")[0]!;
    const marks = [...first.querySelectorAll("mark")];
    expect(marks.map((m) => m.textContent?.toLowerCase())).toContain("merge");
    expect(marks.every((m) => m.classList.contains("mark-sweep"))).toBe(true);
  });

  it("no results: says so, and offers the search page", () => {
    open();
    type("qqqzzzxxyy");
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(box().getAttribute("aria-activedescendant")).toBeNull();
    expect(screen.getByText(/No tool, guide or page matches/)).toBeTruthy();
  });

  it("finds guides once their meta arrives (its own chunk)", async () => {
    open();
    type("how to merge");
    await waitFor(() =>
      expect(
        within(screen.getByRole("listbox")).getByRole("group", {
          name: "Guides",
        }).textContent,
      ).toMatch(/merge/i),
    );
  });

  it("a format nothing here opens is answered, in words", () => {
    open();
    type("heic");
    expect(screen.getByRole("note").textContent).toMatch(
      /^No tool here opens HEIC/,
    );
  });

  it("Escape closes and returns focus to the trigger", () => {
    const { closed, trigger } = open();
    key("Escape");
    expect(closed()).toBe(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("reports palette_opened with how it was opened — and nothing typed", () => {
    open({ trigger: "button" });
    type("my secret file name");
    expect(events.filter((e) => e.name === "palette_opened")).toEqual([
      { name: "palette_opened", trigger: "button" },
    ]);
  });
});

describe("the actions", () => {
  it("Open a file… closes the palette and opens the page's picker", async () => {
    let picks = 0;
    registerFallback({ receive: () => {}, pick: () => (picks += 1) });
    const { closed } = open();
    type("open a file");
    expect(active()?.textContent).toContain("Open a file");
    key("Enter");
    expect(closed()).toBe(1);
    await waitFor(() => expect(picks).toBe(1));
  });

  it("Clear local history forgets recents", async () => {
    localStorage.setItem(
      RECENTS_STORAGE_KEY,
      JSON.stringify({ version: 1, items: [{ slug: "merge-pdf", at: 1 }] }),
    );
    open();
    type("clear local history");
    key("Enter");
    expect(localStorage.getItem(RECENTS_STORAGE_KEY)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/cleared/i),
    );
  });
});

describe("a file dropped on the open palette", () => {
  it("closes it and hands the files to the ticket dialog (the page's fallback)", async () => {
    const received: { names: string[]; why: string }[] = [];
    registerFallback({
      receive: (files, _via, why) =>
        received.push({ names: files.map((f) => f.name), why: why.kind }),
      pick: () => {},
    });
    const { closed } = open();
    const dialog = screen.getByRole("dialog");
    const file = new File(["%PDF-1.7"], "a.pdf", { type: "application/pdf" });
    const dataTransfer = { files: [file], types: ["Files"], items: [] };
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => {
      dialog.dispatchEvent(drop);
    });
    // Claimed, so the page's own drop handling leaves it alone.
    expect(drop.defaultPrevented).toBe(true);
    expect(closed()).toBe(1);
    await waitFor(() =>
      expect(received).toEqual([{ names: ["a.pdf"], why: "none" }]),
    );
  });
});
