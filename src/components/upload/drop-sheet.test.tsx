// @vitest-environment jsdom
/**
 * The drop primitive: a file is dropped or picked, and nothing else is.
 *
 * WHAT THE ZONES BEFORE IT DID: `onDragLeave={() => setDragging(false)}`. A
 * file dragged over the zone's own text fires `dragleave` on the zone as it
 * enters the child, so the highlight flickered off and on across every word.
 * The sheet counts enters and leaves instead; these tests cross a child and
 * require the state to hold, and the control below runs the old rule over
 * the same events to show the test can tell the difference.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePageTarget,
  registerPageTarget,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import { createDragDepth, DropSheet, DropSheetPick } from "./drop-sheet";

const files = (names: string[]) =>
  names.map((n) => new File(["x"], n, { type: "application/pdf" }));
const withFiles = (list: File[] = []) => ({
  dataTransfer: { files: list, types: ["Files"], dropEffect: "" },
});

afterEach(() => {
  window.location.hash = "";
  resetPageTargetsForTests();
});

describe("createDragDepth", () => {
  it("stays inside across a child, and leaves once every enter has left", () => {
    const seen: boolean[] = [];
    const d = createDragDepth((inside) => seen.push(inside));
    d.enter(); // the sheet
    d.enter(); // its child — the parent's own leave follows
    d.leave();
    expect(seen).toEqual([true]);
    d.leave();
    expect(seen).toEqual([true, false]);
    // A reset (drop, drag end, window blur) from any depth ends it once.
    d.enter();
    d.enter();
    d.reset();
    d.reset();
    expect(seen).toEqual([true, false, true, false]);
  });

  it("positive control: the old rule flickers on the same events", () => {
    const seen: boolean[] = [];
    // WAS: every dragleave meant "left".
    const old = { enter: () => seen.push(true), leave: () => seen.push(false) };
    old.enter();
    old.enter();
    old.leave();
    expect(seen).toEqual([true, true, false]);
  });
});

describe("DropSheet", () => {
  it("a drag crossing onto the sheet's own text keeps it armed", () => {
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={() => {}} id="z" hint="PDF only" />,
    );
    const root = container.querySelector<HTMLElement>("#z")!;
    const text = screen.getByText("PDF only");
    fireEvent.dragEnter(root, withFiles());
    fireEvent.dragEnter(text, withFiles());
    fireEvent.dragLeave(root, withFiles());
    expect(root.hasAttribute("data-over")).toBe(true);
    expect(root.hasAttribute("data-armed")).toBe(true);
    fireEvent.dragLeave(text, withFiles());
    expect(root.hasAttribute("data-over")).toBe(false);
  });

  it("a drop hands the files over as a drop, and claims the event", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={onFiles} id="z" />,
    );
    const root = container.querySelector<HTMLElement>("#z")!;
    const dropped = files(["a.pdf", "b.pdf"]);
    fireEvent.dragEnter(root, withFiles(dropped));
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, withFiles(dropped));
    act(() => {
      root.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith(dropped, "drop");
    expect(root.hasAttribute("data-over")).toBe(false);
  });

  /**
   * INVERTED 2026-10-10 (WP-07). This held "a one-file sheet takes the first
   * file only": the sheet sliced a drop to its first file before its owner
   * saw it. Harmless while the home desk (which takes many) was its only
   * owner — and wrong the day the runner kit's `Dropzone` became this sheet,
   * because a drop is the one way past `multiple={false}` and the owner is
   * the one place that can SAY so: OCR PDF keeps the first file and tells
   * the visitor the others were not added ("Only the first file was
   * added"), which a sheet that hid them made impossible. So `multiple`
   * governs the picker, and a drop hands over every file; the owner keeps
   * what it takes and says why.
   */
  it("a drop hands every file to a one-file sheet's owner, which says what it kept; the picker takes one", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet accept=".pdf" multiple={false} onFiles={onFiles} id="z" />,
    );
    fireEvent.drop(
      container.querySelector("#z")!,
      withFiles(files(["a.pdf", "b.pdf"])),
    );
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
    for (const input of container.querySelectorAll('input[type="file"]'))
      expect(input.hasAttribute("multiple")).toBe(false);
  });

  it("a drop that lists files but no types is a file drop (what every test that fires one sends)", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={onFiles} id="z" />,
    );
    const dropped = files(["a.pdf"]);
    fireEvent.drop(container.querySelector("#z")!, {
      dataTransfer: { files: dropped },
    });
    expect(onFiles).toHaveBeenCalledWith(dropped, "drop");
  });

  it("refuse: a refused file never reaches the owner, whichever way it came; the first reason is reported, and a clean arrival clears it", () => {
    const onFiles = vi.fn();
    const onRefusal = vi.fn();
    const refuse = (file: File) =>
      file.name.endsWith(".docx") ? `"${file.name}" isn't a PDF` : null;
    const { container } = render(
      <DropSheet
        accept=".pdf"
        onFiles={onFiles}
        refuse={refuse}
        onRefusal={onRefusal}
        id="z"
      />,
    );
    const root = container.querySelector<HTMLElement>("#z")!;
    // A drop of one good file between two bad ones: the good one goes on.
    fireEvent.drop(
      root,
      withFiles([
        new File(["x"], "a.docx"),
        ...files(["ok.pdf"]),
        new File(["x"], "b.docx"),
      ]),
    );
    expect(onFiles.mock.calls[0]![0].map((f: File) => f.name)).toEqual([
      "ok.pdf",
    ]);
    expect(onRefusal).toHaveBeenLastCalledWith(`"a.docx" isn't a PDF`);
    // A pick of only a bad file: nothing goes on.
    const input = screen.getByLabelText(/drop your files here/i);
    fireEvent.change(input, {
      target: { files: [new File(["x"], "c.docx")] },
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onRefusal).toHaveBeenLastCalledWith(`"c.docx" isn't a PDF`);
    // A clean drop clears the reason.
    fireEvent.drop(root, withFiles(files(["fine.pdf"])));
    expect(onRefusal).toHaveBeenLastCalledWith(null);
    expect(onFiles).toHaveBeenCalledTimes(2);
  });

  it("a drag of text or a link is not a file, and arms nothing", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={onFiles} id="z" />,
    );
    const root = container.querySelector<HTMLElement>("#z")!;
    const text = { dataTransfer: { files: [], types: ["text/plain"] } };
    fireEvent.dragEnter(root, text);
    fireEvent.drop(root, text);
    expect(root.hasAttribute("data-armed")).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("is live once hydrated, and its picker is a labelled, described input", () => {
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={() => {}} id="z" hint="PDF only" />,
    );
    expect(container.querySelector("#z")!.getAttribute("data-live")).toBe("on");
    const input = screen.getByLabelText(/drop your files here/i);
    expect(input.getAttribute("type")).toBe("file");
    expect(input.getAttribute("accept")).toBe(".pdf");
    const hint = document.getElementById(
      input.getAttribute("aria-describedby")!,
    );
    expect(hint?.textContent).toBe("PDF only");
  });

  it("a desk places its own picker; a pick says it was a pick", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={onFiles} id="z" variant="desk">
        {(api) => (
          <>
            <DropSheetPick>Choose files</DropSheetPick>
            <p id={api.hintId}>PDF only</p>
          </>
        )}
      </DropSheet>,
    );
    const input = screen.getByLabelText("Choose files");
    fireEvent.change(input, { target: { files: files(["a.pdf"]) } });
    expect(onFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "a.pdf" })],
      "pick",
    );
    // The hidden input behind `pick()` comes after the visible one, and is
    // neither a tab stop nor announced.
    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs[0]).toBe(input);
    expect(inputs[1]!.hasAttribute("hidden")).toBe(true);
    expect(inputs[1]!.getAttribute("tabindex")).toBe("-1");
  });

  // MOVED 2026-10-10: "a hashchange to the sheet's id focuses its picker"
  // was the sheet's, and the home desk was the only sheet a link names (the
  // colophon's #start). The listener moved into the desk, so every other
  // page stopped loading it; the property is held where it lives now —
  // hero-desk.test.tsx, "a hashchange to the desk's id focuses its picker".

  /**
   * WAS `catchPageDrops`: the sheet put listeners of its own on `window` and
   * caught every drop on its page. That made the home desk the one surface
   * on the site where a near-miss landed somewhere; on every other page a
   * file released beside a drop zone was opened by the browser, in the tab.
   * Since WP-07 a page's drops belong to the drop layer
   * (`@/components/intent/drop-layer`), which hands them to the page's target
   * through `@/lib/intent/page-target` — and a sheet becomes that target by
   * REGISTERING. A release delivered to it takes the sheet's own path (its
   * refusals, its `onFiles`), so it is indistinguishable from a drop on it.
   * The layer's routing is `drop-layer.test.tsx`'s; this holds the sheet's
   * half.
   */
  it("pageTarget: registered as the page's target while mounted — what the page hands it is a drop on it", async () => {
    const onFiles = vi.fn();
    const onIntent = vi.fn();
    const { container, unmount } = render(
      <DropSheet
        accept="application/pdf"
        onFiles={onFiles}
        onIntent={onIntent}
        id="z"
        pageTarget={{ name: "Merge PDF", verb: "add" }}
      />,
    );
    const root = container.querySelector<HTMLElement>("#z")!;
    expect(root.hasAttribute("data-page-drop-target")).toBe(true);
    // The registry is fetched on mount, not with the page: the sheet is in
    // the stack once it arrives.
    const target = await waitFor(() => {
      const t = activePageTarget();
      if (!t) throw new Error("not registered yet");
      return t;
    });
    expect(target?.name).toBe("Merge PDF");
    expect(target?.verb).toBe("add");
    expect(target?.element()).toBe(root);
    // What it opens is read from its own `accept`.
    expect(target?.takes({ name: "a.pdf", type: "application/pdf" })).toBe(
      true,
    );
    expect(target?.takes({ name: "a.jpg", type: "image/jpeg" })).toBe(false);
    // Armed by the page while a file is held: the marks grow, and what
    // comes next is warmed.
    act(() => target!.arm(true));
    expect(root.hasAttribute("data-armed")).toBe(true);
    expect(onIntent).toHaveBeenCalledTimes(1);
    act(() => target!.arm(false));
    expect(root.hasAttribute("data-armed")).toBe(false);
    const dropped = files(["far.pdf"]);
    act(() => target!.receive(dropped, "paste"));
    expect(onFiles).toHaveBeenCalledWith(dropped, "paste");
    unmount();
    expect(activePageTarget()).toBeNull();
  });

  it("pageTarget: a re-render keeps its place in the stack, and answers with its latest props", async () => {
    const { rerender } = render(
      <DropSheet
        accept=".pdf"
        onFiles={() => {}}
        pageTarget={{ name: "First", verb: "open" }}
      />,
    );
    await waitFor(() => expect(activePageTarget()?.name).toBe("First"));
    const later = registerPageTarget({
      name: "Later",
      verb: "replace",
      canReceive: () => true,
      takes: () => true,
      receive: () => {},
      arm: () => {},
      element: () => null,
    });
    rerender(
      <DropSheet
        accept=".pdf"
        onFiles={() => {}}
        pageTarget={{ name: "First, renamed", verb: "open" }}
      />,
    );
    expect(activePageTarget()?.name).toBe("Later");
    later();
    expect(activePageTarget()?.name).toBe("First, renamed");
  });

  it("pageTarget.canReceive is asked at the moment of the drop, not at registration", async () => {
    let busy = false;
    render(
      <DropSheet
        accept=".pdf"
        onFiles={() => {}}
        pageTarget={{
          name: "Merge PDF",
          verb: "add",
          canReceive: () => !busy,
        }}
      />,
    );
    await waitFor(() => expect(activePageTarget()?.canReceive()).toBe(true));
    busy = true;
    expect(activePageTarget()?.canReceive()).toBe(false);
  });

  it("without pageTarget a sheet is not the page's target (a secondary zone)", async () => {
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={() => {}} id="z" />,
    );
    // Given the registry every chance to have arrived: still nothing.
    await import("@/lib/intent/page-target");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(activePageTarget()).toBeNull();
    expect(
      container.querySelector("#z")!.hasAttribute("data-page-drop-target"),
    ).toBe(false);
  });
});
