// @vitest-environment node
/**
 * The client's tool directory is the catalogue's, regenerated — never edited.
 *
 * WHY A GENERATED FILE. Tool pages' first-load code names other tools (the
 * hand-off notice, the ticket rail, remedies) and reads their accepted
 * formats; importing `@/lib/tools` for that put the whole catalogue in every
 * tool page's first load. `directory.generated.ts` is the five fields those
 * modules read (see ./directory.ts), written by `pnpm tools:directory`.
 *
 * A COPY GOES STALE. So this compares the generated file with a fresh
 * projection of the catalogue, in full, and fails on any drift — a tool
 * renamed, added, moved to the worker, a format dropped. The positive control
 * mutates a COPY of the catalogue and proves the same comparison sees it;
 * without it, a projection that returned the generated file (or nothing,
 * against an empty file) would pass for ever.
 */
import { describe, expect, it } from "vitest";
import { tools } from "./catalog";
import { TOOL_DIRECTORY } from "./directory.generated";
import { getToolEntry, projectToolDirectory } from "./directory";

describe("directory.generated.ts", () => {
  it("health check: the catalogue and the generated file are both real", () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(TOOL_DIRECTORY.length).toBe(tools.length);
  });

  it("equals a fresh projection of the catalogue (run `pnpm tools:directory`)", () => {
    expect(TOOL_DIRECTORY).toEqual(projectToolDirectory(tools));
  });

  it("positive control: the comparison sees a one-field drift", () => {
    const drifted = tools.map((tool, i) =>
      i === 7 ? { ...tool, name: `${tool.name} (renamed)` } : tool,
    );
    expect(TOOL_DIRECTORY).not.toEqual(projectToolDirectory(drifted));
    const moved = tools.map((tool, i) =>
      i === 0 ? { ...tool, accept: [...tool.accept, "XYZ"] } : tool,
    );
    expect(TOOL_DIRECTORY).not.toEqual(projectToolDirectory(moved));
  });

  it("getToolEntry answers for every catalogue slug, and only those", () => {
    for (const tool of tools) {
      expect(getToolEntry(tool.slug)?.name).toBe(tool.name);
    }
    expect(getToolEntry("not-a-tool")).toBeUndefined();
  });
});
