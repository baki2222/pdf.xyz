// @vitest-environment jsdom
/**
 * A guide's desk: drop the file the guide is about, and the tool the guide
 * teaches opens with it already loaded (redesign G.7, "Guide: merge" —
 * WAS "open the tool, pick the file again").
 *
 * Two halves. THE PAGE (every guide the route prerenders, rendered as the
 * server renders it): the desk sits between the introduction and the first
 * "Open …" button, and promises only what the tool's runner can do — the
 * six guides whose tool has no in-browser runner (PDF to Word, OCR,
 * Protect, Translate, Repair, Unlock) say "see which tools open it", never
 * "open X with it" (addendum WP-07 #8). THE DESK (composed with the real
 * drop layer and a memory hand-off store): a file the tool takes is carried
 * to it, from a guide; a file it does not take, and every file on a desk
 * whose tool takes none, goes to the ticket dialog instead — where the
 * guide's own tool, when it takes the file, is the first row. What the veil
 * says before the release agrees with where the release goes, and what the
 * desk says while it carries files counts them.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DropLayer } from "@/components/intent/drop-layer";
import { GuideDesk } from "@/components/intent/guide-desk";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HandoffStore,
  MemoryHandoffBackend,
} from "@/lib/handoff";
import type { HandoffRecord } from "@/lib/handoff";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { takeCarriedHandoff } from "@/lib/handoff/carry";
import { readOrigin } from "@/lib/handoff/origin";
import { guides } from "@/lib/guides";
import {
  activePageTarget,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import { getToolBySlug } from "@/lib/tools";
import GuidePage from "./[slug]/page";

const push = vi.fn<(href: string) => void>();
const ROUTER = {
  push,
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
});
beforeEach(() => {
  push.mockReset();
  window.sessionStorage.clear();
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  __setHandoffStoreForTests(null);
  resetPageTargetsForTests();
});

async function page(slug: string): Promise<Document> {
  const html = renderToStaticMarkup(
    await GuidePage({ params: Promise.resolve({ slug }) }),
  );
  return new DOMParser().parseFromString(html, "text/html");
}

async function pdfFile(name: string): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return new File([(await doc.save()) as BlobPart], name, {
    type: "application/pdf",
  });
}

/** A drag as Chromium describes it: "Files" among its types, each item's kind and type. */
function described(files: File[]) {
  return {
    types: ["Files"],
    files,
    items: files.map((f) => ({ kind: "file", type: f.type })),
    dropEffect: "none",
  };
}

function dropOn(el: Element, files: File[]) {
  const dataTransfer = described(files);
  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer });
    act(() => {
      el.dispatchEvent(event);
    });
  }
}

