// @vitest-environment node
/**
 * The size guides' tables (audit #2, 2026-11-17), row by row.
 *
 * The subjects are DISCOVERED: every guide section that has a table. Each
 * row's label, cells and link are checked against the code the tool runs:
 * the label against `sizeLabel`, the "Custom" wording against the presets,
 * the form-safe value against `portalSafeKb`, and the link through the same
 * `parseSizeParam` the runner reads it with (the composed chain, not the
 * row's own fields). The rendered links are checked again, as a reader
 * receives them, in `src/app/internal-links.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { SIZE_PRESETS, sizeLabel } from "@/lib/pdf/size-presets";
import {
  COMPRESS_TABLE_SIZES,
  LIMIT_TABLE_SIZES,
  parseSizeParam,
  portalSafeKb,
} from "@/lib/pdf/size-targets";
import { guides } from "./catalog";
import type { Guide, GuideSizeRow } from "./types";

/** The `?size=` list each tool's runner reads its link against. */
const LIST_FOR: Readonly<Record<string, readonly number[]>> = {
  "compress-pdf": COMPRESS_TABLE_SIZES,
  "jpg-to-pdf": LIMIT_TABLE_SIZES,
};

const tables = guides.flatMap((guide) =>
  guide.sections.flatMap((section) =>
    section.table ? [{ guide, section, table: section.table }] : [],
  ),
);

/** What is wrong with one row of `guide`'s table, if anything. */
function rowProblems(guide: Guide, row: GuideSizeRow): string[] {
  const problems: string[] = [];
  const tool = guide.tools[0]!;
  const isPreset = SIZE_PRESETS.some((p) => p.bytes === row.bytes);
  if (row.label !== sizeLabel(row.bytes)) problems.push("label");
  if (/custom/i.test(row.choose) === isPreset) problems.push("choose");
  if (!row.portal.includes(String(portalSafeKb(row.bytes))))
    problems.push("portal");
  const url = new URL(row.href, "https://x");
  if (url.pathname !== `/tools/${tool}`) problems.push("path");
  const list = LIST_FOR[tool];
  if (!list || parseSizeParam(url.search, list) !== row.bytes)
    problems.push("chain");
  return problems;
}

describe("size tables", () => {
  it("are on exactly the two size guides, with at least 11 rows (health check)", () => {
    expect(tables.map((t) => t.guide.slug).sort()).toEqual([
      "how-to-compress-a-pdf-to-100-kb",
      "how-to-convert-jpg-to-pdf-under-100-kb",
    ]);
    expect(
      tables.reduce((n, t) => n + t.table.rows.length, 0),
    ).toBeGreaterThanOrEqual(11);
  });

  it.each(tables.map((t) => [t.guide.slug, t] as const))(
    "%s: every row is right, and its link sets its size",
    (_slug, { guide, table }) => {
      expect(
        table.rows.flatMap((r) =>
          rowProblems(guide, r).map((p) => `${r.label}: ${p}`),
        ),
      ).toEqual([]);
    },
  );

  it.each(tables.map((t) => [t.guide.slug, t] as const))(
    "%s: every anchor is unique on the page and is not a section id",
    (_slug, { guide, table }) => {
      const anchors = table.rows.map((r) => r.anchor);
      expect(new Set(anchors).size).toBe(anchors.length);
      const ids = new Set(guide.sections.map((s) => s.id));
      expect(anchors.filter((a) => ids.has(a))).toEqual([]);
    },
  );

  it("a row whose link names another size fails the chain (positive control)", () => {
    const { guide, table } = tables[0]!;
    const row = table.rows[0]!;
    const wrong = {
      ...row,
      href: row.href.replace(/size=[^&]+/, "size=150kb"),
    };
    expect(wrong.href).not.toBe(row.href);
    expect(rowProblems(guide, wrong)).toEqual(["chain"]);
  });
});
