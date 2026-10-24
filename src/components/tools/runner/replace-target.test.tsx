// @vitest-environment jsdom
// @native-canvas
/**
 * A PDF dropped anywhere on a tool page whose editor is open REPLACES the
 * open document — and nothing else does.
 *
 * Composed as a tool page composes it: the tool's identity (the page's
 * `data-tool-name` around the runner), the real dispatcher and runner, the
 * real drop layer, and a heading outside the runner for the file to land
 * on. The file is loaded through the zone's real input and read by the
 * real hook.
 *
 * The four ways this can go wrong, each held below with its control:
 *  - the page's drop opens the file in the tab (no target): the editor
 *    registers as the page's target while a document is open;
 *  - a secondary zone inside the editor (Sign PDF's signature image) takes
 *    the page's drops instead: it never registers, and a drop made ON it is
 *    still its own;
 *  - a file the editor cannot open closes it on an error: only a PDF
 *    replaces; anything else goes to the ticket dialog;
 *  - a drop lands mid-run or over unsaved work: the editor's own
 *    `aria-busy` refuses it, and `confirmLeave` asks first.
 *
 * And what a replace says (the last block): it is announced, naming both
 * files, and focus that was inside the old editor — gone with it, since the
 * editor is keyed by its file — moves into the new one.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { DropLayer } from "@/components/intent/drop-layer";
import {
  activePageTarget,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import {
  __setHandoffStoreForTests,
  HandoffStore,
  MemoryHandoffBackend,
} from "@/lib/handoff";
import { continueTargetsFor } from "@/lib/intent/next-steps";
import { registerDirty, resetUnsavedForTests } from "@/lib/intent/unsaved";
import { getToolBySlug, tools } from "@/lib/tools";
import { withAppRouter } from "@/tests/app-router";
import { runnerMounted } from "@/tests/runner-mounted";
import { ToolRunProvider } from "./tool-context";
import { ToolRunner } from "./tool-runner";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  resetPageTargetsForTests();
  resetUnsavedForTests();
  resetAnnouncer();
  vi.restoreAllMocks();
});

async function pdfFile(name: string, pages = 1): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return new File([(await doc.save()) as BlobPart], name, {
    type: "application/pdf",
  });
}

const png = (name = "sig.png") =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: "image/png",
  });

function dropOn(el: Element, files: File[]) {
  const dataTransfer = {
    types: ["Files"],
    files,
    items: files.map((f) => ({ kind: "file", type: f.type })),
    dropEffect: "none",
  };
  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer });
    act(() => {
      el.dispatchEvent(event);
    });
  }
}

/**
 * A tool page: its identity, its runner, the layer, and a heading outside
 * both — and, `onPage`, the page's job around the runner (`ToolRunProvider`),
 * so a result draws its Continue rows.
 */
async function openTool(
  kind: "rotate" | "sign",
  slug: string,
  name: string,
  { onPage = false }: { onPage?: boolean } = {},
) {
  const runner = <ToolRunner kind={kind} slug={slug} />;
  const tool = getToolBySlug(slug)!;
  const view = render(
    withAppRouter(
      <>
        <h1>{name}</h1>
        <div data-tool-panel data-tool-name={name}>
          {onPage ? (
            <ToolRunProvider
              tool={{
                slug: tool.slug,
                name: tool.name,
                category: tool.category,
              }}
              plan={continueTargetsFor(tool, tools)}
            >
              {runner}
            </ToolRunProvider>
          ) : (
            runner
          )}
        </div>
        <DropLayer />
        <LiveRegion />
      </>,
    ),
  );
  await runnerMounted(view.container);
  // The heading renders first, so wait for the runner's own zone — and take
  // ITS input, never the drop layer's (after the page's on a real page, but
  // here present before a lazily loaded runner is).
  const empty = await waitFor(
    () => {
      const zone = view.container.querySelector(
        '[data-single-pdf-runner="empty"]',
      );
      if (!zone) throw new Error("the runner has not rendered its zone");
      return zone;
    },
    { timeout: 20_000 },
  );
  const input = empty.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [await pdfFile("first.pdf")] } });
  await waitFor(
    () =>
      expect(
        view.container.querySelector('[data-single-pdf-runner="loaded"]'),
      ).not.toBeNull(),
    { timeout: 20_000 },
  );
  // The editor is the page's target once its box (`EditorBox`, fetched as
  // the editor opens — not with the page) and the registry have it: a cold
  // import under a loaded test run, so the same allowance as the runner's.
  await waitFor(() => expect(activePageTarget()?.verb).toBe("replace"), {
    timeout: 20_000,
  });
  return view;
}

