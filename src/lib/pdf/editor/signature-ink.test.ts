// @vitest-environment node
/**
 * Audit sign-pdf#2 (2026-11-06): drawn ink was hard-coded slate-900 and a
 * typed signature took the same colour, with no choice in the panel. Many
 * people sign in blue so the original tells apart from a photocopy.
 *
 * The ink is now a small palette (`SIGNATURE_INKS`). These read the colour
 * back out of what is produced: the drawn signature's pixels as they are
 * embedded, and the typed signature's fill operator in the exported PDF.
 */
import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import { SIGNATURE_INK, typedSignatureObject } from "./model";
import { prepareSignatureBitmap, type RgbaImage } from "../signature-image";
import { SIGNATURE_INKS, inkRgb, tintInk } from "./signature-ink";

const blue = SIGNATURE_INKS.find((i) => i.id === "blue")!;

/** A pad's worth of transparent pixels with a dark stroke across it. */
function stroke(): RgbaImage {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let x = 5; x < 35; x += 1) {
    const i = (10 * width + x) * 4;
    data.set([15, 23, 42, 255], i);
    // An anti-aliased edge: same colour, half alpha.
    data.set([15, 23, 42, 128], i + width * 4);
  }
  return { width, height, data };
}

async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.get(PDFName.of("Contents"));
  const refs =
    contents instanceof PDFArray ? contents.asArray() : [contents as PDFRef];
  return refs
    .map((r) => {
      const s = doc.context.lookup(r as PDFRef) as PDFRawStream;
      return new TextDecoder("latin1").decode(decodePDFRawStream(s).decode());
    })
    .join("\n");
}

describe("signature ink palette", () => {
  it("offers black first, and black is the ink Sign PDF has always used", () => {
    expect(SIGNATURE_INKS[0]!.hex).toBe(SIGNATURE_INK);
    expect(SIGNATURE_INKS.map((i) => i.label)).toContain("Blue");
    // Every swatch is a distinct, well-formed colour with a name.
    const hexes = SIGNATURE_INKS.map((i) => i.hex.toLowerCase());
    expect(new Set(hexes).size).toBe(hexes.length);
    for (const i of SIGNATURE_INKS) {
      expect(i.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(i.label.length).toBeGreaterThan(0);
    }
  });

  it("a drawn signature is embedded in the chosen ink, its edges kept soft", () => {
    const prepared = prepareSignatureBitmap(tintInk(stroke(), blue.hex), {
      removeBackground: false,
    });
    expect(prepared).not.toBeNull();
    const [r, g, b] = inkRgb(blue.hex);
    const alphas = new Set<number>();
    let inked = 0;
    const d = prepared!.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      inked += 1;
      alphas.add(d[i + 3]!);
      expect([d[i], d[i + 1], d[i + 2]]).toEqual([r, g, b]);
    }
    expect(inked).toBeGreaterThan(0);
    // Positive control on the anti-aliasing: partial alpha survived.
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true);
  });

  it("control: untinted, the stroke keeps its own colour", () => {
    const prepared = prepareSignatureBitmap(stroke(), {
      removeBackground: false,
    })!;
    const d = prepared.data;
    const i = [...Array(d.length / 4).keys()].find((p) => d[p * 4 + 3]! > 0)!;
    expect([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]).toEqual([15, 23, 42]);
  });

  it("a typed signature is written in the chosen ink", async () => {
    const blank = await PDFDocument.create();
    blank.addPage([400, 300]);
    const src = await blank.save();
    const fill = (hex: string) =>
      inkRgb(hex)
        .map((c) => String(Number((c / 255).toFixed(4))).replace(/^0\./, "."))
        .join(" ");
    const read = async (color?: string) =>
      pageContent(
        (
          await exportEditedPdf(src, [
            typedSignatureObject(
              "t",
              0,
              20,
              200,
              360,
              "Ada Lovelace",
              "signature",
              color,
            ),
          ])
        ).bytes,
      );
    const numbers = (text: string) =>
      [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map((m) =>
        m.slice(1, 4).map(Number),
      );
    const near = (hex: string) => (triple: number[]) =>
      triple.every((v, k) => Math.abs(v - inkRgb(hex)[k]! / 255) < 0.005);
    const blueText = await read(blue.hex);
    expect(numbers(blueText).some(near(blue.hex)), fill(blue.hex)).toBe(true);
    // Control: no colour given is the black it always was.
    const plain = await read();
    expect(numbers(plain).some(near(SIGNATURE_INK))).toBe(true);
    expect(numbers(plain).some(near(blue.hex))).toBe(false);
  });
});

describe("what Sign PDF says about ink", () => {
  it("the tool page and the guide name every swatch the panel offers", async () => {
    const { default: content } = await import("@/lib/tools/content/sign-pdf");
    const { guides } = await import("@/lib/guides/catalog");
    const guide = guides.find((g) => g.slug === "how-to-sign-a-pdf")!;
    const page = content.steps.map((s) => s.body).join(" ");
    const guideText = guide.steps.join(" ");
    const named = new Intl.ListFormat("en", { type: "disjunction" }).format(
      SIGNATURE_INKS.map((i) => i.label),
    );
    expect(page).toContain(`pick the ink: ${named}`);
    expect(guideText).toContain(`pick the ink: ${named}`);
    // A picture is not recoloured, and the page says so.
    expect(page).toMatch(/picture of your signature keeps its own colours/);
  });
});
