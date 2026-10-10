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
 *
 * WHERE THE BEHAVIOUR LIVES (WP-07 re-review): the sheet draws, picks and
 * holds its one path in; its drag states, its claim on a release and its
 * registration are the drop engine's (`@/lib/intent/drop-engine`), which
 * arrives with the registry as the sheet mounts — so every drag below waits
 * for it (`engine()`) first, as a person's hand arrives after the page. The
 * block "before its engine arrives" holds what a release does in the moment
 * before that, with the layer that catches it.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DropLayer } from "@/components/intent/drop-layer";
import { createDragDepth, DROP_ENGINE_MARK } from "@/lib/intent/drop-engine";
import {
  activePageTarget,
  registerPageTarget,
  resetPageTargetsForTests,
  type PageTarget,
} from "@/lib/intent/page-target";
import { DropDesk, DropSheetPick } from "./drop-desk";
import { DropSheet } from "./drop-sheet";
import { useDropBox } from "./use-drop-box";

/** What every tool page's zone passes (the runner kit's `Dropzone`); a case overrides it. */
const SHEET = {
  title: "Drop your files here, or",
  multiple: true,
  variant: "sheet",
} as const;

const files = (names: string[]) =>
  names.map((n) => new File(["x"], n, { type: "application/pdf" }));
const withFiles = (list: File[] = []) => ({
  dataTransfer: { files: list, types: ["Files"], dropEffect: "" },
});

afterEach(() => {
  window.location.hash = "";
  resetPageTargetsForTests();
});

/**
 * The sheet's engine is attached — it arrives with the registry, a moment
 * after the sheet mounts, and marks the box it takes (`DROP_ENGINE_MARK`).
 */