const openName = (container: HTMLElement) =>
  container.querySelector('[data-single-pdf-runner="loaded"]')?.textContent ??
  "";
const targets = (container: HTMLElement) =>
  container.querySelectorAll("[data-page-drop-target]").length;

// The first test in a worker pays for loading the runners, the reader and
// the ticket; generous so the measure is the behaviour, not the import.
const SLOW = { timeout: 30_000 };

describe("an open editor is its page's drop target", SLOW, () => {
  it("registers as one, named for the tool, and is the only one on the page", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    expect(activePageTarget()?.name).toBe("Rotate PDF");
    expect(activePageTarget()?.verb).toBe("replace");
    expect(targets(container)).toBe(1);
  });

  it("a PDF dropped anywhere on the page replaces the open one", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    expect(openName(container)).toContain("first.pdf");
    dropOn(screen.getByRole("heading", { level: 1 }), [
      await pdfFile("second.pdf", 2),
    ]);
    await waitFor(() => expect(openName(container)).toContain("second.pdf"), {
      timeout: 5000,
    });
  });

  it("a file it cannot open leaves the open document where it is", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    dropOn(screen.getByRole("heading", { level: 1 }), [png("photo.png")]);
    // The ticket dialog takes it instead (drop-layer.test.tsx).
    await screen.findByRole("dialog", undefined, { timeout: 5000 });
    expect(openName(container)).toContain("first.pdf");
  });

  it("not mid-run: the editor's own aria-busy turns it away (control: without it, it takes the file)", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    const editor = container.querySelector(
      '[data-single-pdf-runner="loaded"]',
    )!;
    expect(activePageTarget()?.canReceive()).toBe(true);
    const run = editor.querySelector("button")!;
    run.setAttribute("aria-busy", "true");
    expect(activePageTarget()?.canReceive()).toBe(false);
    run.removeAttribute("aria-busy");
    expect(activePageTarget()?.canReceive()).toBe(true);
  });

  it("unsaved work is asked about first, and a no keeps the document", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    registerDirty("your rotations in Rotate PDF");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    dropOn(screen.getByRole("heading", { level: 1 }), [
      await pdfFile("second.pdf"),
    ]);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![0]).toContain("your rotations in Rotate PDF");
    // Give a replace every chance to happen; it must not.
    await new Promise((r) => setTimeout(r, 200));
    expect(openName(container)).toContain("first.pdf");
    confirm.mockReturnValue(true);
    dropOn(screen.getByRole("heading", { level: 1 }), [
      await pdfFile("second.pdf"),
    ]);
    await waitFor(() => expect(openName(container)).toContain("second.pdf"), {
      timeout: 5000,
    });
  });
});

describe(
  "a secondary zone inside the editor never takes the page's drops",
  SLOW,
  () => {
    it("Sign PDF with Upload chosen: the signature zone is shown, the page's drop still replaces the PDF", async () => {
      const { container } = await openTool("sign", "sign-pdf", "Sign PDF");
      // The signature panel opens with the editor (Sign PDF opens on Sign);
      // Upload is its tab. WAS a radio in the form, until 2026-10-24.
      fireEvent.click(await screen.findByRole("tab", { name: "Upload" }));
      const zone = await screen.findByText(/drop a signature image, or/i);
      // The zone is there (positive control for the condition being tested)…
      expect(zone).toBeTruthy();
      // …and the page still has one target, the editor's.
      expect(targets(container)).toBe(1);
      expect(activePageTarget()?.verb).toBe("replace");
      dropOn(screen.getByRole("heading", { level: 1 }), [
        await pdfFile("contract.pdf"),
      ]);
      await waitFor(
        () => expect(openName(container)).toContain("contract.pdf"),
        {
          timeout: 5000,
        },
      );
    });

    it("control: a drop made ON the signature zone is the zone's, not a replace", async () => {
      const { container } = await openTool("sign", "sign-pdf", "Sign PDF");
      // The signature panel opens with the editor (Sign PDF opens on Sign);
      // Upload is its tab. WAS a radio in the form, until 2026-10-24.
      fireEvent.click(await screen.findByRole("tab", { name: "Upload" }));
      const zone = (
        await screen.findByText(/drop a signature image, or/i)
      ).closest("[data-drop-sheet]")!;
      dropOn(zone, [png()]);
      // Not replaced, and no dialog: the zone took it.
      await new Promise((r) => setTimeout(r, 200));
      expect(openName(container)).toContain("first.pdf");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  },
);

/** Paste `files` with focus on `el`, as Ctrl+V does: the event is the focused element's. */
function pasteOn(el: Element, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files } });
  act(() => {
    el.dispatchEvent(event);
  });
}

