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
import { resetPageTargetsForTests } from "@/lib/intent/page-target";
import { MAX_TICKET_FILES } from "@/lib/intent/ticket";
import { getToolBySlug } from "@/lib/tools";
import type { Evidence } from "@/lib/intent/evidence";
import { DropLayer } from "./drop-layer";
import { HeroDesk } from "./hero-desk";
import { arrangeLine } from "./ticket-view";
import { TICKET_PROBES, TICKET_SETTLE_MS } from "./use-ticket";

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
  resetPageTargetsForTests();
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
        name: `Open ${getToolBySlug("word-to-pdf")!.name} — you'll add letter.docx there`,
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
    // The empty desk is live again (it waited under the ticket, inert). The
    // only inert layer left is the empty frame that holds the ticket's
    // height, which is never live.
    expect(input.closest("[inert]")).toBeNull();
    expect(
      [...container.querySelectorAll("[inert]")].map((el) =>
        el.hasAttribute("data-desk-ghost"),
      ),
    ).toEqual([true]);
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

  /**
   * "or drop them anywhere on this page" is true only while the desk is its
   * page's drop target. WAS held by no test where it is used: every drop in
   * the suite landed ON the desk, and deleting the prop that made it so
   * (`catchPageDrops`) left 268 tests green (WP-05 review). Now the drop
   * lands on the page outside the desk, and the sentence is rendered from
   * the same value.
   *
   * WP-07 (2026-10-10): the page's drops are no longer the desk's own window
   * listeners but the site's drop layer, which routes them to the page's
   * registered target — so the chain is composed here as it is in the
   * layout: the layer, the registry, the desk. Without the layer (the
   * desk alone) the drag over the page is not accepted, which is what the
   * first assertion below would then report.
   */
  it("a file dropped anywhere on the page lands on the desk — the sentence that says so, from the same value", async () => {
    const { container } = render(
      withRouter(
        <>
          <Desk />
          <DropLayer />
        </>,
      ),
    );
    const outside = document.createElement("h1");
    outside.textContent = "Every PDF tool.";
    document.body.append(outside);
    try {
      expect(container.contains(outside)).toBe(false);
      const file = await pdf("far.pdf", 1);
      const dataTransfer = { files: [file], types: ["Files"], dropEffect: "" };
      fireEvent.dragEnter(outside, { dataTransfer });
      // A drop the page did not accept is opened by the browser, in the tab.
      const refused = fireEvent.dragOver(outside, { dataTransfer });
      expect(refused, "the page did not accept the drag over it").toBe(false);
      // Armed once the layer has the registry (fetched with the first drag).
      await waitFor(() =>
        expect(
          container.querySelector("#upload")?.hasAttribute("data-armed"),
        ).toBe(true),
      );
      fireEvent.drop(outside, { dataTransfer });
      const ticket = await screen.findByRole(
        "region",
        { name: "What you can do with these files" },
        { timeout: 5000 },
      );
      expect(within(ticket).getByText("far.pdf")).toBeTruthy();
      // …and the desk says it, because it is so.
      await act(async () => {
        fireEvent.click(
          within(ticket).getByRole("button", { name: /^clear/i }),
        );
      });
      expect(
        screen.getByText("or drop them anywhere on this page"),
      ).toBeTruthy();
    } finally {
      outside.remove();
    }
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

/**
 * What the ticket says it checked, counted from the facts.
 *
 * WAS `entries.length + overflow.length`: with 22 one-page PDFs the live
 * region said "Checked 22 files" while the ticket had probed 5 and never read
 * the 2 past its limit, and the screen beside it said "+19 more — 2 not
 * checked here", which counted only those 2 (WP-05 review, on the served
 * build). Both numbers now come from the files' facts.
 */
describe("the ticket's counts are the facts'", () => {
  /**
   * The settle timer offers what is known after {@link TICKET_SETTLE_MS};
   * here it is held back, so the ticket settles when every file is measured
   * and the facts it counts are final — the count is then a number the test
   * can know, not a race with a 1.5 s timer on a loaded machine.
   */
  function holdSettle() {
    const real = globalThis.setTimeout;
    return vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) =>
        real(
          fn,
          ms === TICKET_SETTLE_MS ? 600_000 : ms,
          ...args,
        )) as unknown as typeof setTimeout);
  }

  it(`${MAX_TICKET_FILES + 2} PDFs: "Checked ${TICKET_PROBES} of ${MAX_TICKET_FILES + 2}", and the hidden ones not checked are counted`, async () => {
    const held = holdSettle();
    try {
      const total = MAX_TICKET_FILES + 2;
      const files = await Promise.all(
        Array.from({ length: total }, (_, i) => pdf(`f${i + 1}.pdf`, 1)),
      );
      const { container } = render(withRouter(<Desk />));
      stage(container, files);
      const ticket = await suggestions();
      // The first TICKET_PROBES PDFs are probed; every other PDF says "not
      // checked"; the 2 past the ticket's limit are never read.
      await waitFor(
        () =>
          expect(screen.getByRole("status").textContent).toBe(
            `Checked ${TICKET_PROBES} of ${total} files. 2 suggestions. Best match: ${getToolBySlug("merge-pdf")!.name}.`,
          ),
        { timeout: 10_000 },
      );
      // Under "+N more": the files after the first three, of which every one
      // past the probes, and every one past the limit, was not checked.
      const hidden = total - 3;
      const unchecked =
        MAX_TICKET_FILES - TICKET_PROBES + (total - MAX_TICKET_FILES);
      expect(ticket.textContent).toContain(
        `+${hidden} more — ${unchecked} not checked here`,
      );
      // And the line about all of them counts all of them.
      expect(ticket.textContent).toContain(`${total} PDFs`);
    } finally {
      held.mockRestore();
    }
  }, 20_000);

  it("positive control: one PDF, checked, is said as checked", async () => {
    const held = holdSettle();
    try {
      const { container } = render(withRouter(<Desk />));
      stage(container, [await pdf("one.pdf", 2)]);
      await suggestions();
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toMatch(
          /^Checked 1 file\. 3 suggestions\. Best match: /,
        ),
      );
    } finally {
      held.mockRestore();
    }
  });
});

