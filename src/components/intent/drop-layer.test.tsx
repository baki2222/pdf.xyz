// @vitest-environment jsdom
/**
 * Drop and paste anywhere: what a file that lands on a page does — the
 * drop layer composed with the registry and real drop sheets, as the root
 * layout composes them.
 *
 * WHAT IT REPLACES. Before WP-07 only the home desk listened to its page's
 * drops; on every other page a file released anywhere but squarely on a
 * drop zone was opened by the browser, IN THE TAB — the visitor's page was
 * replaced by their PDF, and a paste did nothing at all. The negative
 * control at the bottom runs the same drop with no layer mounted and shows
 * the page does not accept it (the browser's default then navigates).
 *
 * Synthetic events, because jsdom has no drag and drop; the browser half —
 * real `DataTransfer`s on real pages, and the dialog launching a tool — is
 * `e2e/drop-anywhere.spec.ts`.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { DropSheet } from "@/components/upload/drop-sheet";
import { Dropzone } from "@/components/tools/runner/runner-kit";
import {
  activePageTarget,
  registerPageTarget,
  requestFilePick,
  resetPageTargetsForTests,
  type PageTarget,
} from "@/lib/intent/page-target";
import { takesByAccept } from "@/lib/intent/accept-match";
import {
  carriesFiles as sheetCarriesFiles,
  describeDrag as sheetDescribeDrag,
} from "@/lib/intent/drag";
import {
  carriesFiles as layerCarriesFiles,
  describeDrag as layerDescribeDrag,
  DropLayer,
} from "./drop-layer";
import { DROP_ENGINE_MARK } from "@/lib/intent/drop-engine";
import { veilWords } from "./drop-layer-view";

const ROUTER = {
  push: vi.fn(),
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

/**
 * A page with the layer on it, its drawing already fetched — as it is by the
 * first drag on a real page, where it arrives on idle after load.
 */
async function page(children?: ReactNode) {
  const view = render(
    <AppRouterContext.Provider value={ROUTER}>
      <main>
        <h1>Merge PDF</h1>
        <textarea aria-label="Notes" />
        {children}
      </main>
      <DropLayer />
      <LiveRegion />
    </AppRouterContext.Provider>,
  );
  await act(async () => {
    await import("./drop-layer-view");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

beforeAll(() => {
  // jsdom has no idle callback: the layer's "fetch the view when idle"
  // runs at once, as an idle page would run it.
  window.requestIdleCallback ??= ((cb: IdleRequestCallback) => {
    cb({ didTimeout: false, timeRemaining: () => 50 });
    return 0;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback ??= () => {};
  // jsdom has the element and not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  resetPageTargetsForTests();
  resetAnnouncer();
  document.documentElement.removeAttribute("data-dragging");
});

/** What every tool page's zone passes (the runner kit's `Dropzone`); a case overrides it. */
const SHEET = {
  title: "Drop your files here, or",
  multiple: true,
  variant: "sheet",
} as const;

const pdf = (name = "a.pdf") =>
  new File(["%PDF-1.7"], name, { type: "application/pdf" });
const jpg = (name = "photo.jpg") =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: "image/jpeg" });

/** A drag as Chromium describes it: "Files" among its types, each item's kind and type. */
function transfer(files: File[], { describe = true } = {}) {
  return {
    types: ["Files"],
    files,
    items: describe
      ? files.map((f) => ({ kind: "file", type: f.type }))
      : undefined,
    dropEffect: "none",
  };
}

/**
 * Let the layer route: the registry arrives by a promise, and the layer
 * routes a turn after it does (every registration is in by then) — so two
 * turns from here: this one's timer is queued before the layer's.
 */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
const routed = async () => {
  await turn();
  await turn();
};

/**
 * Fire a cancelable drag event on `el`; returns the event. Awaited: where a
 * drag goes is the registry's, which the layer reaches through a promise.
 */
async function drag(
  type: "dragenter" | "dragleave" | "dragover" | "drop",
  el: Element,
  dataTransfer: object,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer });
  await act(async () => {
    el.dispatchEvent(event);
    await routed();
  });
  return event;
}

async function paste(el: Element, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files } });
  await act(async () => {
    el.dispatchEvent(event);
    await routed();
  });
  return event;
}

