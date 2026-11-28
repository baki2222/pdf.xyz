import { inflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFFont,
} from "pdf-lib";
import { CONSENT_STORAGE_KEY } from "../src/lib/analytics/consent";
import { waitForHydration } from "./helpers";
import { captureDownload } from "./client-proof/artifacts";
import { injectAxe } from "./axe-inject";

/**
 * Markdown to PDF's table cells on the served build (backlog #24): a table
 * holding **b**, *i*, ***bi***, `code` and a link, typed into the page,
 * converted in the browser, downloaded, and read back from the PDF bytes:
 * the face each run is set in (its font's /BaseFont), the /Link annotations
 * and their boxes, and the cell borders the page draws.
 */

export const TABLE_SOURCE = [
  "# Cells",
  "",
  "| Kind | Sample | A narrow column |",
  "| --- | :-: | --: |",
  "| bold | **b** | ***bi*** |",
  "| italic | *i* | `code` |",
  "| link | [link](https://example.com) | **a bold phrase that has to wrap because this column cannot hold it on one line of the page at all** |",
  "| more | `a_code_span_that_wraps` | *an italic phrase that wraps here as well* |",
].join("\n");

export interface Run {
  text: string;
  face: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

export interface Rule {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Link {
  uri: string;
  rect: number[];
}

const winAnsi = new TextDecoder("windows-1252");

function inflateMaybe(raw: Uint8Array): string {
  try {
    return inflateSync(Buffer.from(raw)).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

/** Page 1 of the PDF: its text runs, table rules and links. */
export async function readFirstPage(bytes: Buffer) {
  const doc = await PDFDocument.load(bytes);
  const scratch = await PDFDocument.create();
  const page = doc.getPages()[0]!;
  const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const faces = new Map<string, string>();
  for (const [name, ref] of fonts.entries()) {
    faces.set(
      name.asString(),
      doc.context
        .lookup(ref as PDFRef, PDFDict)
        .lookup(PDFName.of("BaseFont"), PDFName)
        .decodeText(),
    );
  }
  const contents = page.node.lookup(PDFName.of("Contents"));
  const content = (
    contents instanceof PDFArray
      ? contents.asArray().map((r) => doc.context.lookup(r))
      : [contents]
  )
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => inflateMaybe(s.getContents()))
    .join("\n");
  const metrics = new Map<string, PDFFont>();
  const runs: Run[] = [];
  let face = "";
  let size = 0;
  let x = NaN;
  let y = NaN;
  for (const op of content.matchAll(
    /(\/[^\s/]+)\s+([\d.]+)\s+Tf|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm|<([0-9A-Fa-f]*)>\s*Tj|\[[^\]]*\]\s*TJ|\([^)]*\)\s*Tj/g,
  )) {
    if (op[1]) {
      face = faces.get(op[1]) ?? "";
      size = Number(op[2]);
    } else if (op[3] !== undefined) {
      x = Number(op[3]);
      y = Number(op[4]);
    } else if (op[5] !== undefined) {
      if (!(Object.values(StandardFonts) as string[]).includes(face)) {
        throw new Error(`not a standard face: ${face}`);
      }
      let font = metrics.get(face);
      if (!font) {
        font = await scratch.embedFont(face as StandardFonts);
        metrics.set(face, font);
      }
      const text = winAnsi.decode(Buffer.from(op[5], "hex"));
      runs.push({
        text,
        face,
        x,
        y,
        size,
        width: font.widthOfTextAtSize(text, size),
      });
    } else {
      throw new Error(`unread text operator: ${op[0].slice(0, 40)}`);
    }
  }
  const rules: Rule[] = [
    ...content.matchAll(
      /0\.78 0\.8 0\.85 RG\s+[\d.]+ w\s+\[\] 0 d\s+([\d.]+) ([\d.]+) m\s+[\d.]+ [\d.]+ m\s+([\d.]+) ([\d.]+) l/g,
    ),
  ].map((m) => ({
    x1: Number(m[1]),
    y1: Number(m[2]),
    x2: Number(m[3]),
    y2: Number(m[4]),
  }));
  const links: Link[] = [];
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) {
    for (const ref of annots.asArray()) {
      const annot = doc.context.lookup(ref);
      if (!(annot instanceof PDFDict)) continue;
      if (annot.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) continue;
      const action = annot.lookup(PDFName.of("A"));
      const uri =
        action instanceof PDFDict ? action.lookup(PDFName.of("URI")) : null;
      links.push({
        uri: uri instanceof PDFString ? uri.decodeText() : "",
        rect: annot
          .lookup(PDFName.of("Rect"), PDFArray)
          .asArray()
          .map((n) => Number(n.toString())),
      });
    }
  }
  return { runs, rules, links };
}

