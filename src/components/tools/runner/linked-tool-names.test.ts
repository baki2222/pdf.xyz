// @vitest-environment node
/**
 * The tool names a runner prints, held to the catalogue.
 *
 * Until 2026-11-09 (perf/per-tool-first-load) three runners looked these up
 * by slug in the tool directory (`@/lib/tools/directory`): Delete/Extract
 * Pages for their own name, Edit PDF for a link to PDF to Word, Create Forms
 * for a link to Edit PDF. The lookup put every tool's row in those pages'
 * first load for one name each, so the names are now constants beside the
 * copy — and the relationship the lookup used to compute is pinned here: a
 * rename, or a removed tool, turns this red (the lookup threw, or fell back
 * to the slug, before).
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { CREATE_FORMS_EDIT_PDF } from "./create-forms-runner";
import { EDIT_RUNNER_LINKED_TOOLS } from "./edit-runner";
import { PAGE_SELECT_TOOLS } from "./page-select-runner";

const pinned: [string, string][] = [
  ...Object.values(PAGE_SELECT_TOOLS).map(
    (t) => [t.slug, t.name] as [string, string],
  ),
  ...Object.entries(EDIT_RUNNER_LINKED_TOOLS),
  [CREATE_FORMS_EDIT_PDF.slug, CREATE_FORMS_EDIT_PDF.name],
];

/** Each pinned name that is not the catalogue's, with what the catalogue says. */
const stale = (rows: readonly [string, string][]) =>
  rows
    .filter(([slug, name]) => getToolBySlug(slug)?.name !== name)
    .map(
      ([slug, name]) => `${slug}: "${name}" vs "${getToolBySlug(slug)?.name}"`,
    );

describe("the names runners print are the catalogue's", () => {
  it("health check: every pinned row is read", () => {
    expect(pinned.length).toBe(4);
  });

  it("every pinned name equals the catalogue's", () => {
    expect(stale(pinned)).toEqual([]);
  });

  it("positive control: a respelled name and a removed tool are caught", () => {
    expect(stale([["remove-pages", "Remove Pages"]])).toHaveLength(1);
    expect(stale([["no-such-tool", "Nothing"]])).toHaveLength(1);
  });
});