function target(over: Partial<PageTarget> = {}) {
  const t = {
    name: "Merge PDF",
    verb: "add" as const,
    canReceive: () => true,
    takes: takesByAccept("application/pdf"),
    receive: vi.fn<PageTarget["receive"]>(),
    arm: vi.fn<PageTarget["arm"]>(),
    element: () => null,
    ...over,
  };
  return t;
}

const veil = () => document.querySelector<HTMLElement>("[data-drop-veil]");

describe("a drag over the page", () => {
  it("arms the page's target and says what a release does there; leaving undoes all of it", async () => {
    await page();
    const t = target();
    registerPageTarget(t);
    const h1 = screen.getByRole("heading");
    const files = [pdf("a.pdf"), pdf("b.pdf")];
    await drag("dragenter", h1, transfer(files));
    expect(document.documentElement.hasAttribute("data-dragging")).toBe(true);
    expect(t.arm).toHaveBeenLastCalledWith(true);
    expect(veil()?.hasAttribute("data-open")).toBe(true);
    expect(veil()?.textContent).toContain(
      "Release to add 2 files to Merge PDF",
    );
    // The veil is never in the way, and never read out.
    expect(veil()?.getAttribute("aria-hidden")).toBe("true");
    expect(veil()?.className).toContain("pointer-events-none");
    // The page accepts the drag — or the browser opens the file on release.
    expect((await drag("dragover", h1, transfer(files))).defaultPrevented).toBe(
      true,
    );
    await drag("dragleave", h1, transfer(files));
    expect(document.documentElement.hasAttribute("data-dragging")).toBe(false);
    expect(t.arm).toHaveBeenLastCalledWith(false);
    expect(veil()?.hasAttribute("data-open")).toBe(false);
  });

  it("crossing elements does not flicker it: it ends when the last element entered is left", async () => {
    await page();
    registerPageTarget(target());
    const h1 = screen.getByRole("heading");
    const notes = screen.getByRole("textbox");
    const t = transfer([pdf()]);
    await drag("dragenter", h1, t);
    await drag("dragenter", notes, t);
    await drag("dragleave", h1, t);
    expect(veil()?.hasAttribute("data-open")).toBe(true);
    await drag("dragleave", notes, t);
    expect(veil()?.hasAttribute("data-open")).toBe(false);
  });

  it("a drag of text or a link is not a file: nothing arms, nothing is accepted", async () => {
    await page();
    const t = target();
    registerPageTarget(t);
    const text = { types: ["text/plain"], files: [], dropEffect: "none" };
    await drag("dragenter", screen.getByRole("heading"), text);
    expect(t.arm).not.toHaveBeenCalled();
    expect(veil()).toBeNull();
    expect(
      (await drag("dragover", screen.getByRole("heading"), text))
        .defaultPrevented,
    ).toBe(false);
  });

  it("a browser that does not describe the files (WebKit) gets no count, and is not held against the target", async () => {
    await page();
    registerPageTarget(target());
    await drag(
      "dragenter",
      screen.getByRole("heading"),
      transfer([pdf()], { describe: false }),
    );
    expect(veil()?.textContent).toContain("Release to add to Merge PDF");
  });
});