const liveText = () =>
  document.querySelector('[aria-live="polite"][aria-atomic="true"]')
    ?.textContent ?? "";

/**
 * WAS (WP-07 review, measured on the served build): with alpha.pdf open in
 * Rotate PDF and focus on one of its buttons, a paste of beta.pdf remounted
 * the editor, focus fell to <body>, and the live region stayed empty — the
 * new file's name and the loss of the old were never said. A drop said only
 * "Rendering previews… 0/1". Ctrl+V outside a text field is a new keyboard
 * path to throwing the open document away, so it must be heard.
 */
describe("a replace is said, and focus survives it", SLOW, () => {
  it("a paste with focus inside the editor: announced by both names, and focus moves into the new editor (control: the old editor, focus's home, is gone)", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    const before = container.querySelector(
      '[data-single-pdf-runner="loaded"]',
    )!;
    const button = before.querySelector<HTMLButtonElement>("button")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    pasteOn(button, [await pdfFile("second.pdf", 2)]);
    await waitFor(() => expect(openName(container)).toContain("second.pdf"), {
      timeout: 5000,
    });
    // Control: the editor that held focus is gone — without the move, focus
    // would be on <body>.
    expect(before.isConnected).toBe(false);
    await waitFor(() =>
      expect(liveText()).toBe(
        "Replaced first.pdf with second.pdf in Rotate PDF.",
      ),
    );
    const after = container.querySelector('[data-single-pdf-runner="loaded"]')!;
    expect(after.contains(document.activeElement)).toBe(true);
    // Its file header: the name and the pages, read where focus lands.
    expect(document.activeElement?.textContent).toContain("second.pdf");
    expect(document.activeElement?.textContent).toContain("2 pages");
  });

  it("focus outside the editor stays where it is; the replace is still said", async () => {
    const { container } = await openTool("rotate", "rotate-pdf", "Rotate PDF");
    const outside = document.createElement("button");
    outside.textContent = "Elsewhere";
    document.body.append(outside);
    try {
      outside.focus();
      dropOn(screen.getByRole("heading", { level: 1 }), [
        await pdfFile("third.pdf"),
      ]);
      await waitFor(() => expect(openName(container)).toContain("third.pdf"), {
        timeout: 5000,
      });
      await waitFor(() =>
        expect(liveText()).toBe(
          "Replaced first.pdf with third.pdf in Rotate PDF.",
        ),
      );
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });
});

/**
 * A RESULT NOT YET DOWNLOADED IS NOT THROWN AWAY BY A PASTE (2026-10-17).
 * An editor's unsaved-work guard lets go once a result exists
 * (`useUnsavedGuard(... && !result)`), and the result is still the open
 * document's: a PDF pasted on the page replaced it with no word — Sign PDF
 * at 1280, PR #180 review. A drop over it is told first, by the veil
 * ("Release to replace contract.pdf in Sign PDF"); a paste has no veil, so
 * it asks — until the result is downloaded, or carried on.
 */
