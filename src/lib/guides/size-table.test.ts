// @vitest-environment node
/**
 * The size guides' tables (audit #2, 2026-11-17), row by row.
 *
 * The subjects are DISCOVERED: every guide section that has a table. Each
 * row's label, cells and link are checked against the code the tool runs:
 * the label against `sizeLabel`, the "Custom" wording against the presets,
 * every number a cell says to type through the tool's own Custom-box
 * function (`chosenTargetBytes` / `chosenLimitBytes`), the form-safe value
 * against `portalSafeKb` and the form's decimal size, and the link through the same
 * `parseSizeParam` the runner reads it with (the composed chain, not the
 * row's own fields). The rendered links are checked again, as a reader
 * receives them, in `src/app/internal-links.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { chosenTargetBytes } from "@/lib/pdf/compress-target";
import { chosenLimitBytes } from "@/lib/pdf/image-size-limit";
import { SIZE_PRESETS, sizeLabel } from "@/lib/pdf/size-presets";
import {
  COMPRESS_TABLE_SIZES,
  LIMIT_TABLE_SIZES,
  decimalBytes,
  parseSizeParam,
  portalSafeKb,
} from "@/lib/pdf/size-targets";
import { guides } from "./catalog";
import type { Guide, GuideSizeRow } from "./types";

/**
 * The bytes each tool's Custom box asks for when the reader types `kb`, by
 * the function its runner runs (a file of any size, so Compress's "must be
 * below the file" rule does not decide it).
 */
const CUSTOM_BYTES: Readonly<
  Record<string, (kb: string) => number | undefined | "invalid">
> = {
  "compress-pdf": (kb) => chosenTargetBytes("custom", kb, Infinity),
  "jpg-to-pdf": (kb) => chosenLimitBytes("custom", kb),
};

/** The number a cell tells the reader to type ("… and type 2048" -> "2048"). */
const typed = (cell: string) => /\btype (\d+)$/.exec(cell)?.[1] ?? null;

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
  const custom = CUSTOM_BYTES[tool];
  if (!custom) problems.push("tool");
  // Off-preset rows: the number to type must ask for exactly the row's bytes.
  if (isPreset) {
    if (!row.choose.includes(row.label) || typed(row.choose) !== null)
      problems.push("choose");
  } else {
    const n = typed(row.choose);
    if (n === null || custom?.(n) !== row.bytes) problems.push("choose typed");
  }
  // The form-safe value: what portalSafeKb says, accepted by the box, and
  // under the size the form means.
  const p = typed(row.portal);
  const pBytes = p === null ? undefined : custom?.(p);
  if (
    p !== String(portalSafeKb(row.bytes)) ||
    typeof pBytes !== "number" ||
    pBytes > decimalBytes(row.bytes)
  )
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

  it("an off-preset row that says to type the wrong number fails (positive control)", () => {
    const found = tables.flatMap(({ guide, table }) =>
      table.rows
        .filter((r) => !SIZE_PRESETS.some((p) => p.bytes === r.bytes))
        .map((row) => ({ guide, row })),
    );
    // Health check: 2 MB on both guides and 300 KB on the JPG guide.
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const { guide, row } of found) {
      expect(rowProblems(guide, row)).toEqual([]);
      const n = Number(typed(row.choose));
      const wrong = {
        ...row,
        choose: row.choose.replace(/\d+$/, String(n + 1)),
      };
      expect(wrong.choose).toContain(`type ${n + 1}`);
      expect(rowProblems(guide, wrong)).toEqual(["choose typed"]);
    }
  });

  it("a form-safe value one KB too big, or a bare preset row told to type, fails (positive control)", () => {
    const { guide, table } = tables[0]!;
    const row = table.rows[0]!;
    const over = {
      ...row,
      portal: row.portal.replace(/\d+$/, String(portalSafeKb(row.bytes) + 3)),
    };
    expect(rowProblems(guide, over)).toEqual(["portal"]);
    const preset = { ...row, choose: `${row.choose} and type 100` };
    expect(rowProblems(guide, preset)).toEqual(["choose"]);
  });

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
