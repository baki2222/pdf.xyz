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
import { act, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { DropSheet } from "@/components/upload/drop-sheet";
import { Dropzone } from "@/components/tools/runner/runner-kit";
import {
  carriesFiles as registryCarriesFiles,
  registerPageTarget,
  requestFilePick,
  resetPageTargetsForTests,
  type PageTarget,
} from "@/lib/intent/page-target";
import { takesByAccept } from "@/lib/intent/accept-match";
import { carriesFiles as layerCarriesFiles, DropLayer } from "./drop-layer";
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
  });
  return event;
}

async function paste(el: Element, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files } });
  await act(async () => {
    el.dispatchEvent(event);
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

  it("a drop a zone claimed is that zone's: the page's target is not handed it too", async () => {
    const onFiles = vi.fn();
    await page(
      <DropSheet
        accept="image/png,image/jpeg"
        title="Drop a signature image, or"
        onFiles={onFiles}
        id="secondary"
      />,
    );
    const t = target();
    registerPageTarget(t);
    const zone = document.getElementById("secondary")!;
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
      expect(click).toHaveBeenCalledTimes(1);
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
 * The layer asks "does this drag carry files?" before the registry has
 * arrived (it is kept out of the layout's chunk), so it holds its own copy
 * of the question — and a sheet and the layer answering differently would
 * be a drag one of them accepts and the other drops. One answer, over
 * every shape a drag event comes in.
 */
describe("the layer and the registry agree on what carries files", () => {
  it("over every shape, both answers present", () => {
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
    expect(layer).toEqual(shapes.map(registryCarriesFiles));
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