describe("a result not yet downloaded", SLOW, () => {
  const URL_STATICS = ["createObjectURL", "revokeObjectURL"] as const;
  const original = URL_STATICS.map(
    (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
  );
  afterEach(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(URL, key, descriptor);
      else Reflect.deleteProperty(URL, key);
    }
  });

  async function rotated(onPage = false) {
    const view = await openTool("rotate", "rotate-pdf", "Rotate PDF", {
      onPage,
    });
    fireEvent.click(screen.getByRole("button", { name: /^right$/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply rotation/i }));
    await screen.findByRole(
      "button",
      { name: /download rotated pdf/i },
      { timeout: 10_000 },
    );
    return view;
  }
  const resultShown = () =>
    screen.queryByRole("button", { name: /download rotated pdf/i }) !== null;

  it("a paste over it asks first, and a no keeps the result", async () => {
    const { container } = await rotated();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    pasteOn(document.body, [await pdfFile("second.pdf")]);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(confirm.mock.calls[0]![0]).toMatch(/not downloaded/i);
    expect(confirm.mock.calls[0]![0]).toContain("second.pdf");
    // Give a replace every chance to happen; it must not.
    await new Promise((r) => setTimeout(r, 300));
    expect(resultShown()).toBe(true);
    expect(openName(container)).not.toContain("second.pdf");
    // A yes replaces it.
    confirm.mockReturnValue(true);
    pasteOn(document.body, [await pdfFile("third.pdf")]);
    await waitFor(() => expect(openName(container)).toContain("third.pdf"), {
      timeout: 5000,
    });
  });

  it("CONTROL: once downloaded, a paste replaces it without a question", async () => {
    const { container } = await rotated();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:replace-target-test",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole("button", { name: /download rotated pdf/i }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    pasteOn(document.body, [await pdfFile("second.pdf")]);
    await waitFor(() => expect(openName(container)).toContain("second.pdf"), {
      timeout: 5000,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  /**
   * A CONTINUE ROW THAT CARRIED NOTHING DOES NOT KEEP IT (2026-10-17). A
   * click on a row counted as keeping the result — but the result stays on
   * the page only when the row did NOT carry it: a modified click (the plain
   * tool page, in a new tab, with no file) or a store that refused it
   * ("Couldn't carry the file … Download it"). In both, a paste then
   * replaced the result with no question (PR #180 re-review). A row that
   * carries it navigates, and the result leaves the page with it.
   */
  it("a Ctrl+click on a Continue row carries nothing: a paste over the result still asks", async () => {
    __setHandoffStoreForTests(
      new HandoffStore({ backend: new MemoryHandoffBackend() }),
    );
    try {
      await rotated(true);
      const row = (
        await screen.findAllByRole(
          "link",
          { name: /^continue with/i },
          { timeout: 10_000 },
        )
      )[0]!;
      // jsdom does not navigate; the browser opens the plain page in a tab.
      fireEvent.click(row, { ctrlKey: true });
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      pasteOn(document.body, [await pdfFile("second.pdf")]);
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), {
        timeout: 5000,
      });
      expect(resultShown()).toBe(true);
    } finally {
      __setHandoffStoreForTests(null);
    }
  });

  it("a Continue row whose store refused the file carries nothing: a paste over the result still asks", async () => {
    __setHandoffStoreForTests(
      new HandoffStore({
        backend: {
          put: async () => {
            throw new Error("QuotaExceededError");
          },
          get: async () => undefined,
          delete: async () => {},
          getAll: async () => [],
          clear: async () => {},
        },
      }),
    );
    try {
      await rotated(true);
      const row = (
        await screen.findAllByRole(
          "link",
          { name: /^continue with/i },
          { timeout: 10_000 },
        )
      )[0]!;
      await act(async () => {
        fireEvent.click(row);
      });
      // Health: the row said it could not carry the file.
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /couldn't carry the file/i,
      );
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      pasteOn(document.body, [await pdfFile("second.pdf")]);
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), {
        timeout: 5000,
      });
      expect(resultShown()).toBe(true);
    } finally {
      __setHandoffStoreForTests(null);
    }
  });

  it("a drop over it is not asked about: the veil said what a release does", async () => {
    const { container } = await rotated();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    dropOn(screen.getByRole("heading", { level: 1 }), [
      await pdfFile("second.pdf"),
    ]);
    await waitFor(() => expect(openName(container)).toContain("second.pdf"), {
      timeout: 5000,
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});