const engine = (container: Element) =>
  waitFor(() =>
    expect(container.querySelector(`[${DROP_ENGINE_MARK}]`)).not.toBeNull(),
  );

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
  it("a drag crossing onto the sheet's own text keeps it armed", async () => {
    const { container } = render(
      <DropSheet
        {...SHEET}
        accept=".pdf"
        onFiles={() => {}}
        id="z"
        hint="PDF only"
      />,
    );
    await engine(container);
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

  it("a drop hands the files over as a drop, and claims the event", async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet {...SHEET} accept=".pdf" onFiles={onFiles} id="z" />,
    );
    await engine(container);
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
  it("a drop hands every file to a one-file sheet's owner, which says what it kept; the picker takes one", async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet
        {...SHEET}
        accept=".pdf"
        multiple={false}
        onFiles={onFiles}
        id="z"
      />,
    );
    await engine(container);
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

  it("a drop that lists files but no types is a file drop (what every test that fires one sends)", async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet {...SHEET} accept=".pdf" onFiles={onFiles} id="z" />,
    );
    await engine(container);
    const dropped = files(["a.pdf"]);
    fireEvent.drop(container.querySelector("#z")!, {
      dataTransfer: { files: dropped },
    });
    expect(onFiles).toHaveBeenCalledWith(dropped, "drop");
  });

  it("refuse: a refused file never reaches the owner, whichever way it came; the first reason is reported, and a clean arrival clears it", async () => {
    const onFiles = vi.fn();
    const onRefusal = vi.fn();
    const refuse = (file: File) =>
      file.name.endsWith(".docx") ? `"${file.name}" isn't a PDF` : null;
    const { container } = render(
      <DropSheet
        {...SHEET}
        accept=".pdf"
        onFiles={onFiles}
        refuse={refuse}
        onRefusal={onRefusal}
        id="z"
      />,
    );
    await engine(container);
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

  it("a drag of text or a link is not a file, and arms nothing (control: a file, on the same sheet, does)", async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <DropSheet {...SHEET} accept=".pdf" onFiles={onFiles} id="z" />,
    );
    await engine(container);
    const root = container.querySelector<HTMLElement>("#z")!;
    const text = { dataTransfer: { files: [], types: ["text/plain"] } };
    fireEvent.dragEnter(root, text);
    fireEvent.drop(root, text);
    expect(root.hasAttribute("data-armed")).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
    // The engine is listening: the absence above is not its absence.
    fireEvent.dragEnter(root, withFiles());
    expect(root.hasAttribute("data-armed")).toBe(true);
  });

  it("is live once hydrated, and its picker is a labelled, described input", () => {
    const { container } = render(
      <DropSheet
        {...SHEET}
        accept=".pdf"
        onFiles={() => {}}
        id="z"
        hint="PDF only"
      />,
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
      <DropDesk accept=".pdf" onFiles={onFiles} id="z">
        {(api) => (
          <>
            <DropSheetPick>Choose files</DropSheetPick>
            <p id={api.hintId}>PDF only</p>
          </>
        )}
      </DropDesk>,
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
    const { container, unmount } = render(
      <DropSheet
        {...SHEET}
        accept="application/pdf"
        onFiles={onFiles}
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
    // Armed by the page while a file is held: the marks grow.
    act(() => target!.arm(true));
    expect(root.hasAttribute("data-armed")).toBe(true);
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
        {...SHEET}
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
        {...SHEET}
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
        {...SHEET}
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
      <DropSheet {...SHEET} accept=".pdf" onFiles={() => {}} id="z" />,
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

describe("a desk", () => {
  it("armed by the page, it warms what comes next (onIntent)", async () => {
    const onIntent = vi.fn();
    const { container } = render(
      <DropDesk
        accept="application/pdf"
        onFiles={() => {}}
        onIntent={onIntent}
        pageTarget={{ name: "the desk", verb: "check" }}
      >
        {() => <DropSheetPick>Choose files</DropSheetPick>}
      </DropDesk>,
    );
    const target = await waitFor(() => {
      const t = activePageTarget();
      if (!t) throw new Error("not registered yet");
      return t;
    });
    act(() => target.arm(true));
    expect(
      container.querySelector("[data-drop-sheet]")!.hasAttribute("data-armed"),
    ).toBe(true);
    expect(onIntent).toHaveBeenCalledTimes(1);
  });
});

/**
 * A tool page's own boxes are named by the page (`data-tool-name` around its
 * runner and its panel), not by each box: the zone a person drops on says
 * "Release to add to Merge PDF" because the page is Merge PDF's. WAS a
 * client context (`ToolContextProvider`) in the first load of every tool
 * page (WP-07 re-review).
 */
describe("a target with no name of its own", () => {
  it('is named by the page it is on (control: off a tool page, it is "this tool")', async () => {
    const { unmount } = render(
      <div data-tool-name="Merge PDF">
        <DropSheet
          {...SHEET}
          accept=".pdf"
          onFiles={() => {}}
          pageTarget={{ verb: "add" }}
        />
      </div>,
    );
    await waitFor(() => expect(activePageTarget()?.name).toBe("Merge PDF"));
    unmount();
    render(
      <DropSheet
        {...SHEET}
        accept=".pdf"
        onFiles={() => {}}
        pageTarget={{ verb: "add" }}
      />,
    );
    await waitFor(() => expect(activePageTarget()?.name).toBe("this tool"));
  });
});

/**
 * BEFORE ITS ENGINE ARRIVES. The sheet's engine comes with the registry, a
 * moment after the sheet mounts; a release in that moment is not claimed by
 * the sheet (it has no listener yet), so the drop layer catches it — and
 * hands it to the registry with where it landed, which gives it to the box
 * there to decide as its own listener would have. Without that, a release
 * on a secondary zone (Sign PDF's signature image) in that moment went to
 * the page's target: the signature replaced the PDF.
 */
describe("before its engine arrives", () => {
  beforeAll(() => {
    // jsdom has no idle callback: the layer fetches its registry at once.
    window.requestIdleCallback ??= ((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 });
      return 0;
    }) as typeof window.requestIdleCallback;
    window.cancelIdleCallback ??= () => {};
  });

  function pageTarget() {
    return {
      name: "Sign PDF",
      verb: "replace" as const,
      canReceive: () => true,
      takes: () => true,
      receive: vi.fn<PageTarget["receive"]>(),
      arm: () => {},
      element: () => null,
    };
  }

  /** A whole release on `el`, dispatched in this turn — before any import settles. */
  function releaseOn(el: Element, list: File[]) {
    const dataTransfer = {
      types: ["Files"],
      files: list,
      items: list.map((f) => ({ kind: "file", type: f.type })),
    };
    for (const type of ["dragenter", "dragover", "drop"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer });
      el.dispatchEvent(event);
    }
  }

  const png = (name: string) =>
    new File([new Uint8Array([0x89, 0x50])], name, { type: "image/png" });

  it("a release on a secondary zone is the zone's, as it would have been with its engine here", async () => {
    const page = pageTarget();
    const off = registerPageTarget(page);
    const onFiles = vi.fn();
    const { container } = render(
      <>
        <DropSheet
          {...SHEET}
          accept="image/png,image/jpeg"
          onFiles={onFiles}
          id="z"
        />
        <DropLayer />
      </>,
    );
    const zone = container.querySelector("#z")!;
    const signature = png("signature.png");
    releaseOn(zone, [signature]);
    // Not taken in the release's own turn: no engine was there to take it.
    expect(onFiles).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onFiles).toHaveBeenCalledWith([signature], "drop"),
    );
    expect(page.receive).not.toHaveBeenCalled();
    off();
  });

  it("control: what the zone does not take goes where the page routes it, as with its engine", async () => {
    const page = pageTarget();
    const off = registerPageTarget(page);
    const onFiles = vi.fn();
    const { container } = render(
      <>
        <DropSheet
          {...SHEET}
          accept="image/png,image/jpeg"
          onFiles={onFiles}
          id="z"
        />
        <DropLayer />
      </>,
    );
    const contract = files(["contract.pdf"]);
    releaseOn(container.querySelector("#z")!, contract);
    await waitFor(() =>
      expect(page.receive).toHaveBeenCalledWith(contract, "drop"),
    );
    expect(onFiles).not.toHaveBeenCalled();
    off();
  });
});

