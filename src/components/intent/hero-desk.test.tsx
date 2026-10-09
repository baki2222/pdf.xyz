// @vitest-environment jsdom
/**
 * The home desk must carry the visitor's files to the tool they pick.
 *
 * WHAT SHIPPED, ONCE: the home drop zone kept each staged file's name and
 * size and dropped the `File`; its button was `<Link href="/workspace">`. A
 * visitor dropped a PDF, clicked, and arrived at "No files staged yet". The
 * zone was fixed (WP-04, `upload-zone.tsx` + `staged-file-actions.tsx`), and
 * this file was that fix's guard; the desk replaced both components (WP-05,
 * 2026-10-10) and the guard moved here with the property unchanged.
 *
 * THE PROPERTY, asked at the point of consumption: after files are staged on
 * the desk and a suggestion is chosen, the tool page is opened with a
 * `?handoff=` id, and claiming that id from the browser-local store gives
 * back THOSE files, byte for byte, in order. The store is the real
 * `HandoffStore` over a memory backend, the router is the real App Router
 * context carrying a spy, the files are real PDFs measured by the real probe,
 * and the ticket is the real lazy view — nothing on the path between the
 * click and the claim is stubbed.
 *
 * A NEGATIVE CONTROL runs the same predicate over the shape that shipped (a
 * zone whose only action is a link to /workspace) and must report "no
 * hand-off", so the predicate is known to be able to fail.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { acceptAttribute } from "@/components/upload/accepted-kinds";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  handoffEntriesToFiles,
  HandoffStore,
  MemoryHandoffBackend,
  readHandoffId,
} from "@/lib/handoff";
import { readOrigin } from "@/lib/handoff/origin";
import { getToolBySlug } from "@/lib/tools";
import { HeroDesk } from "./hero-desk";

const push = vi.fn<(href: string) => void>();
const ROUTER = {
  push,
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

function withRouter(children: ReactNode) {
  return (
    <AppRouterContext.Provider value={ROUTER}>
      {children}
      <LiveRegion />
    </AppRouterContext.Provider>
  );
}

function Desk() {
  return (
    <HeroDesk
      id="upload"
      accept={acceptAttribute()}
      acceptHint="PDF up to 100 MB"
      tasks={<p>tasks</p>}
    />
  );
}

/** A real PDF of `pages` pages, so the probe has something to count. */
async function pdf(name: string, pages = 1): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++)
    doc
      .addPage([200, 200])
      .drawText(`${name} ${i + 1}`, { x: 20, y: 100, size: 12, font });
  return new File([(await doc.save()) as BlobPart], name, {
    type: "application/pdf",
  });
}

function stage(container: HTMLElement, files: File[]) {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="file"]:not([hidden])',
  );
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files } });
}

/** The tool slug and hand-off id a destination carries, or null. */
function handoffIn(
  href: string | undefined,
): { slug: string; id: string } | null {
  if (!href) return null;
  const url = new URL(href, "https://example.test");
  const id = readHandoffId(url.search);
  const slug = /^\/tools\/([^/]+)$/.exec(url.pathname)?.[1];
  return id && slug ? { slug, id } : null;
}

const lastHandoff = () => handoffIn(push.mock.calls.at(-1)?.[0]);

async function bytes(file: Blob): Promise<string> {
  return Buffer.from(await file.arrayBuffer()).toString("base64");
}

/** The ticket's suggestions, once they have settled. */
async function suggestions() {
  const ticket = await screen.findByRole(
    "region",
    { name: "What you can do with these files" },
    { timeout: 5000 },
  );
  await waitFor(
    () =>
      expect(
        ticket.querySelectorAll('[data-slot="suggestions"] ol > li').length,
      ).toBe(3),
    { timeout: 5000 },
  );
  return ticket;
}

beforeEach(() => {
  push.mockReset();
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  // `isolate: false`: the store is a module singleton, and the next file in
  // this worker must get the real lazily-created one back.
  __setHandoffStoreForTests(null);
  resetAnnouncer();
});