describe("every guide's desk, as the page serves it", () => {
  const primaries = guides.map((g) => ({
    slug: g.slug,
    tool: getToolBySlug(g.tools[0]!)!,
  }));

  it("health check: every guide has a primary tool, and both kinds are present", () => {
    expect(primaries.length).toBeGreaterThanOrEqual(20);
    const none = primaries.filter(
      ({ tool }) => !handoffCapabilityFor(tool.slug).supported,
    );
    // Six on 2026-10-10 (addendum WP-07 #8); both sides must be exercised.
    expect(none.length).toBeGreaterThanOrEqual(1);
    expect(primaries.length - none.length).toBeGreaterThanOrEqual(10);
  });

  it("sits between the introduction and the first Open button, and promises only what the runner does", async () => {
    for (const { slug, tool } of primaries) {
      const doc = await page(slug);
      const desk = doc.querySelector("[data-guide-desk]");
      expect(desk, `${slug}: no desk`).not.toBeNull();
      const words = desk!.textContent ?? "";
      if (handoffCapabilityFor(tool.slug).supported) {
        expect(words, slug).toContain(`to open ${tool.name} with`);
      } else {
        expect(words, slug).toContain("to see which tools open it");
        expect(words, slug).not.toContain(`open ${tool.name}`);
      }
      // Order: the last intro paragraph, the desk, then "Open <tool>".
      const open = [...doc.querySelectorAll("a")].find(
        (a) => a.textContent?.trim() === `Open ${tool.name}`,
      );
      expect(open, `${slug}: the first Open button`).toBeTruthy();
      expect(
        desk!.compareDocumentPosition(open!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${slug}: the desk comes before the first Open button`,
      ).toBeTruthy();
      expect(
        doc.querySelector("#steps")!.compareDocumentPosition(desk!) &
          Node.DOCUMENT_POSITION_PRECEDING,
        `${slug}: the desk comes before the steps`,
      ).toBeTruthy();
      // Its picker is in the server HTML, inside <main>'s content.
      expect(desk!.querySelector('input[type="file"]'), slug).not.toBeNull();
    }
  });
});

describe("the desk", () => {
  async function mount(props: Parameters<typeof GuideDesk>[0]) {
    const view = render(
      <AppRouterContext.Provider value={ROUTER}>
        <main>
          <h1>A guide</h1>
          <GuideDesk {...props} />
        </main>
        <DropLayer />
      </AppRouterContext.Provider>,
    );
    // The desk is the page's target once the registry (fetched on mount,
    // not with the page) has it.
    await waitFor(() => expect(activePageTarget()).not.toBeNull());
    return view;
  }
  const merge = {
    tool: { slug: "merge-pdf", name: "Merge PDF" },
    opens: "many" as const,
    noun: { one: "a PDF", many: "PDFs" },
    accept: ".pdf,application/pdf",
    hint: "Accepts PDF",
  };

  it("carries the files it is given to its tool, from a guide", async () => {
    const { container } = await mount(merge);
    expect(container.textContent).toContain(
      "Drop your PDFs to open Merge PDF with them, or browse",
    );
    const files = [await pdfFile("a.pdf"), await pdfFile("b.pdf")];
    // Anywhere on the page: the desk is the page's target.
    dropOn(container.querySelector("main")!, files);
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    const href = new URL(push.mock.calls[0]![0], "https://example.test");
    expect(href.pathname).toBe("/tools/merge-pdf");
    // INVERTED 2026-10-20: the address no longer carries the token (its
    // payload fetch sent it to the server's logs); the tab does.
    expect(href.search).toBe("");
    const id = takeCarriedHandoff(href.pathname)!;
    const claimed = await claimHandoff(id);
    expect(claimed?.toolSlug).toBe("merge-pdf");
    expect(claimed?.files.map((e) => e.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(readOrigin(claimed?.origin)).toEqual({
      kind: "drop",
      surface: "guide",
    });
  });

  it("a file its tool does not take goes to the ticket dialog, not to the tool", async () => {
    const { container } = await mount(merge);
    dropOn(container.querySelector("main")!, [
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
        type: "image/jpeg",
      }),
    ]);
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(dialog.textContent).toContain("Merge PDF can't open it.");
    expect(push).not.toHaveBeenCalled();
  });

  it("a tool with no in-browser runner: the desk never launches it, it shows what opens the file", async () => {
    const { container } = await mount({
      tool: { slug: "pdf-to-word", name: "PDF to Word" },
      opens: null,
      noun: { one: "a PDF", many: "PDFs" },
      accept: ".pdf,application/pdf",
      hint: "Accepts PDF",
    });
    expect(container.textContent).toContain(
      "Drop a PDF to see which tools open it, or browse",
    );
    dropOn(container.querySelector("main")!, [await pdfFile("report.pdf")]);
    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 5000,
    });
    expect(push).not.toHaveBeenCalled();
    // WAS: PDF to Word ranked like any other tool — about 26th of 42, under
    // "More", below Compress, Sign and Edit (WP-07 review). The tool the
    // guide teaches is the first row, and says the file is added there.
    const rows = await within(dialog).findAllByRole(
      "link",
      { name: /^Open / },
      { timeout: 10_000 },
    );
    const first = dialog.querySelector("[data-suggestion]")!;
    expect(first.getAttribute("data-suggestion")).toBe("pdf-to-word");
    expect(first).toBe(rows[0]);
    expect(first.getAttribute("aria-label")).toBe(
      "Open PDF to Word — you'll add report.pdf there",
    );
  });

  /**
   * WAS `takes: () => true` on every desk (WP-07 review, reproduced on the
   * served build): a JPG held over the Merge PDF guide was routed to the
   * desk, the veil said "Release to open in Merge PDF" — and the release
   * opened the dialog saying "Merge PDF can't open it." Two sentences
   * contradicting each other within one gesture, on 16 guides.
   */
  it("the veil says what the release does: a file the tool cannot open is said to be one (control: a PDF is said to open)", async () => {
    const { container } = await mount(merge);
    const main = container.querySelector("main")!;
    const veil = () =>
      document.querySelector("[data-drop-veil][data-open]")?.textContent ?? "";
    const hold = (files: File[]) => {
      const event = new Event("dragenter", { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: described(files) });
      act(() => {
        main.dispatchEvent(event);
      });
    };
    const leave = (files: File[]) => {
      const event = new Event("dragleave", { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: described(files) });
      act(() => {
        main.dispatchEvent(event);
      });
    };
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
      type: "image/jpeg",
    });
    hold([photo]);
    await waitFor(() => expect(veil()).toContain("Merge PDF can't open"), {
      timeout: 5000,
    });
    expect(veil()).not.toContain("Release to open in Merge PDF");
    leave([photo]);
    // Control: the same gesture with a PDF.
    const doc = await pdfFile("a.pdf");
    hold([doc]);
    await waitFor(
      () => expect(veil()).toContain("Release to open in Merge PDF"),
      { timeout: 5000 },
    );
    leave([doc]);
  });

  /**
   * WAS "Opening Merge PDF with your file…" whatever arrived — and the
   * screen-reader pass recorded the singular, for two PDFs, as what a
   * reader "must hear" (WP-07 review).
   */
  it("what it says while carrying files counts them", async () => {
    // The carrying held open, so what is said meanwhile can be read.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Slow extends MemoryHandoffBackend {
      override async put(record: HandoffRecord): Promise<void> {
        await gate;
        return super.put(record);
      }
    }
    __setHandoffStoreForTests(new HandoffStore({ backend: new Slow() }));
    const { container } = await mount(merge);
    const status = container.querySelector('[data-slot="guide-desk-status"]')!;
    // Always there, empty, before anything arrives: a region that is
    // mounted holding its words is one several screen readers never read.
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
    dropOn(container.querySelector("main")!, [
      await pdfFile("a.pdf"),
      await pdfFile("b.pdf"),
    ]);
    await waitFor(
      () =>
        expect(status.textContent).toBe("Opening Merge PDF with your 2 files…"),
      { timeout: 5000 },
    );
    release();
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
  });

  it("a failure to carry them says so, counted, and links the tool", async () => {
    class Full extends MemoryHandoffBackend {
      override async put(_record: HandoffRecord): Promise<void> {
        throw new Error("QuotaExceededError");
      }
    }
    __setHandoffStoreForTests(new HandoffStore({ backend: new Full() }));
    const { container } = await mount(merge);
    dropOn(container.querySelector("main")!, [
      await pdfFile("a.pdf"),
      await pdfFile("b.pdf"),
    ]);
    const status = container.querySelector('[data-slot="guide-desk-status"]')!;
    await waitFor(
      () =>
        expect(status.textContent).toBe(
          "! Couldn't carry your 2 files here — open Merge PDF and add them there.",
        ),
      { timeout: 5000 },
    );
    expect(
      within(status as HTMLElement).getByRole("link", {
        name: "open Merge PDF",
      }),
    ).toHaveAttribute("href", "/tools/merge-pdf");
    expect(push).not.toHaveBeenCalled();
  });
});
