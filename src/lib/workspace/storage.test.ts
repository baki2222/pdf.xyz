import { describe, expect, it } from "vitest";
import { createWorkspaceFile } from "./classify";
import { emptyWorkspace, workspaceReducer } from "./state";
import {
  clearPersisted,
  loadPersisted,
  MAX_PERSISTED_ACTIONS,
  migrate,
  savePersisted,
  toPersisted,
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_STORAGE_KEY,
  type StorageLike,
} from "./storage";
import type { WorkspaceAction, WorkspaceState } from "./types";

/** A simple in-memory StorageLike, with optional throw-on-op behavior. */
function fakeStorage(
  opts: { throwOn?: "get" | "set" | "remove" } = {},
): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem(key) {
      if (opts.throwOn === "get") throw new Error("blocked");
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (opts.throwOn === "set") throw new Error("quota");
      map.set(key, value);
    },
    removeItem(key) {
      if (opts.throwOn === "remove") throw new Error("blocked");
      map.delete(key);
    },
  };
}

function action(id: string): WorkspaceAction {
  return {
    id,
    kind: "opened-tool",
    label: `Opened ${id}`,
    toolSlug: "merge-pdf",
    at: 1,
  };
}

function stateWith(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return { ...emptyWorkspace(), ...overrides };
}

describe("toPersisted — never leaks file metadata", () => {
  it("omits files entirely, keeping only tool prefs + activity", () => {
    let state = emptyWorkspace();
    state = workspaceReducer(state, {
      type: "add-files",
      files: [
        createWorkspaceFile(
          {
            name: "SECRET-severance-agreement.pdf",
            size: 999,
            type: "application/pdf",
          },
          "secret-id",
          1,
        ),
      ],
    });
    state = workspaceReducer(state, { type: "select-tool", slug: "merge-pdf" });

    const persisted = toPersisted(state);
    const blob = JSON.stringify(persisted);
    expect(blob).not.toContain("SECRET-severance-agreement");
    expect(blob).not.toContain("secret-id");
    expect("files" in persisted).toBe(false);
    expect(persisted.version).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(persisted.selectedToolSlug).toBe("merge-pdf");
  });

  it("bounds the persisted activity log", () => {
    const many = Array.from({ length: MAX_PERSISTED_ACTIONS + 6 }, (_, i) =>
      action(`a${i}`),
    );
    const persisted = toPersisted(stateWith({ recentActions: many }));
    expect(persisted.recentActions).toHaveLength(MAX_PERSISTED_ACTIONS);
  });
});

describe("migrate", () => {
  it("accepts a current-version blob and narrows its fields", () => {
    const result = migrate({
      version: 1,
      selectedToolSlug: "split-pdf",
      batchToolSlug: "compress-pdf",
      recentActions: [action("a1"), { garbage: true }],
    });
    expect(result).not.toBeNull();
    expect(result!.selectedToolSlug).toBe("split-pdf");
    expect(result!.batchToolSlug).toBe("compress-pdf");
    // The malformed action is dropped.
    expect(result!.recentActions.map((a) => a.id)).toEqual(["a1"]);
  });

  it("upgrades a legacy pre-version blob (lastTool → selectedToolSlug)", () => {
    const result = migrate({ lastTool: "rotate-pdf" });
    expect(result).toEqual({
      version: 1,
      selectedToolSlug: "rotate-pdf",
      batchToolSlug: null,
      recentActions: [],
    });
  });

  it("rejects non-objects, unknown future versions, and malformed shapes", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate("nope")).toBeNull();
    expect(migrate([1, 2, 3])).toBeNull();
    expect(migrate({ version: 99, selectedToolSlug: "x" })).toBeNull();
  });

  it("coerces missing optional fields to safe defaults", () => {
    const result = migrate({ version: 1 });
    expect(result).toEqual({
      version: 1,
      selectedToolSlug: null,
      batchToolSlug: null,
      recentActions: [],
    });
  });
});

describe("load/save/clear round-trip", () => {
  it("saves the safe subset and loads it back", () => {
    const store = fakeStorage();
    const state = stateWith({
      selectedToolSlug: "merge-pdf",
      recentActions: [action("a1")],
      batch: { toolSlug: "compress-pdf", fileIds: ["f0"] },
    });
    expect(savePersisted(state, store)).toBe(true);

    const loaded = loadPersisted(store);
    expect(loaded).toEqual({
      version: WORKSPACE_SCHEMA_VERSION,
      selectedToolSlug: "merge-pdf",
      batchToolSlug: "compress-pdf",
      recentActions: [action("a1")],
    });
  });

  it("clears the persisted blob", () => {
    const store = fakeStorage();
    savePersisted(stateWith({ selectedToolSlug: "merge-pdf" }), store);
    expect(store.map.has(WORKSPACE_STORAGE_KEY)).toBe(true);
    clearPersisted(store);
    expect(store.map.has(WORKSPACE_STORAGE_KEY)).toBe(false);
  });
});

describe("guarded IO — never throws", () => {
  it("loadPersisted returns null for missing, corrupt, or throwing storage", () => {
    expect(loadPersisted(fakeStorage())).toBeNull(); // empty
    const corrupt = fakeStorage();
    corrupt.map.set(WORKSPACE_STORAGE_KEY, "{not json");
    expect(loadPersisted(corrupt)).toBeNull();
    expect(loadPersisted(fakeStorage({ throwOn: "get" }))).toBeNull();
  });

  it("savePersisted returns false when the write throws (quota/disabled)", () => {
    expect(savePersisted(stateWith(), fakeStorage({ throwOn: "set" }))).toBe(
      false,
    );
  });

  it("clearPersisted swallows a throwing remove", () => {
    expect(() =>
      clearPersisted(fakeStorage({ throwOn: "remove" })),
    ).not.toThrow();
  });
});
