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
import { useLayoutEffect, type ReactNode } from "react";
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
import { ToolRunProvider, useToolRun } from "./tool-context";
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

  /*
   * CHANGED 2026-11-09 (perf/per-tool-first-load). WAS "a result names the
   * tool that made it, read from the catalogue": the badge looked the name
   * up in the tool directory, which put every tool's name in every tool
   * page's first load. It now names the tool as the hand-off RECORD carried
   * it — reported to the page's job by the claim (`ToolRun.names`) — so the
   * badge is rendered here inside a job that arrived with those names, and
   * the control below holds that the name is the record's, not a lookup.
   */
  it("a result names the tool that made it, as the record carried it", () => {
    render(
      <ArrivedWith names={{ "merge-pdf": "Merge PDF" }}>
        <HandoffLoadedBadge
          origin={{ kind: "result", fromSlug: "merge-pdf" }}
          count={1}
          skipped={0}
        />
      </ArrivedWith>,
    );
    expect(status()).toContain("Loaded your result from Merge PDF.");
  });

  it("positive control: the name is the record's, never looked up", () => {
    render(
      <ArrivedWith names={{ "merge-pdf": "Combine Files" }}>
        <HandoffLoadedBadge
          origin={{ kind: "result", fromSlug: "merge-pdf" }}
          count={1}
          skipped={0}
        />
      </ArrivedWith>,
    );
    expect(status()).toContain("Loaded your result from Combine Files.");
    cleanup();
    // No name carried: the phrase's own fallback, as for an unknown slug.
    render(
      <ArrivedWith names={{}}>
        <HandoffLoadedBadge
          origin={{ kind: "result", fromSlug: "merge-pdf" }}
          count={1}
          skipped={0}
        />
      </ArrivedWith>,
    );
    expect(status()).toContain("Loaded your result from the previous tool.");
  });

  it("a remedy names the file and why it came", () => {
    render(
      <ArrivedWith names={{ "rotate-pdf": "Rotate PDF" }}>
        <HandoffLoadedBadge
          origin={{
            kind: "remedy",
            fromSlug: "rotate-pdf",
            problem: "encrypted",
          }}
          count={1}
          skipped={0}
          fileName="report.pdf"
        />
      </ArrivedWith>,
    );
    expect(status()).toContain(
      "Loaded report.pdf from Rotate PDF to unlock it first.",
    );
  });
});

/** A tool page's job that a hand-off carrying `names` arrived in. */
function ArrivedWith({
  names,
  children,
}: {
  names: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <ToolRunProvider
      tool={{
        slug: "compress-pdf",
        name: "Compress PDF",
        category: "optimize",
      }}
      plan={{ targets: [] }}
    >
      <Arrive names={names} />
      {children}
    </ToolRunProvider>
  );
}

function Arrive({ names }: { names: Record<string, string> }) {
  const arrived = useToolRun()?.arrived;
  useLayoutEffect(() => {
    arrived?.([], null, names);
  }, [arrived, names]);
  return null;
}

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

  /*
   * Record version 2 (2026-11-09): the names the receiving page shows come
   * in the record, written by the launch; a version-1 record (stashed
   * before that deploy, claimed after it) has none, and the claim fetches
   * the directory for it, so it reads as it did before.
   */
  it("returns the names a version-2 record carried, as carried", async () => {
    const id = await stashHandoff("compress-pdf", [pdf("a.pdf")], {
      origin: { kind: "result", fromSlug: "merge-pdf" },
      trail: ["merge-pdf"],
      // Not the catalogue's spelling, so a lookup would show.
      names: { "merge-pdf": "Combine Files" },
    });
    window.history.replaceState(null, "", `/tools/compress-pdf?handoff=${id}`);
    const claimed = await claimArrival("compress-pdf", (e) => e, ROUTER);
    expect(claimed?.names).toEqual({ "merge-pdf": "Combine Files" });
  });

  it("a version-1 record, with no names, gets the directory's", async () => {
    const backend = new MemoryHandoffBackend();
    __setHandoffStoreForTests(new HandoffStore({ backend }));
    const now = Date.now();
    await backend.put({
      id: "h_0123456789abcdefv1",
      toolSlug: "compress-pdf",
      createdAt: now,
      expiresAt: now + 60_000,
      files: [
        { name: "a.pdf", size: 4, type: "application/pdf", blob: pdf("a.pdf") },
      ],
      origin: { kind: "result", fromSlug: "rotate-pdf" },
      trail: ["merge-pdf", "rotate-pdf"],
    });
    window.history.replaceState(
      null,
      "",
      "/tools/compress-pdf?handoff=h_0123456789abcdefv1",
    );
    const claimed = await claimArrival("compress-pdf", (e) => e, ROUTER);
    expect(claimed?.status).toBe("ready");
    expect(claimed?.names).toEqual({
      "merge-pdf": "Merge PDF",
      "rotate-pdf": "Rotate PDF",
    });
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
