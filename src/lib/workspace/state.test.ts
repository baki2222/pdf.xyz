import { describe, expect, it } from "vitest";
import { createWorkspaceFile } from "./classify";
import {
  emptyWorkspace,
  MAX_RECENT_ACTIONS,
  planBatch,
  workspaceReducer,
  type BatchToolInfo,
} from "./state";
import type { WorkspaceAction, WorkspaceFile, WorkspaceState } from "./types";

/** Build `n` staged PDF files with ids f0…f(n-1). */
function files(n: number): WorkspaceFile[] {
  return Array.from({ length: n }, (_, i) =>
    createWorkspaceFile(
      { name: `f${i}.pdf`, size: 100, type: "application/pdf" },
      `f${i}`,
      i,
    ),
  );
}

function withFiles(n: number): WorkspaceState {
  return workspaceReducer(emptyWorkspace(), {
    type: "add-files",
    files: files(n),
  });
}

function action(id: string, at = 1): WorkspaceAction {
  return { id, kind: "opened-tool", label: `Opened ${id}`, at };
}

describe("workspaceReducer — reset", () => {
  it("wipes files, tool, activity, and batch back to empty", () => {
    let state = withFiles(2);
    state = workspaceReducer(state, { type: "select-tool", slug: "merge-pdf" });
    state = workspaceReducer(state, {
      type: "set-batch-tool",
      slug: "merge-pdf",
    });
    state = workspaceReducer(state, {
      type: "add-to-batch",
      ids: ["f0", "f1"],
    });
    state = workspaceReducer(state, {
      type: "record-action",
      action: action("a1"),
    });

    expect(workspaceReducer(state, { type: "reset" })).toEqual(
      emptyWorkspace(),
    );
  });

  it("is a no-op (same reference) when already empty", () => {
    const empty = emptyWorkspace();
    expect(workspaceReducer(empty, { type: "reset" })).toBe(empty);
  });
});

describe("workspaceReducer — files", () => {
  it("adds files and de-duplicates by id", () => {
    let state = withFiles(2);
    expect(state.files.map((f) => f.id)).toEqual(["f0", "f1"]);
    // Re-adding f1 alongside a new f2 keeps one f1.
    state = workspaceReducer(state, {
      type: "add-files",
      files: [files(3)[1]!, files(3)[2]!],
    });
    expect(state.files.map((f) => f.id)).toEqual(["f0", "f1", "f2"]);
  });

  it("ignores an empty or fully-duplicate add (same reference)", () => {
    const state = withFiles(2);
    expect(workspaceReducer(state, { type: "add-files", files: [] })).toBe(
      state,
    );
    expect(
      workspaceReducer(state, { type: "add-files", files: [files(1)[0]!] }),
    ).toBe(state);
  });

  it("removes a file and prunes it from the batch queue", () => {
    let state = withFiles(3);
    state = workspaceReducer(state, {
      type: "add-to-batch",
      ids: ["f0", "f1"],
    });
    state = workspaceReducer(state, { type: "remove-file", id: "f1" });
    expect(state.files.map((f) => f.id)).toEqual(["f0", "f2"]);
    expect(state.batch.fileIds).toEqual(["f0"]);
  });

  it("treats removing an unknown file as a no-op", () => {
    const state = withFiles(2);
    expect(workspaceReducer(state, { type: "remove-file", id: "nope" })).toBe(
      state,
    );
  });

  it("clears files and batch items but keeps tool + activity", () => {
    let state = withFiles(2);
    state = workspaceReducer(state, { type: "select-tool", slug: "merge-pdf" });
    state = workspaceReducer(state, {
      type: "record-action",
      action: action("a1"),
    });
    state = workspaceReducer(state, { type: "add-to-batch", ids: ["f0"] });
    const cleared = workspaceReducer(state, { type: "clear-files" });
    expect(cleared.files).toEqual([]);
    expect(cleared.batch.fileIds).toEqual([]);
    expect(cleared.selectedToolSlug).toBe("merge-pdf");
    expect(cleared.recentActions).toHaveLength(1);
  });

  it("attaches a page count to a staged file, ignoring unknown ids", () => {
    let state = withFiles(2);
    state = workspaceReducer(state, {
      type: "set-page-count",
      id: "f0",
      pageCount: 12,
    });
    expect(state.files.find((f) => f.id === "f0")?.pageCount).toBe(12);
    expect(state.files.find((f) => f.id === "f1")?.pageCount).toBeUndefined();
    // An id that isn't staged is a no-op (same reference).
    expect(
      workspaceReducer(state, {
        type: "set-page-count",
        id: "ghost",
        pageCount: 3,
      }),
    ).toBe(state);
  });

  it("ignores non-positive counts and no-ops when the count is unchanged", () => {
    let state = withFiles(1);
    expect(
      workspaceReducer(state, {
        type: "set-page-count",
        id: "f0",
        pageCount: 0,
      }),
    ).toBe(state);
    expect(
      workspaceReducer(state, {
        type: "set-page-count",
        id: "f0",
        pageCount: -4,
      }),
    ).toBe(state);
    state = workspaceReducer(state, {
      type: "set-page-count",
      id: "f0",
      pageCount: 5,
    });
    // Re-applying the same count preserves referential identity.
    expect(
      workspaceReducer(state, {
        type: "set-page-count",
        id: "f0",
        pageCount: 5,
      }),
    ).toBe(state);
  });
});