describe("the desk hands the staged files to the tool", () => {
  it("two PDFs: the ticket counts them, and Merge PDF receives both, in order", async () => {
    const a = await pdf("a.pdf", 1);
    const b = await pdf("b.pdf", 2);
    const { container } = render(withRouter(<Desk />));
    stage(container, [a, b]);

    const ticket = await suggestions();
    expect(ticket.textContent).toMatch(/2 PDFs\s·\s3 pages/);
    const merge = within(ticket).getByRole("link", {
      name: `Open ${getToolBySlug("merge-pdf")!.name} with 2 files`,
    });
    expect(merge.getAttribute("href")).toBe("/tools/merge-pdf");

    await act(async () => {
      fireEvent.click(merge);
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const handoff = lastHandoff();
    expect(handoff?.slug).toBe("merge-pdf");
    const record = await claimHandoff(handoff!.id);
    const delivered = handoffEntriesToFiles(record?.files ?? []);
    expect(delivered.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(await bytes(delivered[1]!)).toBe(await bytes(b));
    // …and the record says the files were dropped here, not in a workspace.
    expect(readOrigin(record?.origin)).toEqual({
      kind: "drop",
      surface: "home",
    });
  });

  it("every offered row is a real link to its tool, and a modifier-click is the browser's", async () => {
    const { container } = render(withRouter(<Desk />));
    stage(container, [await pdf("report.pdf", 1)]);
    const ticket = await suggestions();
    const links = [
      ...ticket.querySelectorAll<HTMLAnchorElement>("a[data-suggestion]"),
    ];
    // Health: rows were offered at all (the top three, and "More").
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links)
      expect(link.getAttribute("href")).toMatch(/^\/tools\/[a-z0-9-]+$/);
    // Ctrl-click: no hand-off, no navigation of ours — the browser opens the
    // plain page in a new tab.
    await act(async () => {
      fireEvent.click(links[0]!, { ctrlKey: true });
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("a Word file: its row says the file is added there, and opens the plain page", async () => {
    const doc = new File(["PK\u0003\u0004 docx"], "letter.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const { container } = render(withRouter(<Desk />));
    stage(container, [doc]);
    const ticket = await screen.findByRole(
      "region",
      { name: "What you can do with these files" },
      { timeout: 5000 },
    );
    const open = await within(ticket).findByRole(
      "link",
      {
        name: `Open ${getToolBySlug("word-to-pdf")!.name} — you'll add the file there`,
      },
      { timeout: 5000 },
    );
    await act(async () => {
      fireEvent.click(open);
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // Plain: no file could travel to a tool that has no runner here.
    expect(push.mock.calls[0]![0]).toBe("/tools/word-to-pdf");
  });

  it("the negative control: the old zone's only action drops the file", async () => {
    // The shape that shipped: a zone whose action is a plain link. Run
    // through the same predicate, it must find no hand-off.
    function OldZone() {
      return (
        <div>
          <input type="file" aria-label="files" />
          <a href="/workspace">Open in workspace</a>
        </div>
      );
    }
    const { container } = render(withRouter(<OldZone />));
    stage(container, [await pdf("report.pdf")]);
    const link = screen.getByRole("link", { name: "Open in workspace" });
    expect(handoffIn(link.getAttribute("href") ?? undefined)).toBeNull();
    expect(
      screen.queryByRole("region", {
        name: "What you can do with these files",
      }),
    ).toBeNull();
  });
});

describe("the desk's other ways in and out", () => {
  it("a hashchange to the desk's id focuses its picker", () => {
    const { container } = render(withRouter(<Desk />));
    const input = container.querySelector('input[type="file"]:not([hidden])');
    expect(document.activeElement).not.toBe(input);
    window.location.hash = "#upload";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.activeElement).toBe(input);
    window.location.hash = "";
  });

  it("after a pick, focus moves to the ticket; Clear brings it back to Choose files", async () => {
    const { container } = render(withRouter(<Desk />));
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]:not([hidden])',
    )!;
    input.focus();
    stage(container, [await pdf("a.pdf")]);
    const ticket = await suggestions();
    expect(document.activeElement).toBe(ticket);
    // Under the ticket the empty desk is inert and hidden from assistive
    // technology, so a reader meets one desk, not two.
    const idle = input.closest("[inert]");
    expect(idle?.getAttribute("aria-hidden")).toBe("true");

    await act(async () => {
      fireEvent.click(within(ticket).getByRole("button", { name: /^clear/i }));
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        container.querySelector('input[type="file"]:not([hidden])'),
      ),
    );
    // The empty desk is live again (it waited under the ticket, inert).
    expect(container.querySelector("[inert]")).toBeNull();
    expect(
      screen.queryByRole("region", {
        name: "What you can do with these files",
      }),
    ).toBeNull();
  });

  it("a drop is received and announced, and focus stays where it was", async () => {
    const { container } = render(withRouter(<Desk />));
    const desk = container.querySelector("[data-desk]")!;
    const file = await pdf("dropped.pdf", 2);
    const dataTransfer = { files: [file], types: ["Files"], dropEffect: "" };
    fireEvent.dragEnter(desk, { dataTransfer });
    expect(container.querySelector("#upload")?.hasAttribute("data-armed")).toBe(
      true,
    );
    fireEvent.drop(desk, { dataTransfer });
    await suggestions();
    expect(document.activeElement).toBe(document.body);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(
        /^Checked 1 file\. 3 suggestions\. Best match: /,
      ),
    );
  });

  it("a drag that only carries text arms nothing", () => {
    const { container } = render(withRouter(<Desk />));
    const desk = container.querySelector("[data-desk]")!;
    fireEvent.dragEnter(desk, {
      dataTransfer: { files: [], types: ["text/plain"] },
    });
    expect(container.querySelector("#upload")?.hasAttribute("data-armed")).toBe(
      false,
    );
  });
});
