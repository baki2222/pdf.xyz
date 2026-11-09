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
import { RUN_ROW_MAX_BYTES } from "@/tests/tool-tables-markers";
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

  /*
   * The row is SERIALISED INTO EVERY TOOL PAGE'S DOCUMENT (React's flight
   * data in the prerendered HTML), where no JS budget sees it. The first
   * cut handed each PDF-taking worker page its converters as one
   * `{slug, name}` object per file format — 21 rows, ~1,320 B per page,
   * ~400 B gz of HTML on each of them, which ate up to a third of the JS the
   * change freed (chat-with-pdf: -3,101 JS, +1,033 HTML). The refusal says
   * only the converter's NAME, and the server already drops the tool's own
   * slug, so the row now carries each converter once with its formats.
   * Bounded here on the value, and in `lazy-chunks.test.ts` on the document
   * the reader receives. 700 B: the largest row is ~520 B; a converter
   * joining the catalogue adds ~25 B, a table of every tool adds kilobytes.
   */
  it("the row stays one row's worth of bytes on every page", () => {
    const sizes = tools.map(
      (t) => [t.slug, JSON.stringify(toolRunInfoFor(t)).length] as const,
    );
    const over = sizes.filter(([, bytes]) => bytes > RUN_ROW_MAX_BYTES);
    expect(over).toEqual([]);
    // Health: the bound is not vacuous — a worker PDF page's row has its
    // converters in it, and is far bigger than a client tool's.
    const most = Math.max(...sizes.map(([, bytes]) => bytes));
    expect(most).toBeGreaterThan(300);
  });

  it("positive control: the first cut's per-format converters break the bound", () => {
    const chat = tools.find((t) => t.slug === "chat-with-pdf")!;
    const info = toolRunInfoFor(chat);
    const perFormat = Object.fromEntries(
      Object.entries(info.pick!.converters).flatMap(([name, formats]) =>
        formats.map((f) => [f, { slug: "word-to-pdf", name }] as const),
      ),
    );
    const firstCut = {
      ...info,
      pick: { ...info.pick!, converters: perFormat },
    };
    expect(JSON.stringify(firstCut).length).toBeGreaterThan(RUN_ROW_MAX_BYTES);
  });

  it("the row is plain data the server can hand to a client component", () => {
    for (const tool of tools) {
      const info = toolRunInfoFor(tool);
      expect(JSON.parse(JSON.stringify(info))).toEqual(info);
    }
  });
});
