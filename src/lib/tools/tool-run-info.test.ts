// @vitest-environment node
/**
 * The row a tool page hands its client (`toolRunInfoFor`) is the answer the
 * cross-tool tables give for that tool — for EVERY tool.
 *
 * Since 2026-11-09 (perf/per-tool-first-load) a tool page's hand-off code
 * reads its own `accept` row and capability from the server's props instead
 * of looking them up by slug (`eligibleFilesFor`, `getToolEntry`), and a
 * worker panel its pick facts. The ticket, the workspace and a result's
 * next steps still use the lookups. Two readings of one fact drift unless
 * something holds them together, so this does: the row's fields, and the
 * composed rule — which files a hand-off keeps — over a file of every
 * format the recogniser knows.
 */
import { describe, expect, it } from "vitest";
import {
  eligibleFilesFor,
  handoffCapabilityFor,
} from "@/lib/handoff/capability";
import { filesTheToolOpens } from "@/lib/handoff/capability-core";
import { EXTENSIONS_BY_FORMAT } from "@/lib/jobs/mime-by-format";
import { getRunnerKind } from "@/lib/pdf/registry";
import { getToolEntry } from "@/lib/tools/directory";
import { pickFactsFor } from "@/lib/uploads/pick-facts";
import { WORKER_PANELS } from "@/components/tools/worker-panels";
import { tools } from "./index";
import { toolRunInfoFor } from "./tool-run-info";

/** A file of every extension the format table knows, plus two strays. */
const CORPUS = [
  ...Object.values(EXTENSIONS_BY_FORMAT)
    .flat()
    .map((ext) => ({ name: `f.${ext}`, type: "" })),
  { name: "noext", type: "" },
  { name: "mislabelled.bin", type: "application/pdf" },
];

describe("toolRunInfoFor: the page's own row is the tables' answer", () => {
  it("health check: every tool, and a corpus of every format", () => {
    expect(tools.length).toBeGreaterThanOrEqual(50);
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(tools.map((t) => [t.slug, t] as const))("%s", (slug, tool) => {
    const info = toolRunInfoFor(tool);
    expect(info.slug).toBe(slug);
    expect(info.name).toBe(tool.name);
    expect(info.accept).toEqual(getToolEntry(slug)!.accept);
    expect(info.handoff).toEqual(handoffCapabilityFor(slug));
    // The composed rule the runner's claim applies, over every format.
    expect(
      filesTheToolOpens(info.accept, info.handoff, CORPUS).map((f) => f.name),
    ).toEqual(eligibleFilesFor(slug, CORPUS).map((f) => f.name));
    // A worker tool's panel gets its pick facts; a runner's page none.
    if (getRunnerKind(slug)) expect(info.pick).toBeUndefined();
    else {
      expect(WORKER_PANELS[slug], `${slug} has no panel route`).toBeDefined();
      expect(info.pick).toEqual(pickFactsFor(tool));
    }
  });

  it("positive control: the comparison sees a wrong row", () => {
    const merge = tools.find((t) => t.slug === "merge-pdf")!;
    const wrong = { ...toolRunInfoFor(merge), accept: ["DOCX"] };
    expect(
      filesTheToolOpens(wrong.accept, wrong.handoff, CORPUS).map((f) => f.name),
    ).not.toEqual(eligibleFilesFor("merge-pdf", CORPUS).map((f) => f.name));
  });

  it("the row is plain data the server can hand to a client component", () => {
    for (const tool of tools) {
      const info = toolRunInfoFor(tool);
      expect(JSON.parse(JSON.stringify(info))).toEqual(info);
    }
  });
});