/**
 * A PICK MADE BEFORE HYDRATION. The sheets are server-rendered, so their
 * `<input type="file">` is clickable as soon as the HTML lands — before the
 * client bundle boots. A file picked in that window fires `change` at an
 * element React is not listening to yet; the event is lost while the file
 * stays in `input.files`, and the page shows an untouched sheet the person
 * can only escape by picking a DIFFERENT file. The box adopts what is in its
 * inputs as React takes it (`useDropBox`).
 *
 * WAS `useEarlyFilePick`, an effect per picker, held by its own tests; the
 * properties those held are held here, on the mechanism that replaced it
 * (WP-07 re-review: one fewer module and two fewer hooks in every tool
 * page's first load). The input is NOT rendered by React: react-dom installs
 * its own `value` tracker on inputs it owns, which would shadow this shim —
 * so each case hands the box's ref callback a root that holds one.
 */
describe("a pick made before hydration", () => {
  /** A file input holding `names`, as one does after a pick (jsdom's are read-only). */
  function inputHolding(...names: string[]): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "file";
    let current = names.map(
      (name) =>
        new File([new Uint8Array([1, 2, 3])], name, {
          type: "application/pdf",
        }),
    );
    Object.defineProperty(input, "files", {
      configurable: true,
      get: () =>
        ({
          ...current,
          length: current.length,
          item: (i: number) => current[i] ?? null,
          [Symbol.iterator]: () => current[Symbol.iterator](),
        }) as unknown as FileList,
    });
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => (current[0] ? `C:\\fakepath\\${current[0].name}` : ""),
      set: () => {
        current = [];
      },
    });
    return input;
  }

  /** A sheet's box as the server drew it, holding `input`. */
  function sheetHolding(input: HTMLInputElement) {
    const root = document.createElement("div");
    root.setAttribute("data-drop-sheet", "");
    root.setAttribute("data-live", "pending");
    root.append(input);
    return root;
  }

  function attach(emit: (files: readonly File[], via: string) => void) {
    const { result } = renderHook(() =>
      useDropBox({ accept: ".pdf", target: null, emit }),
    );
    return result.current;
  }

  it("is adopted as React takes the sheet, as an early arrival, and the input cleared for the next pick", () => {
    const emit = vi.fn();
    const input = inputHolding("spin.pdf");
    const root = sheetHolding(input);
    const box1 = attach(emit);
    act(() => {
      box1(root);
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].map((f: File) => f.name)).toEqual([
      "spin.pdf",
    ]);
    expect(emit.mock.calls[0]![1]).toBe("early");
    expect(input.value).toBe("");
    expect(input.files?.length).toBe(0);
    expect(root.getAttribute("data-live")).toBe("on");
  });

  it("every file, when the sheet takes more than one", () => {
    const emit = vi.fn();
    const box2 = attach(emit);
    act(() => {
      box2(sheetHolding(inputHolding("a.pdf", "b.pdf")));
    });
    expect(emit.mock.calls[0]![0]).toHaveLength(2);
  });

  it("nothing picked, nothing said; and a second look (a re-attach) says nothing again", () => {
    const emit = vi.fn();
    const box = attach(emit);
    act(() => {
      box(sheetHolding(inputHolding()));
    });
    expect(emit).not.toHaveBeenCalled();
    const root = sheetHolding(inputHolding("once.pdf"));
    act(() => {
      box(root);
      box(root);
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("a sheet's own inputs only — never those of a sheet inside it, nor a box that is not a sheet", () => {
    const emit = vi.fn();
    const outer = sheetHolding(inputHolding("outer.pdf"));
    outer.append(sheetHolding(inputHolding("inner.pdf")));
    const box3 = attach(emit);
    act(() => {
      box3(outer);
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0][0].name).toBe("outer.pdf");
    // An editor or a chip (no `data-live`) adopts nothing it holds.
    const editor = document.createElement("div");
    editor.append(inputHolding("inside-an-editor.pdf"));
    const box4 = attach(emit);
    act(() => {
      box4(editor);
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
