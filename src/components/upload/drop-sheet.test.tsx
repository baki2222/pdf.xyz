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
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDragDepth, DropSheet, DropSheetPick } from "./drop-sheet";

const files = (names: string[]) =>
  names.map((n) => new File(["x"], n, { type: "application/pdf" }));
const withFiles = (list: File[] = []) => ({
  dataTransfer: { files: list, types: ["Files"], dropEffect: "" },
});

afterEach(() => {
  window.location.hash = "";
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

  it("a one-file sheet takes the first file only", () => {
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
    ]);
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

  it("a hashchange to the sheet's id focuses its picker", () => {
    render(<DropSheet accept=".pdf" onFiles={() => {}} id="upload-here" />);
    const input = screen.getByLabelText(/drop your files here/i);
    window.location.hash = "#upload-here";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.activeElement).toBe(input);
  });

  it("catchPageDrops: a file dropped anywhere on the page lands here, and the tab stays", () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet accept=".pdf" onFiles={onFiles} id="z" catchPageDrops />,
    );
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    fireEvent.dragEnter(elsewhere, withFiles());
    expect(container.querySelector("#z")!.hasAttribute("data-armed")).toBe(
      true,
    );
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.assign(over, withFiles());
    elsewhere.dispatchEvent(over);
    // Without this the browser would open the file in the tab on release.
    expect(over.defaultPrevented).toBe(true);
    const dropped = files(["far.pdf"]);
    fireEvent.drop(elsewhere, withFiles(dropped));
    expect(onFiles).toHaveBeenCalledWith(dropped, "drop");
    expect(container.querySelector("#z")!.hasAttribute("data-armed")).toBe(
      false,
    );
    elsewhere.remove();
  });
});