describe("a release, or a paste", () => {
  it("a drop no zone claimed goes to the page's target, and the tab stays on the page", async () => {
    await page();
    const t = target();
    registerPageTarget(t);
    const files = [pdf()];
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer(files));
    const drop = await drag("drop", h1, transfer(files));
    expect(drop.defaultPrevented).toBe(true);
    expect(t.receive).toHaveBeenCalledWith(files, "drop");
    expect(veil()?.hasAttribute("data-open")).toBe(false);
  });

  /**
   * A target the page DRAWS before its box is here — an open editor, whose
   * box comes from a module fetched with the file and is revealed by React
   * up to 300 ms after the editor (WP-07 re-review, measured on the served
   * build: the second PDF dropped on Rotate PDF the moment its editor
   * opened went to the ticket dialog). The file waits for the box.
   */
  it("a drop while a target the page draws has no box yet waits for it, and is the target's (control: with none drawn, it is routed at once)", async () => {
    await page(<div data-page-drop-target="" data-testid="arriving" />);
    const files = [pdf("second.pdf")];
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer(files));
    await drag("drop", h1, transfer(files));
    // Not routed past it: no dialog, and nothing delivered anywhere yet.
    expect(screen.queryByRole("dialog")).toBeNull();
    // The box arrives: registered, and marked as its engine marks it.
    const t = target({ name: "Rotate PDF", verb: "replace" });
    await act(async () => {
      registerPageTarget(t);
      screen.getByTestId("arriving").setAttribute(DROP_ENGINE_MARK, "");
      await routed();
    });
    expect(t.receive).toHaveBeenCalledWith(files, "drop");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a drag that begins while a target the page draws has no box yet: the veil waits for it, then says what a release there does", async () => {
    await page(<div data-page-drop-target="" data-testid="arriving" />);
    const files = [pdf("second.pdf")];
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer(files));
    // Not the dialog's words while the page shows a target on its way: no
    // open veil at all yet.
    expect(document.querySelector("[data-drop-veil][data-open]")).toBeNull();
    const t = target({
      name: "Rotate PDF",
      verb: "replace",
      current: "first.pdf",
    });
    await act(async () => {
      registerPageTarget(t);
      screen.getByTestId("arriving").setAttribute(DROP_ENGINE_MARK, "");
      await routed();
    });
    expect(veil()?.textContent).toContain(
      "Release to replace first.pdf in Rotate PDF",
    );
    expect(t.arm).toHaveBeenCalledWith(true);
  });

  it("control: with no target drawn and none registered, a drop goes to the dialog at once", async () => {
    await page();
    const files = [pdf("loose.pdf")];
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer(files));
    await drag("drop", h1, transfer(files));
    expect(
      await screen.findByRole("dialog", undefined, { timeout: 1000 }),
    ).toBeTruthy();
  });

  it("a drop a zone claimed is that zone's: the page's target is not handed it too", async () => {
    const onFiles = vi.fn();
    await page(
      <DropSheet
        {...SHEET}
        accept="image/png,image/jpeg"
        title="Drop a signature image, or"
        onFiles={onFiles}
      />,
    );
    const t = target();
    registerPageTarget(t);
    const zone = document.querySelector<HTMLElement>("[data-drop-sheet]")!;
    const files = [jpg()];
    await drag("dragenter", zone, transfer(files));
    // Over a zone that takes its own drops the veil says nothing: the
    // zone's own highlight is what a release there does.
    expect(veil()?.textContent).toBe("");
    await drag("drop", zone, transfer(files));
    expect(onFiles).toHaveBeenCalledWith(files, "drop");
    expect(t.receive).not.toHaveBeenCalled();
  });

  it("a paste of files outside a text field goes where a drop would; inside one, it is the field's", async () => {
    await page();
    const t = target();
    registerPageTarget(t);
    const files = [pdf()];
    const inField = await paste(screen.getByRole("textbox"), files);
    expect(inField.defaultPrevented).toBe(false);
    expect(t.receive).not.toHaveBeenCalled();
    const onPage = await paste(screen.getByRole("heading"), files);
    expect(onPage.defaultPrevented).toBe(true);
    expect(t.receive).toHaveBeenCalledWith(files, "paste");
  });

  it("a paste with no files (text) is left alone", async () => {
    await page();
    const t = target();
    registerPageTarget(t);
    expect(
      (await paste(screen.getByRole("heading"), [])).defaultPrevented,
    ).toBe(false);
    expect(t.receive).not.toHaveBeenCalled();
  });
});

describe("when the page's target does not take them, the ticket dialog does", () => {
  it("no target: the dialog opens with the files, named for what it shows", async () => {
    await page();
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer([pdf("lonely.pdf")]));
    expect(veil()?.textContent).toContain(
      "Release to see what opens this file",
    );
    await drag("drop", h1, transfer([pdf("lonely.pdf")]));
    const dialog = await screen.findByRole(
      "dialog",
      { name: "What you can do with these files" },
      { timeout: 5000 },
    );
    expect(within(dialog).getByText("lonely.pdf")).toBeTruthy();
    // While it is open it is the page's target: the next file joins it.
    await paste(h1, [pdf("second.pdf")]);
    expect(await within(dialog).findByText("second.pdf")).toBeTruthy();
    // Closing it ends it, and the page's drops are routed as before.
    const close = await within(dialog).findByRole(
      "button",
      { name: /^close/i },
      { timeout: 5000 },
    );
    act(() => close.click());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a target at work: the veil says so, the run is not interrupted, and the dialog says why", async () => {
    await page();
    const t = target({ canReceive: () => false });
    registerPageTarget(t);
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer([pdf()]));
    expect(t.arm).not.toHaveBeenCalled();
    expect(veil()?.textContent).toContain("Merge PDF is working on a file");
    await drag("drop", h1, transfer([pdf()]));
    expect(t.receive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain(
      "Merge PDF is still working on a file, so it did not go in.",
    );
  });

  it("a target that opens none of them: said before the release, and after", async () => {
    await page();
    const t = target();
    registerPageTarget(t);
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer([jpg()]));
    expect(veil()?.textContent).toContain("Merge PDF can't open this file");
    await drag("drop", h1, transfer([jpg()]));
    expect(t.receive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain("Merge PDF can't open it.");
  });
});