describe("workspaceReducer — tool + activity", () => {
  it("selects a tool and no-ops on re-select", () => {
    const state = workspaceReducer(emptyWorkspace(), {
      type: "select-tool",
      slug: "split-pdf",
    });
    expect(state.selectedToolSlug).toBe("split-pdf");
    expect(
      workspaceReducer(state, { type: "select-tool", slug: "split-pdf" }),
    ).toBe(state);
  });

  it("prepends activity and caps the log", () => {
    let state = emptyWorkspace();
    for (let i = 0; i < MAX_RECENT_ACTIONS + 5; i++) {
      state = workspaceReducer(state, {
        type: "record-action",
        action: action(`a${i}`, i),
      });
    }
    expect(state.recentActions).toHaveLength(MAX_RECENT_ACTIONS);
    // Newest first.
    expect(state.recentActions[0]!.id).toBe(`a${MAX_RECENT_ACTIONS + 4}`);
  });
});

describe("workspaceReducer — batch", () => {
  it("sets the batch tool and enqueues only staged, not-yet-queued files", () => {
    let state = withFiles(3);
    state = workspaceReducer(state, {
      type: "set-batch-tool",
      slug: "compress-pdf",
    });
    state = workspaceReducer(state, {
      type: "add-to-batch",
      ids: ["f0", "f0", "ghost"],
    });
    expect(state.batch.toolSlug).toBe("compress-pdf");
    expect(state.batch.fileIds).toEqual(["f0"]);
    // Adding the same id again is a no-op (same reference).
    expect(workspaceReducer(state, { type: "add-to-batch", ids: ["f0"] })).toBe(
      state,
    );
  });

  it("removes one item and clears the queue while keeping the tool", () => {
    let state = withFiles(2);
    state = workspaceReducer(state, {
      type: "set-batch-tool",
      slug: "compress-pdf",
    });
    state = workspaceReducer(state, {
      type: "add-to-batch",
      ids: ["f0", "f1"],
    });
    state = workspaceReducer(state, { type: "remove-from-batch", id: "f0" });
    expect(state.batch.fileIds).toEqual(["f1"]);
    const cleared = workspaceReducer(state, { type: "clear-batch" });
    expect(cleared.batch.fileIds).toEqual([]);
    expect(cleared.batch.toolSlug).toBe("compress-pdf");
  });
});

describe("workspaceReducer — hydrate", () => {
  it("seeds persisted preferences without touching in-memory files", () => {
    const state = withFiles(2);
    const hydrated = workspaceReducer(state, {
      type: "hydrate",
      selectedToolSlug: "rotate-pdf",
      batchToolSlug: "compress-pdf",
      recentActions: [action("h1")],
    });
    expect(hydrated.files).toHaveLength(2); // files are untouched
    expect(hydrated.selectedToolSlug).toBe("rotate-pdf");
    expect(hydrated.batch.toolSlug).toBe("compress-pdf");
    expect(hydrated.recentActions.map((a) => a.id)).toEqual(["h1"]);
  });
});

describe("planBatch", () => {
  const live: BatchToolInfo = { live: true, usesWorker: false };
  const collect: BatchToolInfo = {
    live: true,
    usesWorker: false,
    handoff: "collect",
  };
  const batchTool: BatchToolInfo = {
    live: true,
    usesWorker: false,
    handoff: "batch",
  };
  const single: BatchToolInfo = {
    live: true,
    usesWorker: false,
    handoff: "single",
  };
  const worker: BatchToolInfo = { live: false, usesWorker: true };
  const clientNoRunner: BatchToolInfo = { live: false, usesWorker: false };
  const resolve = (slug: string) =>
    ({
      "merge-pdf": collect,
      "compress-pdf": batchTool,
      "rotate-pdf": single,
      "legacy-live": live,
      "ocr-pdf": worker,
      "extract-images": clientNoRunner,
    })[slug];

  it("reports 'empty' with nothing chosen", () => {
    expect(planBatch({ toolSlug: null, fileIds: [] }, resolve)).toMatchObject({
      status: "empty",
      ready: false,
    });
  });

  it("reports 'needs-tool' when files are queued without a tool", () => {
    expect(planBatch({ toolSlug: null, fileIds: ["f0"] }, resolve).status).toBe(
      "needs-tool",
    );
  });

  it("reports 'needs-files' when a tool is chosen but nothing is queued", () => {
    expect(
      planBatch({ toolSlug: "merge-pdf", fileIds: [] }, resolve).status,
    ).toBe("needs-files");
  });

  it("is 'ready' for a live collect/batch tool with files", () => {
    expect(
      planBatch({ toolSlug: "merge-pdf", fileIds: ["f0", "f1"] }, resolve),
    ).toMatchObject({ status: "ready", ready: true });
    expect(
      planBatch({ toolSlug: "compress-pdf", fileIds: ["f0", "f1"] }, resolve),
    ).toMatchObject({ status: "ready", ready: true });
  });

  it("is 'single' (still launchable) for a live one-file-at-a-time tool", () => {
    const plan = planBatch(
      { toolSlug: "rotate-pdf", fileIds: ["f0", "f1"] },
      resolve,
    );
    expect(plan).toMatchObject({ status: "single", ready: true });
  });

  it("treats a live tool with no declared handoff mode as 'ready'", () => {
    expect(
      planBatch({ toolSlug: "legacy-live", fileIds: ["f0"] }, resolve).status,
    ).toBe("ready");
  });

  it("is 'worker-disabled' for a secure-worker tool", () => {
    expect(
      planBatch({ toolSlug: "ocr-pdf", fileIds: ["f0"] }, resolve).status,
    ).toBe("worker-disabled");
  });

  it("is 'unavailable' for a client tool with no runner and for unknown slugs", () => {
    expect(
      planBatch({ toolSlug: "extract-images", fileIds: ["f0"] }, resolve)
        .status,
    ).toBe("unavailable");
    expect(
      planBatch({ toolSlug: "does-not-exist", fileIds: ["f0"] }, resolve)
        .status,
    ).toBe("unavailable");
  });
});
