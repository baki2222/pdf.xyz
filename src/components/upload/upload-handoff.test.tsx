// @vitest-environment jsdom
/**
 * The homepage drop zone must carry the visitor's files to the tool they
 * pick.
 *
 * WHAT SHIPPED: `UploadZone` kept each staged file's name and size and
 * dropped the `File`. Its button was `<Link href="/workspace">`. A visitor
 * dropped a PDF, saw it listed, clicked the primary button, and arrived at
 * "No files staged yet", having to find and pick the file again. Nothing
 * failed, because nothing asked where the bytes went.
 *
 * THE PROPERTY, asked at the point of consumption: after a visitor stages a
 * file and picks a tool, the tool page is opened with a `?handoff=` id, and
 * claiming that id from the browser-local store gives back THAT file, byte
 * for byte. The store is the real `HandoffStore` over a memory backend, and
 * the router is the real App Router context carrying a spy, so nothing on
 * the path between the click and the claim is stubbed.
 *
 * A NEGATIVE CONTROL runs the same flow over the old component's shape (a
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  handoffCapabilityFor,
  handoffEntriesToFiles,
  HandoffStore,
  MemoryHandoffBackend,
  readHandoffId,
} from "@/lib/handoff";
import { getToolBySlug } from "@/lib/tools";
import { UploadZone } from "./upload-zone";
import { STAGED_TOOL_CHOICES } from "./staged-file-actions";

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
    </AppRouterContext.Provider>
  );
}

const pdf = (name: string, body = `%PDF-1.7 ${name}`) =>
  new File([body], name, { type: "application/pdf" });

function stage(container: HTMLElement, files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
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

/** The hand-off the last navigation carried, or null. */
const lastHandoff = () => handoffIn(push.mock.calls.at(-1)?.[0]);

async function bytes(file: Blob): Promise<string> {
  return new TextDecoder().decode(await file.arrayBuffer());
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
});

describe("the drop zone hands the staged files to the tool", () => {
  it("one PDF: every offered tool can receive it, and a click delivers that file", async () => {
    const file = pdf("report.pdf");
    const { container } = render(withRouter(<UploadZone />));
    stage(container, [file]);

    const list = await screen.findByRole("list", {
      name: /Continue with your file/,
    });
    const offered = within(list).getAllByRole("button");
    // Health check: a zone that offered nothing would pass every loop below.
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(STAGED_TOOL_CHOICES);

    const first = offered[0]!;
    await act(async () => {
      fireEvent.click(first);
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    const handoff = lastHandoff();
    expect(handoff, `navigated to ${push.mock.calls[0]?.[0]}`).not.toBeNull();
    // The offered name is the tool the navigation opened.
    expect(first.textContent).toContain(getToolBySlug(handoff!.slug)?.name);
    expect(handoffCapabilityFor(handoff!.slug).supported).toBe(true);

    const record = await claimHandoff(handoff!.id);
    expect(record?.toolSlug).toBe(handoff!.slug);
    const delivered = handoffEntriesToFiles(record?.files ?? []);
    expect(delivered.map((f) => f.name)).toEqual(["report.pdf"]);
    expect(await bytes(delivered[0]!)).toBe(await bytes(file));
  });

  it("two PDFs: Merge PDF is offered and receives both, in order", async () => {
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    const { container } = render(withRouter(<UploadZone />));
    stage(container, [a, b]);

    const merge = await screen.findByRole("button", {
      name: new RegExp(getToolBySlug("merge-pdf")!.name),
    });
    await act(async () => {
      fireEvent.click(merge);
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const handoff = lastHandoff();
    expect(handoff?.slug).toBe("merge-pdf");
    const record = await claimHandoff(handoff!.id);
    const delivered = handoffEntriesToFiles(record?.files ?? []);
    expect(delivered.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("a Word file: nothing claims to carry it, and the link says so", async () => {
    const doc = new File(["docx"], "letter.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const { container } = render(withRouter(<UploadZone />));
    stage(container, [doc]);

    const open = await screen.findByRole("link", {
      name: `Open ${getToolBySlug("word-to-pdf")!.name}`,
    });
    expect(open.getAttribute("href")).toBe("/tools/word-to-pdf");
    expect(
      screen.getByText(/open without your file, so you choose it again there/),
    ).toBeTruthy();
    // No hand-off button is offered for a file no runner can open.
    expect(screen.queryByText(/Continue with your file/)).toBeNull();
  });

  it("the negative control: the old zone's only action drops the file", async () => {
    // The shape that shipped: a zone whose action is a plain link. Run
    // through the same predicate, it must find no hand-off.
    const { container } = render(
      withRouter(
        <UploadZone ctaHref="/workspace" ctaLabel="Open in workspace" />,
      ),
    );
    stage(container, [pdf("report.pdf")]);
    const link = screen.getByRole("link", { name: "Open in workspace" });
    expect(handoffIn(link.getAttribute("href") ?? undefined)).toBeNull();
    expect(screen.queryByText(/Continue with your file/)).toBeNull();
  });
});

describe("Start for free lands on the control that starts", () => {
  it("a hashchange to the zone's id focuses its file input", () => {
    const { container } = render(withRouter(<UploadZone id="upload" />));
    const input = container.querySelector('input[type="file"]');
    expect(document.activeElement).not.toBe(input);
    window.location.hash = "#upload";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(document.activeElement).toBe(input);
    window.location.hash = "";
  });
});
