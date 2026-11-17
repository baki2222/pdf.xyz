import { expect, test } from "@playwright/test";
import {
  axeViolations,
  convertTable,
  denyConsent,
  expectStyledCells,
  readFirstPage,
} from "./markdown-table-cells-fixture";

/**
 * Markdown to PDF on the served build, desktop (backlog #24): a table's
 * cells draw bold, italic, bold italic, code and a link that opens, each
 * inside its cell. The 375x812 pass is markdown-table-cells.mobile.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await denyConsent(page);
});

test("a table's styled cells come out in their faces, with a link that opens inside its cell", async ({
  page,
}) => {
  await expectStyledCells(await convertTable(page));
  // The page around the result passes axe (the tile copy changed).
  expect(await axeViolations(page)).toEqual([]);
});

test("CONTROL: the same reader sees no link and one face per row in a plain table", async ({
  page,
}) => {
  const { runs, links } = await readFirstPage(
    await convertTable(page, "| a | b |\n| - | - |\n| one | two |"),
  );
  expect(links).toEqual([]);
  expect(
    runs.filter((r) => r.size === 10).map((r) => `${r.text}:${r.face}`),
  ).toEqual([
    "a:Helvetica-Bold",
    "b:Helvetica-Bold",
    "one:Helvetica",
    "two:Helvetica",
  ]);
});
