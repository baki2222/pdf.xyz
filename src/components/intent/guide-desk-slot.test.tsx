// @vitest-environment jsdom
/**
 * A guide's desk arrives after its page: the server draws the shell, and
 * `GuideDeskSlot` swaps the live desk in once its code is here. Nothing a
 * visitor did in between is lost — a file picked in the shell's native
 * picker goes to the live desk and on to the tool, and focus on the shell's
 * picker lands on the live one — and once it is here the live desk is the
 * page's drop target, in the shell's place.
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropLayer } from "@/components/intent/drop-layer";
import {
  __setHandoffStoreForTests,
  HandoffStore,
  MemoryHandoffBackend,
} from "@/lib/handoff";
import {
  activePageTarget,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import { GuideDeskShell } from "./guide-desk-shell";
import { GuideDeskSlot } from "./guide-desk-slot";

const push = vi.fn<(href: string) => void>();
const ROUTER = {
  push,
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

const merge = {
  tool: { slug: "merge-pdf", name: "Merge PDF" },
  opens: "many" as const,
  noun: { one: "a PDF", many: "PDFs" },
  accept: ".pdf,application/pdf",
  hint: "Accepts PDF",
};

beforeEach(() => {
  push.mockReset();
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  __setHandoffStoreForTests(null);
  resetPageTargetsForTests();
});

async function pdfFile(name: string): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return new File([(await doc.save()) as BlobPart], name, {
    type: "application/pdf",
  });
}

const page = () => (
  <AppRouterContext.Provider value={ROUTER}>
    <main>
      <GuideDeskSlot desk={merge}>
        <GuideDeskShell {...merge} />
      </GuideDeskSlot>
    </main>
    <DropLayer />
  </AppRouterContext.Provider>
);

function mount() {
  return render(page());
}

/**
 * The page as served, with `beforeHydrate` run on its HTML before React
 * reaches it — a pick made then is a pick no code has seen.
 */
function hydrate(beforeHydrate: (html: HTMLElement) => void) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(page());
  document.body.append(container);
  beforeHydrate(container);
  return render(page(), { container, hydrate: true });
}

const live = (container: HTMLElement) =>
  container.querySelector("[data-guide-desk] [data-page-drop-target]");

// The first carry in a worker pays for loading the launch and the catalogue.
const SLOW = { timeout: 30_000 };

describe("a guide's desk, arriving over its shell", SLOW, () => {
  it("swaps the live desk in, which is then the page's drop target", async () => {
    const { container } = mount();
    // The shell first: a picker, and no target.
    expect(container.querySelector("[data-drop-sheet-shell]")).not.toBeNull();
    await waitFor(() => expect(live(container)).not.toBeNull(), {
      timeout: 5000,
    });
    expect(container.querySelector("[data-drop-sheet-shell]")).toBeNull();
    expect(container.querySelectorAll("[data-guide-desk]")).toHaveLength(1);
    await waitFor(() => expect(activePageTarget()?.name).toBe("Merge PDF"));
  });

  it("a file picked in the shell before the page hydrated is carried to the tool", async () => {
    const files = [await pdfFile("early-1.pdf"), await pdfFile("early-2.pdf")];
    hydrate((html) => {
      const shellInput = html.querySelector<HTMLInputElement>(
        '[data-drop-sheet-shell] input[type="file"]',
      )!;
      // As a browser leaves it after a pick made before any code ran.
      Object.defineProperty(shellInput, "files", {
        value: files,
        configurable: true,
      });
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), {
      timeout: 20_000,
    });
    expect(new URL(push.mock.calls[0]![0], "https://x.test").pathname).toBe(
      "/tools/merge-pdf",
    );
  });

  it("focus on the shell's picker is on the live desk's picker after the swap", async () => {
    const { container } = mount();
    const shellInput = container.querySelector<HTMLInputElement>(
      '[data-drop-sheet-shell] input[type="file"]',
    )!;
    act(() => shellInput.focus());
    expect(document.activeElement).toBe(shellInput);
    await waitFor(() => expect(live(container)).not.toBeNull(), {
      timeout: 5000,
    });
    const liveInput = live(container)!.querySelector<HTMLInputElement>(
      'input[type="file"]:not([hidden])',
    );
    expect(liveInput).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(liveInput));
  });

  it("a pick whose dialog closes after the swap still reaches the desk", async () => {
    const { container } = mount();
    const shellInput = container.querySelector<HTMLInputElement>(
      '[data-drop-sheet-shell] input[type="file"]',
    )!;
    await waitFor(() => expect(activePageTarget()?.name).toBe("Merge PDF"), {
      timeout: 5000,
    });
    // The shell is gone from the page; its input still fires.
    expect(shellInput.isConnected).toBe(false);
    const files = [await pdfFile("late.pdf")];
    Object.defineProperty(shellInput, "files", {
      value: files,
      configurable: true,
    });
    fireEvent.change(shellInput);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), {
      timeout: 20_000,
    });
  });
});