/**
 * What a row SHOWS first: the words that limit what its click carries, so a
 * row cut short still says it. (Whether it is cut is the browser's to say —
 * `e2e/home-desk.mobile.spec.ts` reads it at 390px.)
 */
describe("each row leads with what the click carries", () => {
  it("a Word file and two PDFs: Merge PDF says it opens 2 of the 3, before the counts", async () => {
    const doc = new File(["PK\u0003\u0004 docx"], "report.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const { container } = render(withRouter(<Desk />));
    stage(container, [
      doc,
      await pdf("contract.pdf", 3),
      await pdf("annex.pdf", 1),
    ]);
    const ticket = await suggestions();
    const rows = [
      ...ticket.querySelectorAll<HTMLAnchorElement>(
        '[data-slot="suggestions"] a[data-suggestion]',
      ),
    ];
    expect(rows[0]?.dataset.suggestion).toBe("merge-pdf");
    const lead = rows[0]!.querySelector("[data-lead]");
    expect(lead?.textContent).toBe("opens 2 of your 3 files");
    // The line begins with it; the counts come after.
    expect(lead?.parentElement?.textContent).toMatch(
      /^opens 2 of your 3 files\u00a0· 2 PDFs/,
    );
  });

  it("two PDFs: a one-file tool's row names the file it takes before anything else", async () => {
    const { container } = render(withRouter(<Desk />));
    stage(container, [await pdf("contract.pdf", 3), await pdf("annex.pdf", 1)]);
    const ticket = await suggestions();
    const oneFile = [
      ...ticket.querySelectorAll<HTMLAnchorElement>("a[data-suggestion]"),
    ].filter((a) =>
      /^Open .+ with contract\.pdf$/.test(a.getAttribute("aria-label") ?? ""),
    );
    // Health: a one-file tool was offered for two PDFs at all.
    expect(oneFile.length).toBeGreaterThanOrEqual(1);
    for (const row of oneFile)
      expect(row.querySelector("[data-lead]")?.textContent).toBe(
        "takes one file — contract.pdf",
      );
  });

  /** A staged Word file (the desk reads its format from the name and type). */
  const docx = (name: string) =>
    new File(["PK\u0003\u0004 docx"], name, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  /** A tool's row in the ticket, under "More" when it is not on top. */
  async function rowFor(ticket: HTMLElement, slug: string) {
    const find = () =>
      ticket.querySelector<HTMLAnchorElement>(`a[data-suggestion="${slug}"]`);
    if (!find()) {
      const more = within(ticket).getByRole("button", { name: /^More/ });
      await act(async () => {
        fireEvent.click(more);
      });
    }
    await waitFor(() => expect(find()).not.toBeNull());
    return find()!;
  }

  // The composed chain, staged files to the words drawn and the name read:
  // a Word file and two PDFs (the review's drop, 2026-10-10), where Word to
  // PDF carries nothing and opens one of the three.
  it("a Word file and two PDFs: Word to PDF says which file you'll add there — drawn and in its name", async () => {
    const { container } = render(withRouter(<Desk />));
    stage(container, [
      docx("report.docx"),
      await pdf("contract.pdf", 3),
      await pdf("annex.pdf", 1),
    ]);
    const row = await rowFor(await suggestions(), "word-to-pdf");
    expect(row.querySelector("[data-lead]")?.textContent).toBe(
      "you'll add report.docx there",
    );
    expect(row.getAttribute("aria-label")).toBe(
      `Open ${getToolBySlug("word-to-pdf")!.name} — you'll add report.docx there`,
    );
  });

  it("positive control: two Word files and a PDF — no one name to give, so the row counts which", async () => {
    const { container } = render(withRouter(<Desk />));
    stage(container, [
      docx("report.docx"),
      docx("memo.docx"),
      await pdf("contract.pdf", 3),
    ]);
    const row = await rowFor(await suggestions(), "word-to-pdf");
    expect(row.querySelector("[data-lead]")?.textContent).toBe(
      "you'll add the 2 DOCX files there",
    );
    expect(row.getAttribute("aria-label")).toBe(
      `Open ${getToolBySlug("word-to-pdf")!.name} — you'll add the 2 DOCX files there`,
    );
  });
});

describe("arrangeLine: the one fact that leads, and the order of the rest", () => {
  const line = (evidence: Evidence[], omit?: Evidence) => {
    const { lead, rest } = arrangeLine(evidence, omit);
    return [...lead.map((t) => `[${t}]`), ...rest].join(" | ");
  };

  it("the most limiting qualifier leads, and says which file; counts come last", () => {
    // Word to PDF in a Word + 2 PDF drop: it carries nothing, and opens 1.
    //
    // INVERTED 2026-10-10. This pinned
    //   "[you'll add the file there] | opens 1 of your 3 files | uploads
    //    only when you start it | 1 DOCX file"
    // — true, and the lead never cut, but "the file" never said WHICH: the
    // fact that did ("1 DOCX file") came last, the first words cut at every
    // width measured (390px: "you'll add the file there · opens 1 of y…"),
    // and the link's name reused the phrase. The rule arrangeLine already
    // keeps for "takes only that file" — a qualifier that leans on a
    // referent has it in front, or names the file itself — now holds here:
    // the qualifier names the file.
    expect(
      line([
        { kind: "count", count: 1, noun: "file", format: "DOCX" },
        { kind: "partial", opens: 1, total: 3 },
        {
          kind: "add-there",
          count: 1,
          name: "report.docx",
          noun: "file",
          format: "DOCX",
          all: false,
        },
        { kind: "uploads" },
      ]),
    ).toBe(
      "[you'll add report.docx there] | opens 1 of your 3 files | uploads only when you start it | 1 DOCX file",
    );
    // Positive control: SEVERAL files, only some of them meant — no name to
    // give, so the count and kind say which.
    expect(
      line([
        { kind: "count", count: 2, noun: "file", format: "DOCX" },
        { kind: "partial", opens: 2, total: 3 },
        {
          kind: "add-there",
          count: 2,
          name: null,
          noun: "file",
          format: "DOCX",
          all: false,
        },
      ]),
    ).toBe(
      "[you'll add the 2 DOCX files there] | opens 2 of your 3 files | 2 DOCX files",
    );
    // "the files" only when every staged file is meant.
    expect(
      line([
        {
          kind: "add-there",
          count: 2,
          name: null,
          noun: "pdf",
          format: "PDF",
          all: true,
        },
        { kind: "count", count: 2, noun: "pdf", format: "PDF" },
      ]),
    ).toBe("[you'll add the files there] | 2 PDFs");
    // A row waiting under More.
    expect(
      line([
        { kind: "count", count: 1, noun: "pdf", format: "PDF" },
        { kind: "after", tool: "Unlock PDF" },
      ]),
    ).toBe("[after Unlock PDF] | 1 PDF");
  });

  it("'takes only that file' follows the fact that names the file, which leads", () => {
    expect(
      line([
        { kind: "fields", name: "annex.pdf", count: 4 },
        { kind: "one-file", name: "annex.pdf", named: true },
        { kind: "partial", opens: 2, total: 3 },
      ]),
    ).toBe(
      "[annex.pdf has 4 form fields] | takes only that file | opens 2 of your 3 files",
    );
  });

  it("a fact said in full elsewhere is left out — and a qualifier that leaned on it names the file", () => {
    const lock: Evidence = {
      kind: "lock",
      name: "locked.pdf",
      lock: "password-required",
    };
    // WAS "[you'll add the file there] | …": the fact that named the file
    // was the one left out.
    expect(
      line(
        [
          lock,
          {
            kind: "add-there",
            count: 1,
            name: "locked.pdf",
            noun: "pdf",
            format: "PDF",
            all: true,
          },
          { kind: "uploads" },
        ],
        lock,
      ),
    ).toBe("[you'll add locked.pdf there] | uploads only when you start it");
    expect(
      line([lock, { kind: "one-file", name: "locked.pdf", named: true }], lock),
    ).toBe("[takes one file — locked.pdf]");
  });

  it("with no qualifier, the reason leads, then the counts", () => {
    expect(
      line([
        { kind: "no-text", name: null, from: 1, to: 2 },
        { kind: "count", count: 1, noun: "pdf", format: "PDF" },
      ]),
    ).toBe("[No selectable text on pages 1–2] | 1 PDF");
  });
});

/**
 * The note slot holds ONE thing at a fixed height — so what it has no room
 * for must still be somewhere a visitor can read it whole. (The pin's reason
 * in the slot is read in a browser — `e2e/home-desk.mobile.spec.ts` — where
 * pdf.js can be asked about a locked file; under jsdom its password
 * exception escapes as an unhandled rejection.)
 */
describe("the note slot, and where the rest goes", () => {
  it("two notes: the first in the slot, the second under More, whole", async () => {
    const heic = new File(
      [
        Uint8Array.from([
          0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
        ]),
      ],
      "photo.heic",
      { type: "image/heic" },
    );
    const stray = new File(["plain words"], "notes.xyz", { type: "" });
    const { container } = render(withRouter(<Desk />));
    stage(container, [
      await pdf("a.pdf", 1),
      await pdf("b.pdf", 1),
      heic,
      stray,
    ]);
    const ticket = await suggestions();
    const slot = ticket.querySelector('[data-slot="note"]')!;
    expect(slot.textContent).toMatch(/^No tool here opens HEIC photos\./);
    expect(slot.textContent).not.toContain("notes.xyz");

    await act(async () => {
      fireEvent.click(
        within(ticket).getByRole("button", { name: /^More for these files/ }),
      );
    });
    const rest = within(ticket).getByRole("list", {
      name: "More about your files",
    });
    expect(rest.textContent).toBe("No tool here opens notes.xyz.");
    // Whole: not clamped where it has room.
    expect(rest.querySelector(".line-clamp-2")).toBeNull();
  });
});
