// @vitest-environment node
// @native-canvas
/**
 * No pdf.js document the export opens decodes an image without a ceiling.
 *
 * The page scan's byte budget is the bound that matters, and it stands on
 * the page inventory; where the inventory had nothing to say, the scan fell
 * back to pdf.js's own per-image ceiling — or, through a defaulted option, to
 * whatever a caller forgot to pass. Defence in depth (2026-10-11, after the
 * second re-review): `openNodePdf` takes no default and refuses an unlimited
 * ceiling, and every `getDocument` in the export's modules is found here, by
 * walking them, and must pass a finite one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import {
  imageCaptionPdf,
  PPTX_FIDELITY_FIXTURES,
} from "@/tests/pptx-fidelity-fixtures";
import { COMPARISON_MAX_IMAGE_PIXELS } from "./fidelity";
import { MAX_DECODED_IMAGE_PIXELS, openNodePdf } from "./pdfjs-node";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const DIR = path.join(
  process.cwd(),
  "src",
  "lib",
  "workers",
  "pdf-office-export",
);

describe("pdf.js is never opened by the export without an image ceiling", () => {
  it("openNodePdf refuses a missing, unlimited, zero or non-finite ceiling, and opens with a finite one", async () => {
    const { pdf } = await imageCaptionPdf();
    const bare = openNodePdf as unknown as (b: Uint8Array) => Promise<unknown>;
    await expect(bare(pdf)).rejects.toThrow(/ceiling/);
    for (const maxImageSize of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY])
      await expect(
        openNodePdf(pdf, { maxImageSize }),
        String(maxImageSize),
      ).rejects.toThrow(/ceiling/);
    // Positive control: the check is not a refusal of everything.
    const opened = await openNodePdf(pdf, {
      maxImageSize: MAX_DECODED_IMAGE_PIXELS,
    });
    expect(opened.doc.numPages).toBe(1);
    await opened.close();
  });

  it("every getDocument in the export's modules passes a finite maxImageSize", () => {
    const files = readdirSync(DIR).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    const sites: { file: string; ceiling: string | null }[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        readFileSync(path.join(DIR, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: TS.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "getDocument"
        ) {
          const [arg] = node.arguments;
          const prop =
            arg && ts.isObjectLiteralExpression(arg)
              ? arg.properties.find(
                  (p) =>
                    (ts.isPropertyAssignment(p) ||
                      ts.isShorthandPropertyAssignment(p)) &&
                    p.name.getText(source) === "maxImageSize",
                )
              : undefined;
          const value =
            prop && ts.isPropertyAssignment(prop)
              ? prop.initializer
              : prop && ts.isShorthandPropertyAssignment(prop)
                ? prop.name
                : null;
          // A ceiling, written as a name or a positive number — never a
          // negative literal (pdf.js reads -1 as "no ceiling").
          sites.push({
            file,
            ceiling:
              value && !ts.isPrefixUnaryExpression(value)
                ? value.getText(source)
                : null,
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    // Health: the walk found the export's opener, and more than one site.
    expect(sites.map((s) => s.file)).toContain("pdfjs-node.ts");
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(sites.filter((s) => s.ceiling === null)).toEqual([]);
  });

  it("the comparison's ceiling admits every picture of every fixture it compares", async () => {
    // It opens the SOURCE side for the fidelity instrument: a picture its
    // ceiling dropped would hide a defect, so it sits above them all —
    // and above the scan's floor, which one fixture exceeds on purpose.
    let largest = 0;
    for (const build of PPTX_FIDELITY_FIXTURES)
      for (const page of (await build()).pages)
        for (const image of page.images)
          largest = Math.max(largest, image.pixelWidth * image.pixelHeight);
    expect(largest).toBeGreaterThan(MAX_DECODED_IMAGE_PIXELS);
    expect(largest).toBeLessThanOrEqual(COMPARISON_MAX_IMAGE_PIXELS);
    expect(Number.isFinite(COMPARISON_MAX_IMAGE_PIXELS)).toBe(true);
  });
});
