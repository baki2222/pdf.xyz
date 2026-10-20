// @vitest-environment jsdom
/**
 * What a page says when files arrive from somewhere else — read where the
 * visitor reads it, after a real claim from a real (memory) store.
 *
 * THE DEFECTS this replaces, each kept as a control below:
 *  - every arrival said "Loaded N files from your workspace.", including the
 *    files dropped on the home page (addendum WP-04 #72);
 *  - an incompatible hand-off said "it isn't a PDF" on JPG to PDF, a tool
 *    that refuses PDFs (the noun was typed, not read from `accept`);
 *  - the claim knew nothing of the record's provenance, so no page could.
 *
 * Three e2e specs assert `/loaded .* from your workspace/i` for workspace
 * launches; that wording is kept for the workspace origin and only there.
 */
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setHandoffStoreForTests,
  eligibleFilesFor,
  HandoffStore,
  MemoryHandoffBackend,
  stashHandoff,
} from "@/lib/handoff";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import {
  claimArrival,
  useToolHandoff,
  type ToolHandoff,
} from "./use-tool-handoff";

const ROUTER = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as never;

const pdf = (name: string) =>
  new File([`%PDF ${name}`], name, { type: "application/pdf" });
const docx = new File(["docx"], "letter.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

beforeEach(() => {
  // `isolate: false`: a launch elsewhere in this worker may have left a
  // token carried in this tab, which a claim here would take.
  window.sessionStorage.clear();
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => {
  cleanup();
  __setHandoffStoreForTests(null);
  window.history.replaceState(null, "", "/");
});

const status = () => screen.getByRole("status").textContent ?? "";

describe("the loaded badge names where the files came from", () => {
  it("workspace: the wording three e2e specs assert, unchanged", () => {
    render(
      <HandoffLoadedBadge
        origin={{ kind: "workspace" }}
        count={2}
        skipped={0}
      />,
    );
    expect(status()).toContain("Loaded 2 files from your workspace.");
    expect(status()).toContain("Still in this browser; nothing was uploaded.");
  });

  it("a home-page drop says so, and never mentions a workspace it did not visit", () => {
    render(
      <HandoffLoadedBadge
        origin={{ kind: "drop", surface: "home" }}
        count={2}
        skipped={0}
      />,
    );
    // WAS "Loaded the 2 files you added." — a definite description, false
    // whenever the gate kept fewer files than were added (origin.test.ts).
    expect(status()).toContain("Loaded 2 files you added.");
    expect(status()).not.toMatch(/workspace/i);
  });

  it("a result names the tool that made it, read from the catalogue", () => {
    render(
      <HandoffLoadedBadge
        origin={{ kind: "result", fromSlug: "merge-pdf" }}
        count={1}
        skipped={0}
      />,
    );
    expect(status()).toContain("Loaded your result from Merge PDF.");
  });

  it("a remedy names the file and why it came", () => {
    render(
      <HandoffLoadedBadge
        origin={{
          kind: "remedy",
          fromSlug: "rotate-pdf",
          problem: "encrypted",
        }}
        count={1}
        skipped={0}
        fileName="report.pdf"
      />,
    );
    expect(status()).toContain(
      "Loaded report.pdf from Rotate PDF to unlock it first.",
    );
  });
});

describe("the problem notes say what happened, in the target tool's own terms", () => {
  const problem = (over: Partial<ToolHandoff>): ToolHandoff =>
    ({
      status: "incompatible",
      files: [],
      skipped: 1,
      claimed: 1,
      origin: { kind: "workspace" },
      trail: [],
      pending: null,
      accept: ["JPG", "JPEG", "PNG"],
      dismiss: () => {},
      ...over,
    }) as ToolHandoff;

  it("an incompatible file is named by what the tool DOES take", () => {
    render(<HandoffProblem handoff={problem({})} toolName="JPG to PDF" />);
    expect(status()).toContain("isn't a JPG or PNG image");
    expect(status()).toContain("JPG to PDF");
    // Control: the old typed noun, false on an image tool.
    expect(status()).not.toMatch(/isn't a PDF|none are PDFs/);
  });

  it("several incompatible files on a PDF tool", () => {
    render(
      <HandoffProblem
        handoff={problem({ skipped: 2, claimed: 2, accept: ["PDF"] })}
        toolName="Merge PDF"
      />,
    );
    expect(status()).toContain("none of them is a PDF");
  });

  it("an expired hand-off no longer claims it came from the workspace", () => {
    render(
      <HandoffProblem
        handoff={problem({ status: "expired", origin: null })}
        toolName="Merge PDF"
      />,
    );
    expect(status()).toMatch(/hand-off expired or was already used/i);
    expect(status()).not.toMatch(/workspace/i);
  });

  it("loading says nothing about where the files are coming from", () => {
    render(<HandoffLoading />);
    expect(status()).not.toMatch(/workspace/i);
  });
});

describe("claimArrival: one claim for every page that receives files", () => {
  it("no token → null, and the store is never touched", () => {
    window.history.replaceState(null, "", "/tools/merge-pdf");
    expect(claimArrival("merge-pdf", (e) => e, ROUTER)).toBeNull();
  });

  it("claims, filters, strips the token, and returns the record's provenance", async () => {
    const id = await stashHandoff("merge-pdf", [pdf("a.pdf"), pdf("b.pdf")], {
      origin: { kind: "drop", surface: "home" },
      trail: ["compress-pdf"],
    });
    window.history.replaceState(null, "", `/tools/merge-pdf?handoff=${id}`);
    const claimed = await claimArrival(
      "merge-pdf",
      (entries) => eligibleFilesFor("merge-pdf", entries),
      ROUTER,
    );
    expect(window.location.search).toBe("");
    expect(claimed).toMatchObject({
      status: "ready",
      claimed: 2,
      skipped: 0,
      origin: { kind: "drop", surface: "home" },
      trail: ["compress-pdf"],
      pending: null,
    });
    expect(claimed!.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("the workspace claims a record addressed to it, every file kept", async () => {
    const id = await stashHandoff("workspace", [pdf("a.pdf"), docx], {
      origin: { kind: "drop", surface: "home" },
    });
    window.history.replaceState(null, "", `/workspace?handoff=${id}`);
    const claimed = await claimArrival("workspace", (e) => e, ROUTER);
    expect(claimed?.status).toBe("ready");
    expect(claimed!.files.map((f) => f.name)).toEqual(["a.pdf", "letter.docx"]);
  });

  it("a record addressed to another target reads as expired, and is consumed", async () => {
    const id = await stashHandoff("rotate-pdf", [pdf("a.pdf")], {
      origin: { kind: "workspace" },
    });
    window.history.replaceState(null, "", `/workspace?handoff=${id}`);
    expect((await claimArrival("workspace", (e) => e, ROUTER))?.status).toBe(
      "expired",
    );
  });

  it("nothing the tool opens → incompatible, with the count skipped", async () => {
    const id = await stashHandoff("merge-pdf", [docx], {
      origin: { kind: "workspace" },
    });
    window.history.replaceState(null, "", `/tools/merge-pdf?handoff=${id}`);
    expect(
      await claimArrival(
        "merge-pdf",
        (entries) => eligibleFilesFor("merge-pdf", entries),
        ROUTER,
      ),
    ).toMatchObject({ status: "incompatible", skipped: 1, claimed: 1 });
  });
});

describe("useToolHandoff exposes the provenance to the runner", () => {
  it("origin, trail, pending and the tool's accept row", async () => {
    const id = await stashHandoff("rotate-pdf", [pdf("a.pdf")], {
      origin: { kind: "result", fromSlug: "merge-pdf" },
      trail: ["merge-pdf"],
      pending: { toolSlug: "sign-pdf", parkedId: null },
    });
    window.history.replaceState(null, "", `/tools/rotate-pdf?handoff=${id}`);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppRouterContext.Provider value={ROUTER}>
        {children}
      </AppRouterContext.Provider>
    );
    const { result } = renderHook(() => useToolHandoff("rotate-pdf"), {
      wrapper,
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.origin).toEqual({
      kind: "result",
      fromSlug: "merge-pdf",
    });
    expect(result.current.trail).toEqual(["merge-pdf"]);
    expect(result.current.pending).toEqual({
      toolSlug: "sign-pdf",
      parkedId: null,
    });
    expect(result.current.accept).toEqual(["PDF"]);
  });
});