/**
 * The veil and the release say the same thing ON a zone as beside it.
 *
 * WAS (WP-07 review, reproduced on the served build at 1440): a JPG held
 * over Rotate PDF's own drop zone — the page's target — lit the zone (its
 * accent border, its 18px marks) while the veil said "Rotate PDF can't open
 * this file / Release to see what can"; and released there, the zone
 * claimed it, handed it to the runner, and the runner said "photo.jpg isn't
 * a PDF". The zone is where a person is most likely to let go, so the veil
 * was false exactly where it was most needed. Each row's control is the
 * same gesture with a file the zone does take.
 */
describe("a release on a zone goes where the veil said it would", () => {
  const registered = () =>
    waitFor(() => {
      if (!activePageTarget()) throw new Error("not registered yet");
    });

  it("a kind the page's zone does not take: the zone is not lit, and the release opens the dialog saying so — the zone's owner never hears of it", async () => {
    const onFiles = vi.fn();
    await page(
      <DropSheet
        {...SHEET}
        accept="application/pdf"
        multiple={false}
        title="Drop your PDF here, or"
        onFiles={onFiles}
        pageTarget={{ name: "Rotate PDF", verb: "open" }}
      />,
    );
    await registered();
    const zone = document.querySelector<HTMLElement>("[data-drop-sheet]")!;
    await drag("dragenter", zone, transfer([jpg()]));
    expect(veil()?.textContent).toContain("Rotate PDF can't open this file");
    expect(zone.hasAttribute("data-armed")).toBe(false);
    expect(zone.hasAttribute("data-over")).toBe(false);
    const drop = await drag("drop", zone, transfer([jpg()]));
    // Not claimed by the zone: the layer took it, and routed it.
    expect(drop.defaultPrevented).toBe(true);
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain("Rotate PDF can't open it.");
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("control: a kind it takes lights the zone and is the zone's", async () => {
    const onFiles = vi.fn();
    await page(
      <DropSheet
        {...SHEET}
        accept="application/pdf"
        multiple={false}
        title="Drop your PDF here, or"
        onFiles={onFiles}
        pageTarget={{ name: "Rotate PDF", verb: "open" }}
      />,
    );
    await registered();
    const zone = document.querySelector<HTMLElement>("[data-drop-sheet]")!;
    const files = [pdf("scan.pdf")];
    await drag("dragenter", zone, transfer(files));
    expect(veil()?.textContent).toContain("Release to open in Rotate PDF");
    expect(zone.hasAttribute("data-armed")).toBe(true);
    expect(zone.hasAttribute("data-over")).toBe(true);
    await drag("drop", zone, transfer(files));
    expect(onFiles).toHaveBeenCalledWith(files, "drop");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the page's zone at work: a release on it is not taken mid-run, and the dialog says why", async () => {
    const onFiles = vi.fn();
    await page(
      <DropSheet
        {...SHEET}
        accept="application/pdf"
        title="Drop your PDFs here, or"
        onFiles={onFiles}
        pageTarget={{
          name: "Merge PDF",
          verb: "add",
          canReceive: () => false,
        }}
      />,
    );
    await registered();
    const zone = document.querySelector<HTMLElement>("[data-drop-sheet]")!;
    await drag("dragenter", zone, transfer([pdf()]));
    expect(veil()?.textContent).toContain("Merge PDF is working on a file");
    expect(zone.hasAttribute("data-armed")).toBe(false);
    await drag("drop", zone, transfer([pdf()]));
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain(
      "Merge PDF is still working on a file, so it did not go in.",
    );
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("a zone of its own (not the page's) that does not take the kind is no landing place: the veil and the release are the page's target's", async () => {
    const onFiles = vi.fn();
    await page(
      <DropSheet
        {...SHEET}
        accept="image/png,image/jpeg"
        title="Drop a signature image, or"
        onFiles={onFiles}
      />,
    );
    const t = target({ name: "Sign PDF", verb: "replace", current: "a.pdf" });
    registerPageTarget(t);
    const zone = document.querySelector<HTMLElement>("[data-drop-sheet]")!;
    const files = [pdf("countersigned.pdf")];
    await drag("dragenter", zone, transfer(files));
    // Not the zone's silence: the page's route, in words.
    expect(veil()?.textContent).toContain(
      "Release to replace a.pdf in Sign PDF",
    );
    expect(zone.hasAttribute("data-armed")).toBe(false);
    await drag("drop", zone, transfer(files));
    expect(t.receive).toHaveBeenCalledWith(files, "drop");
    expect(onFiles).not.toHaveBeenCalled();
  });
});

/**
 * WAS (WP-07 review, both schemes, 390 and 1440): a second file dragged
 * while the dialog was open drew the veil BEHIND the modal — the dialog is
 * in the top layer, the veil a z-[80] element — so its dimming and its
 * sentence ("Release to add to this ticket") sat under the backdrop as
 * ghost text below the dialog.
 */
describe("while the ticket dialog is open", () => {
  it("a drag draws no veil; the dialog's own sheet is armed (control: before it opened, the same drag drew one)", async () => {
    await page();
    const h1 = screen.getByRole("heading");
    // Control: no dialog, the veil is drawn.
    await drag("dragenter", h1, transfer([pdf("first.pdf")]));
    expect(veil()?.hasAttribute("data-open")).toBe(true);
    await drag("drop", h1, transfer([pdf("first.pdf")]));
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    await waitFor(() => {
      if (!activePageTarget()) throw new Error("the dialog is not the target");
    });
    await drag("dragenter", dialog, transfer([pdf("second.pdf")]));
    expect(
      document.querySelectorAll("[data-drop-veil]"),
      "a veil drawn under the open dialog",
    ).toHaveLength(0);
    expect(
      dialog.querySelector("[data-drop-sheet]")!.hasAttribute("data-armed"),
    ).toBe(true);
    // And the file joins the ticket.
    await drag("drop", dialog, transfer([pdf("second.pdf")]));
    expect(await within(dialog).findByText("second.pdf")).toBeTruthy();
  });
});

/**
 * Addendum WP-07 #2: "a routed whole-page drop on a worker tool must never
 * reach onFiles with a refused file", and what the page does when EVERY
 * routed file is refused is one choice, tested. The choice, by the reason:
 *  - a file whose KIND the zone does not take (its `accept`) goes to the
 *    ticket dialog before it reaches the zone (the rows above, "opens none");
 *  - a file the zone takes in kind but refuses on its own terms (`refuse`:
 *    over the tool's cap, say) is handed to the zone, as a drop on it would
 *    be, and the refusal is said ON the zone — the tool's own words for its
 *    own limit — and the owner never receives it.
 */
describe("a file the page's zone refuses on its own terms", () => {
  it("is refused on the zone, said there, and never reaches the zone's owner", async () => {
    const onFiles = vi.fn();
    await page(
      <Dropzone
        pageTarget
        compact
        multiple={false}
        title="Add a scan to OCR, or"
        refuse={(file) =>
          file.size > 4 ? `"${file.name}" is over this tool's limit.` : null
        }
        onFiles={onFiles}
      />,
    );
    const big = new File(["%PDF-1.7 and then some"], "big.pdf", {
      type: "application/pdf",
    });
    const h1 = screen.getByRole("heading");
    await drag("dragenter", h1, transfer([big]));
    await drag("drop", h1, transfer([big]));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `"big.pdf" is over this tool's limit.`,
    );
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Open files", () => {
  it("with no target of its own, a page uses the layer's picker — made when asked for, never before, and gone with the layer", async () => {
    const files = () => document.querySelectorAll('input[type="file"]').length;
    const { container, unmount } = await page();
    // Nothing of the layer's is a file input until a pick is asked for: a
    // page's first file input is always the page's own (workspace.spec
    // caught one that was, in the moment React reveals a prerendered page).
    expect(files()).toBe(0);
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      expect(requestFilePick()).toBe("fallback");
      // Made by the layer's view, which is here by a click.
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      const input = click.mock.contexts[0] as HTMLInputElement;
      expect(input.type).toBe("file");
      expect(input.isConnected).toBe(true);
      expect(container.querySelector("main")!.contains(input)).toBe(false);
    } finally {
      click.mockRestore();
    }
    unmount();
    expect(files()).toBe(0);
    expect(requestFilePick()).toBe("nowhere");
  });
});

describe("negative control: without the layer", () => {
  it("the page does not accept a file dragged over it, so the browser would open it in the tab", async () => {
    render(<h1>Merge PDF</h1>);
    const h1 = screen.getByRole("heading");
    expect(
      (await drag("dragover", h1, transfer([pdf()]))).defaultPrevented,
    ).toBe(false);
    expect((await drag("drop", h1, transfer([pdf()]))).defaultPrevented).toBe(
      false,
    );
  });
});

/**
 * The layer asks "does this drag carry files?" and "what does it describe?"
 * synchronously, in the layout's chunk, so it holds its own copies of the
 * questions the sheets ask (`@/lib/intent/drag`) — and a sheet and the
 * layer answering differently would be a drag one of them accepts and the
 * other drops, or a sheet lit for a file the veil says it refuses. One
 * answer, over every shape a drag event comes in. (WAS held to the
 * registry's copy; the registry left every page's first load, 2026-10-10.)
 */
describe("the layer and the sheets agree on what a drag carries", () => {
  it("what describes the files: over every shape, both answers present", () => {
    const shapes = [
      null,
      undefined,
      {},
      { items: [] },
      { items: [{ kind: "file", type: "image/jpeg" }] },
      {
        items: [
          { kind: "string", type: "text/plain" },
          { kind: "file", type: "" },
          { kind: "file", type: "application/pdf" },
        ],
      },
    ] as unknown as Parameters<typeof layerDescribeDrag>[0][];
    const layer = shapes.map(layerDescribeDrag);
    expect(layer).toEqual(shapes.map(sheetDescribeDrag));
    // Positive control: the corpus has empty and described answers.
    expect(layer.some((kinds) => kinds.length === 0)).toBe(true);
    expect(layer.some((kinds) => kinds.length === 2)).toBe(true);
  });

  it("what carries files: over every shape, both answers present", () => {
    const shapes = [
      { dataTransfer: null },
      { dataTransfer: { types: ["Files"], files: [] } },
      { dataTransfer: { types: ["text/plain", "Files"], files: [pdf()] } },
      { dataTransfer: { types: ["text/plain"], files: [] } },
      { dataTransfer: { types: ["text/uri-list"], files: [] } },
      { dataTransfer: { types: [], files: [pdf()] } },
      { dataTransfer: { files: [pdf()] } },
      { dataTransfer: { files: [] } },
    ] as unknown as Parameters<typeof layerCarriesFiles>[0][];
    const layer = shapes.map(layerCarriesFiles);
    expect(layer).toEqual(shapes.map(sheetCarriesFiles));
    // Positive control: the corpus asks both questions.
    expect(layer).toContain(true);
    expect(layer).toContain(false);
  });
});

describe("veilWords", () => {
  const t = (verb: PageTarget["verb"]) =>
    ({
      to: "target",
      target: { ...target(), name: "Rotate PDF", verb },
    }) as const;
  it("says each verb, with a count only where the browser gave one", () => {
    expect(veilWords(t("add"), 3).main).toBe(
      "Release to add 3 files to Rotate PDF",
    );
    expect(veilWords(t("add"), 0).main).toBe("Release to add to Rotate PDF");
    expect(veilWords(t("open"), 1).main).toBe("Release to open in Rotate PDF");
    expect(veilWords(t("replace"), 1).main).toBe(
      "Release to replace the file in Rotate PDF",
    );
    expect(veilWords(t("check"), 2).main).toBe("Release to check 2 files");
    // A replace names the file it replaces, when the target says.
    expect(
      veilWords(
        {
          to: "target",
          target: {
            ...target(),
            name: "Rotate PDF",
            verb: "replace",
            current: "contract.pdf",
          },
        },
        1,
      ).main,
    ).toBe("Release to replace contract.pdf in Rotate PDF");
    expect(veilWords(t("check"), 0).main).toBe("Release to check these files");
    expect(veilWords({ to: "fallback", why: { kind: "none" } }, 0).main).toBe(
      "Release to see what opens these files",
    );
  });
});
