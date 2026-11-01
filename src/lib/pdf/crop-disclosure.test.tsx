// @vitest-environment jsdom
// @native-canvas
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CropDisclosure } from "@/components/tools/runner/crop-disclosure";
import { getToolBySlug } from "@/lib/tools";
import { withoutComments } from "@/lib/tools/copy-surface";
import { toolFacts } from "@/lib/tools/tool-facts";
import { cropPdf } from "./crop";
import {
  CROP_KEEPS_CONTENT,
  REDACT_TOOL_HREF,
  REDACT_TOOL_NAME,
  SPLIT_HALF_KEEPS_CONTENT,
} from "./crop-disclosure";
import { splitPagesInHalf } from "./split-half";
import { extractPdfText } from "./text";

/**
 * Crop PDF hides content; it does not remove it. The page said nothing, to
 * people searching "cut pdf" who crop away an account number before sharing.
 *
 * The disclosure is pinned to the BEHAVIOUR, read the way a leak happens: text
 * extraction of the cropped output. EXIT CONDITION (the property): if cropping
 * ever really removes what is outside the box, the first test goes red, and the
 * disclosure must be rewritten then — not before.
 */
afterEach(cleanup);

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;

describe("cropping keeps what it hides (the behaviour the copy discloses)", () => {
  it("text cropped out of view is still in the file, and the MediaBox is untouched", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("ACCOUNT 4417 1234", { x: 40, y: 770, size: 14, font });
    page.drawText("Body text", { x: 40, y: 400, size: 14, font });

    const output = await cropPdf(await doc.save(), {
      margins: { top: 100, right: 0, bottom: 0, left: 0 },
    });

    const cropped = await PDFDocument.load(output);
    const p = cropped.getPage(0);
    // Positive control: the crop really happened — the header is out of view.
    expect(p.getCropBox().height).toBeCloseTo(700);
    expect(p.getCropBox().y + p.getCropBox().height).toBeLessThan(770);
    expect(p.getMediaBox().height).toBeCloseTo(800);

    // As the cropped file is READ, pdf.js does not surface the hidden header
    // (it drops text outside the crop box) — which is why the copy does not
    // claim search finds it.
    const asCropped = (await extractPdfText(output, legacy)).text;
    expect(asCropped).toContain("Body text");
    expect(asCropped).not.toContain("ACCOUNT 4417 1234");

    // What "anyone with the file can bring it back" means: reset the crop box,
    // as any editor can, and the hidden text is right there.
    const media = p.getMediaBox();
    p.setCropBox(media.x, media.y, media.width, media.height);
    const reset = (await extractPdfText(await cropped.save(), legacy)).text;
    expect(reset).toContain("ACCOUNT 4417 1234");
  });
});

describe("the disclosure is where the user is", () => {
  it("the tool page's facts carry it", () => {
    const values = toolFacts("crop-pdf").map((f) => f.value);
    expect(values).toContain(CROP_KEEPS_CONTENT);
  });

  it("the cropped-download panel renders it with a real link to Redact PDF", () => {
    render(<CropDisclosure />);
    expect(screen.getByText(/stays inside the file/)).toBeTruthy();
    const link = screen.getByRole("link", { name: `Open ${REDACT_TOOL_NAME}` });
    expect(link.getAttribute("href")).toBe(REDACT_TOOL_HREF);
  });

  it("Redact PDF exists, claims permanent removal, and is a related tool of Crop PDF", () => {
    const slug = REDACT_TOOL_HREF.replace(/^\/tools\//, "");
    const redact = getToolBySlug(slug);
    expect(redact?.name).toBe(REDACT_TOOL_NAME);
    expect(redact?.description).toMatch(/permanently removed/i);
    expect(getToolBySlug("crop-pdf")?.related).toContain(slug);
  });

  it("the crop runner's result panel renders the disclosure", () => {
    const source = withoutComments(
      readFileSync(
        path.join(process.cwd(), "src/components/tools/runner/crop-runner.tsx"),
        "utf8",
      ),
    );
    const panel = source.slice(
      source.indexOf("<ResultPanel"),
      source.indexOf("</ResultPanel>"),
    );
    expect(panel.length).toBeGreaterThan(50);
    expect(panel).toContain("<CropDisclosure />");
  });
});

/**
 * Split PDF Pages in Half makes its halves the same way, so it carries the same
 * disclosure, pinned the same way. EXIT CONDITION (the property): if a split
 * ever really removes the half a page does not show, the first test goes red,
 * and `SPLIT_HALF_KEEPS_CONTENT` must be rewritten then.
 */
describe("splitting in half keeps the hidden half (the behaviour the copy discloses)", () => {
  it("the half out of view is still in the file, and the MediaBox is untouched", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([800, 560]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("LEFT HALF TEXT", { x: 60, y: 280, size: 14, font });
    page.drawText("ACCOUNT 4417 1234", { x: 460, y: 280, size: 14, font });

    const { bytes } = await splitPagesInHalf(await doc.save(), {
      direction: "left-right",
      order: "left-first",
    });
    const split = await PDFDocument.load(bytes);
    const left = split.getPage(0);
    // Positive control: the split really happened — page 1 is the left half.
    expect(split.getPageCount()).toBe(2);
    expect(left.getCropBox().width).toBeCloseTo(400);
    expect(left.getMediaBox().width).toBeCloseTo(800);

    // Read as split, page 1 alone does not surface the right half's words…
    split.removePage(1);
    const asSplit = (await extractPdfText(await split.save(), legacy)).text;
    expect(asSplit).toContain("LEFT HALF TEXT");
    expect(asSplit).not.toContain("ACCOUNT 4417 1234");

    // …and resetting its crop box, as any editor can, brings them back.
    const media = left.getMediaBox();
    left.setCropBox(media.x, media.y, media.width, media.height);
    const reset = (await extractPdfText(await split.save(), legacy)).text;
    expect(reset).toContain("ACCOUNT 4417 1234");
  });

  it("the tool page's facts carry it", () => {
    const values = toolFacts("split-pdf-pages-in-half").map((f) => f.value);
    expect(values).toContain(SPLIT_HALF_KEEPS_CONTENT);
  });

  it("Redact PDF is a related tool of Split PDF Pages in Half", () => {
    const slug = REDACT_TOOL_HREF.replace(/^\/tools\//, "");
    expect(getToolBySlug("split-pdf-pages-in-half")?.related).toContain(slug);
  });

  it("the split runner's result panel renders the disclosure with its own sentence", () => {
    const source = withoutComments(
      readFileSync(
        path.join(
          process.cwd(),
          "src/components/tools/runner/split-half-runner.tsx",
        ),
        "utf8",
      ),
    );
    const panel = source.slice(
      source.indexOf("<ResultPanel"),
      source.indexOf("</ResultPanel>"),
    );
    expect(panel.length).toBeGreaterThan(50);
    expect(panel).toContain(
      "<CropDisclosure sentence={SPLIT_HALF_KEEPS_CONTENT} />",
    );
  });

  it("the component renders the sentence it is given", () => {
    render(<CropDisclosure sentence={SPLIT_HALF_KEEPS_CONTENT} />);
    expect(screen.getByText(/hidden rather than deleted/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: `Open ${REDACT_TOOL_NAME}` }),
    ).toBeTruthy();
  });
});
