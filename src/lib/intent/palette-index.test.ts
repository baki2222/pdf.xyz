// @vitest-environment node
/**
 * What the command palette can find: every tool, every task, every guide,
 * the site's pages and the palette's own actions — DERIVED from the modules
 * that own each set, so a tool or a guide added tomorrow is findable without
 * this index changing. Each set is checked against its source in both
 * directions (nothing missing, nothing invented), and each kind is bounded
 * below so a set that quietly emptied cannot pass as "a subset".
 */
import { describe, expect, it } from "vitest";
import { GUIDE_META } from "@/lib/guides/meta.generated";
import { guides } from "@/lib/guides/catalog";
import { footerNav, primaryNav } from "@/lib/site";
import { tools } from "@/lib/tools";
import { TASKS } from "@/lib/tools/intents";
import { buildIndex, search } from "./search";
import { PALETTE_ACTIONS, paletteDocs, type PaletteDoc } from "./palette-index";

const docs = paletteDocs();
const of = (kind: PaletteDoc["kind"]) => docs.filter((d) => d.kind === kind);

describe("paletteDocs", () => {
  it("health check: every kind is present and plausibly sized", () => {
    expect(of("tool").length).toBeGreaterThanOrEqual(40);
    expect(of("task").length).toBeGreaterThanOrEqual(20);
    expect(of("guide").length).toBeGreaterThanOrEqual(10);
    expect(of("page").length).toBeGreaterThanOrEqual(5);
    expect(of("action").length).toBe(3);
  });

  it("tools are the catalogue, both ways", () => {
    expect(of("tool").map((d) => d.href)).toEqual(
      tools.map((t) => `/tools/${t.slug}`),
    );
  });

  it("tasks are TASKS, each pointing at its tool", () => {
    expect(of("task").map((d) => [d.name, d.href])).toEqual(
      TASKS.map((t) => [t.label, `/tools/${t.slug}`]),
    );
  });

  it("guides are the generated meta, which is the catalogue", () => {
    expect(of("guide").map((d) => d.href)).toEqual(
      GUIDE_META.map((g) => `/guides/${g.slug}`),
    );
    expect(of("guide").map((d) => d.name)).toEqual(guides.map((g) => g.title));
  });

  it("pages are every navigable href in the site's nav, once", () => {
    const hrefs = [
      ...primaryNav.map((i) => i.href),
      ...footerNav.flatMap((c) => c.items.flatMap((i) => i.href ?? [])),
    ];
    expect(new Set(of("page").map((d) => d.href))).toEqual(new Set(hrefs));
    expect(of("page").length).toBe(new Set(hrefs).size);
  });

  it("actions are the three the spec names", () => {
    expect(of("action").map((d) => d.name)).toEqual([
      "Open a file…",
      "Open workspace",
      "Clear local history",
    ]);
    expect(PALETTE_ACTIONS).toHaveLength(3);
  });

  it("ids are unique, so an option id is never shared", () => {
    const ids = docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ranks: 'shrink' puts Compress PDF's page first", () => {
    const index = buildIndex(docs);
    const { results, mode } = search(index, "shrink");
    expect(mode).toBe("all");
    expect(results[0]?.href).toBe("/tools/compress-pdf");
  });

  it("finds a guide by its title words", () => {
    const index = buildIndex(docs);
    const first = GUIDE_META[0]!;
    const { results } = search(index, first.title, { kinds: ["guide"] });
    expect(results[0]?.href).toBe(`/guides/${first.slug}`);
  });
});