/** The cell (two neighbouring vertical rules spanning it) holding a box. */
export function cellHolding(
  rules: readonly Rule[],
  box: { x1: number; y1: number; x2: number; y2: number },
  clearance: number,
): { left: number; right: number } | null {
  const spanning = rules.filter(
    (r) =>
      r.x1 === r.x2 &&
      Math.min(r.y1, r.y2) <= box.y1 &&
      Math.max(r.y1, r.y2) >= box.y2,
  );
  const edges = [...new Set(spanning.map((r) => r.x1))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < edges.length; i++) {
    if (
      box.x1 >= edges[i]! + clearance &&
      box.x2 <= edges[i + 1]! - clearance
    ) {
      return { left: edges[i]!, right: edges[i + 1]! };
    }
  }
  return null;
}

export const runBox = (run: Run) => ({
  x1: run.x,
  x2: run.x + run.width,
  y1: run.y - run.size * 0.25,
  y2: run.y + run.size * 0.75,
});

export async function denyConsent(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "denied");
  }, CONSENT_STORAGE_KEY);
}

/** Type the Markdown into the page, create the PDF, and download it. */
export async function convertTable(
  page: Page,
  source: string = TABLE_SOURCE,
): Promise<Buffer> {
  await page.goto("/tools/markdown-to-pdf");
  const box = page.locator("textarea");
  await waitForHydration(box);
  await box.fill(source);
  const run = page.getByRole("button", { name: /create pdf/i });
  await waitForHydration(run);
  await run.click();
  await expect(page.getByRole("heading", { name: /pdf created/i })).toBeVisible(
    { timeout: 20_000 },
  );
  return captureDownload(
    page,
    page.getByRole("button", { name: /^download pdf$/i }),
  );
}

/** Everything the decoded PDF must show, asserted in one place. */
export async function expectStyledCells(bytes: Buffer): Promise<void> {
  const { runs, rules, links } = await readFirstPage(bytes);
  const cells = runs.filter((r) => r.size === 10);
  // Health: the grid and the cells were read (5 rows, 4 edges each).
  expect(rules.filter((r) => r.x1 === r.x2).length).toBeGreaterThanOrEqual(20);
  expect(cells.length).toBeGreaterThan(10);
  const faceOf = (text: string) => {
    const found = cells.filter((r) => r.text === text);
    expect(found, `"${text}" drawn once`).toHaveLength(1);
    return found[0]!.face;
  };
  expect(faceOf("Kind")).toBe("Helvetica-Bold");
  expect(faceOf("bold")).toBe("Helvetica");
  expect(faceOf("b")).toBe("Helvetica-Bold");
  expect(faceOf("i")).toBe("Helvetica-Oblique");
  expect(faceOf("bi")).toBe("Helvetica-BoldOblique");
  expect(faceOf("code")).toBe("Courier");
  expect(faceOf("link (https://example.com)")).toBe("Helvetica");
  // The link opens, with its box in the cell its text is drawn in.
  expect(links.map((l) => l.uri)).toEqual(["https://example.com"]);
  const [x1, y1, x2, y2] = links[0]!.rect as [number, number, number, number];
  const text = cells.find((r) => r.text.startsWith("link ("))!;
  const cell = cellHolding(rules, { x1, y1, x2, y2 }, 0);
  expect(cell).not.toBeNull();
  expect(cellHolding(rules, runBox(text), 1)).toEqual(cell);
  // No run crosses a cell border, at the narrow column too (it wrapped).
  const phrase =
    "a bold phrase that has to wrap because this column cannot hold it on one line of the page at all";
  const narrow = cells.filter(
    (r) =>
      r.face === "Helvetica-Bold" &&
      r.text.trim().length > 1 &&
      phrase.includes(r.text.trim()),
  );
  expect(narrow.map((r) => r.text.trim()).join(" ")).toBe(phrase);
  expect(new Set(narrow.map((r) => r.y)).size).toBeGreaterThan(1);
  const over = cells.filter((r) => !cellHolding(rules, runBox(r), 1));
  expect(over.map((r) => `${r.face} "${r.text}" x=${r.x}`)).toEqual([]);
}

/** axe-core WCAG 2.x A/AA violations on the page as it stands. */
export async function axeViolations(page: Page): Promise<string[]> {
  await injectAxe(page);
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            opts: object,
          ) => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    const r = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return r.violations.map(
      (v) => `${v.id} at ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    );
  });
}
