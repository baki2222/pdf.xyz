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
import {
  registerPageTarget,
  requestFilePick,
  resetPageTargetsForTests,
  takesByAccept,
  type PageTarget,
} from "@/lib/intent/page-target";
import { DropLayer, veilWords } from "./drop-layer";

const ROUTER = {
  push: vi.fn(),
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

function page(children?: ReactNode) {
  return render(
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
}

beforeAll(() => {
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

/** Fire a cancelable drag event on `el`; returns the event. */
function drag(
  type: "dragenter" | "dragleave" | "dragover" | "drop",
  el: Element,
  dataTransfer: object,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function paste(el: Element, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files } });
  act(() => {
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
  it("arms the page's target and says what a release does there; leaving undoes all of it", () => {
    page();
    const t = target();
    registerPageTarget(t);
    const h1 = screen.getByRole("heading");
    const files = [pdf("a.pdf"), pdf("b.pdf")];
    drag("dragenter", h1, transfer(files));
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
    expect(drag("dragover", h1, transfer(files)).defaultPrevented).toBe(true);
    drag("dragleave", h1, transfer(files));
    expect(document.documentElement.hasAttribute("data-dragging")).toBe(false);
    expect(t.arm).toHaveBeenLastCalledWith(false);
    expect(veil()?.hasAttribute("data-open")).toBe(false);
  });

  it("crossing elements does not flicker it: it ends when the last element entered is left", () => {
    page();
    registerPageTarget(target());
    const h1 = screen.getByRole("heading");
    const notes = screen.getByRole("textbox");
    const t = transfer([pdf()]);
    drag("dragenter", h1, t);
    drag("dragenter", notes, t);
    drag("dragleave", h1, t);
    expect(veil()?.hasAttribute("data-open")).toBe(true);
    drag("dragleave", notes, t);
    expect(veil()?.hasAttribute("data-open")).toBe(false);
  });

  it("a drag of text or a link is not a file: nothing arms, nothing is accepted", () => {
    page();
    const t = target();
    registerPageTarget(t);
    const text = { types: ["text/plain"], files: [], dropEffect: "none" };
    drag("dragenter", screen.getByRole("heading"), text);
    expect(t.arm).not.toHaveBeenCalled();
    expect(veil()).toBeNull();
    expect(
      drag("dragover", screen.getByRole("heading"), text).defaultPrevented,
    ).toBe(false);
  });

  it("a browser that does not describe the files (WebKit) gets no count, and is not held against the target", () => {
    page();
    registerPageTarget(target());
    drag(
      "dragenter",
      screen.getByRole("heading"),
      transfer([pdf()], { describe: false }),
    );
    expect(veil()?.textContent).toContain("Release to add to Merge PDF");
  });
});

describe("a release, or a paste", () => {
  it("a drop no zone claimed goes to the page's target, and the tab stays on the page", () => {
    page();
    const t = target();
    registerPageTarget(t);
    const files = [pdf()];
    const h1 = screen.getByRole("heading");
    drag("dragenter", h1, transfer(files));
    const drop = drag("drop", h1, transfer(files));
    expect(drop.defaultPrevented).toBe(true);
    expect(t.receive).toHaveBeenCalledWith(files, "drop");
    expect(veil()?.hasAttribute("data-open")).toBe(false);
  });

  it("a drop a zone claimed is that zone's: the page's target is not handed it too", () => {
    const onFiles = vi.fn();
    page(
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
    drag("dragenter", zone, transfer(files));
    // Over a zone that takes its own drops the veil says nothing: the
    // zone's own highlight is what a release there does.
    expect(veil()?.textContent).toBe("");
    drag("drop", zone, transfer(files));
    expect(onFiles).toHaveBeenCalledWith(files, "drop");
    expect(t.receive).not.toHaveBeenCalled();
  });

  it("a paste of files outside a text field goes where a drop would; inside one, it is the field's", () => {
    page();
    const t = target();
    registerPageTarget(t);
    const files = [pdf()];
    const inField = paste(screen.getByRole("textbox"), files);
    expect(inField.defaultPrevented).toBe(false);
    expect(t.receive).not.toHaveBeenCalled();
    const onPage = paste(screen.getByRole("heading"), files);
    expect(onPage.defaultPrevented).toBe(true);
    expect(t.receive).toHaveBeenCalledWith(files, "paste");
  });

  it("a paste with no files (text) is left alone", () => {
    page();
    const t = target();
    registerPageTarget(t);
    expect(paste(screen.getByRole("heading"), []).defaultPrevented).toBe(false);
    expect(t.receive).not.toHaveBeenCalled();
  });
});

describe("when the page's target does not take them, the ticket dialog does", () => {
  it("no target: the dialog opens with the files, named for what it shows", async () => {
    page();
    const h1 = screen.getByRole("heading");
    drag("dragenter", h1, transfer([pdf("lonely.pdf")]));
    expect(veil()?.textContent).toContain(
      "Release to see what opens this file",
    );
    drag("drop", h1, transfer([pdf("lonely.pdf")]));
    const dialog = await screen.findByRole(
      "dialog",
      { name: "What you can do with these files" },
      { timeout: 5000 },
    );
    expect(within(dialog).getByText("lonely.pdf")).toBeTruthy();
    // While it is open it is the page's target: the next file joins it.
    paste(h1, [pdf("second.pdf")]);
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
    page();
    const t = target({ canReceive: () => false });
    registerPageTarget(t);
    const h1 = screen.getByRole("heading");
    drag("dragenter", h1, transfer([pdf()]));
    expect(t.arm).not.toHaveBeenCalled();
    expect(veil()?.textContent).toContain("Merge PDF is working on a file");
    drag("drop", h1, transfer([pdf()]));
    expect(t.receive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain(
      "Merge PDF is still working on a file, so it did not go in.",
    );
  });

  it("a target that opens none of them: said before the release, and after", async () => {
    page();
    const t = target();
    registerPageTarget(t);
    const h1 = screen.getByRole("heading");
    drag("dragenter", h1, transfer([jpg()]));
    expect(veil()?.textContent).toContain("Merge PDF can't open this file");
    drag("drop", h1, transfer([jpg()]));
    expect(t.receive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain("Merge PDF can't open it.");
  });
});

describe("Open files", () => {
  it("with no target of its own, a page uses the layer's picker — after <main>, so never a page's first", () => {
    const { container } = page();
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      expect(requestFilePick()).toBe("fallback");
      expect(click).toHaveBeenCalledTimes(1);
      const input = click.mock.contexts[0] as HTMLInputElement;
      expect(input.type).toBe("file");
      expect(container.querySelector("main")!.contains(input)).toBe(false);
    } finally {
      click.mockRestore();
    }
  });
});

describe("negative control: without the layer", () => {
  it("the page does not accept a file dragged over it, so the browser would open it in the tab", () => {
    render(<h1>Merge PDF</h1>);
    const h1 = screen.getByRole("heading");
    expect(drag("dragover", h1, transfer([pdf()])).defaultPrevented).toBe(
      false,
    );
    expect(drag("drop", h1, transfer([pdf()])).defaultPrevented).toBe(false);
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
    expect(veilWords(t("check"), 0).main).toBe("Release to check these files");
    expect(veilWords({ to: "fallback", why: { kind: "none" } }, 0).main).toBe(
      "Release to see what opens these files",
    );
  });
});
