// @vitest-environment node
/**
 * Watermark PDF's page, held to the runner's controls and the engine's fit.
 *
 * The fit (8fa96e10) made the size a ceiling and centred the mark on the
 * visible box, and the runner relabelled its slider "Max font size". On
 * 2026-10-07 the page still served, from before both (verifier, 028d3a10):
 *
 *   - "Opacity, Rotation and Font size sliders" and "drag … Font size in
 *     points": no control has that label, and the size is not what is drawn;
 *   - "The text is not shrunk to fit, so a long line … is clipped" and
 *     "Centering uses the full sheet: on a page trimmed with Crop PDF … the
 *     mark can sit off-center": the engine does neither;
 *   - "Bengali, monospace, Greek, …" as the scripts a watermark can be in:
 *     the list split every font pack's label, including the Geist Mono pack,
 *     whose label is a typeface style and which the watermark never uses.
 *
 * So this reads what the page SERVES. The controls are DISCOVERED from the
 * runner (the component that imports the engine), and every slider label it
 * renders must be named, whole, where the page lists the controls. The
 * shipped sentences are a ban list's corpus in both directions, and the ban
 * is licensed by running `watermarkPdf`: a long line on A4 is shrunk, and a
 * cropped page's mark is centred inside the crop.
 *
 * WHAT THIS DOES NOT SEE: a control named by a synonym ("the size slider"),
 * and a script list that names the monospace pack by another word.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { tools } from "./catalog";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "./types";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { WATERMARK_FIT, watermarkPdf } from "@/lib/pdf/watermark";
import { FONT_PACKS, fontPack } from "@/lib/pdf/font-packs";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(rel);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [rel]
        : [];
    },
  );
}

const SLUGS = supportedToolSlugs.filter(
  (s) => getRunnerKind(s) === "watermark",
);

/** The runner: whichever component imports the watermark engine. */
const RUNNERS = sourceFiles("src/components").filter((file) =>
  /from\s+"@\/lib\/pdf\/watermark"/.test(
    withoutComments(readFileSync(path.join(ROOT, file), "utf8")),
  ),
);

/** Every slider label the runner renders. */
const SLIDERS = RUNNERS.flatMap((file) =>
  [
    ...withoutComments(readFileSync(path.join(ROOT, file), "utf8")).matchAll(
      /<RangeField\b[^>]*?\blabel="([^"]+)"/g,
    ),
  ].map((m) => m[1]!),
);

function servedFields(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

const sentences = (texts: readonly string[]) =>
  texts.flatMap((t) => t.split(/(?<=[.!?])\s+/));

const BANS: { name: string; pattern: RegExp; shipped: string[] }[] = [
  {
    // "Font size" as a control name; "Max font size" is the label.
    name: "a Font size control",
    pattern: /(?<!Max )\bFont size\b/,
    shipped: [
      "The Text field starts with CONFIDENTIAL typed in, and four controls shape the mark: Opacity, Rotation and Font size sliders, plus a Gray, Red or Blue color.",
      "Under Appearance, drag Opacity for how faint the mark is, Rotation for its angle (positive runs uphill from lower left, negative runs downhill, zero lies flat) and Font size in points, then pick Gray, Red or Blue.",
    ],
  },
  {
    name: "the mark is clipped, not shrunk",
    pattern: /\bnot shrunk to fit\b|\bruns off the page and is clipped\b/i,
    shipped: [
      "The text is not shrunk to fit, so a long line at a large Font size runs off the page and is clipped.",
    ],
  },
  {
    name: "centred on the full sheet, not the crop",
    pattern:
      /\bCentering uses the full sheet\b|\bthe mark can sit off-center\b/i,
    shipped: [
      "Centering uses the full sheet: on a page trimmed with Crop PDF, which hides margins rather than removing them, the mark can sit off-center.",
    ],
  },
];

/** Inflate a content stream, or return it as-is when it is not compressed. */
function streamText(stream: PDFRawStream): string {
  const raw = (stream as unknown as { contents: Uint8Array }).contents;
  try {
    return inflateSync(Buffer.from(raw)).toString("latin1");
  } catch {
    return Buffer.from(raw).toString("latin1");
  }
}

/** The x of every text matrix (`a b c d x y Tm`) drawn on page 1. */
async function textMatrixXs(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPages()[0]!;
  const contents = doc.context.lookup(page.node.get(PDFName.of("Contents")));
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  const text = streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map(streamText)
    .join("\n");
  return [
    ...text.matchAll(
      /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/g,
    ),
  ].map((m) => Number(m[5]));
}

describe("Watermark PDF's page names its controls and its fit as shipped", () => {
  it("health check: the slug, the runner and its sliders are discovered", () => {
    expect(SLUGS).toEqual(["watermark-pdf"]);
    expect(RUNNERS).toHaveLength(1);
    expect(SLIDERS.length).toBeGreaterThanOrEqual(3);
    expect(SLIDERS).toContain("Max font size");
  });

  it("every ban catches every sentence that shipped", () => {
    for (const ban of BANS) {
      expect(ban.shipped.length, ban.name).toBeGreaterThan(0);
      for (const s of ban.shipped)
        expect(ban.pattern.test(s), `${ban.name}: ${s}`).toBe(true);
    }
    // And not the label itself.
    expect(BANS[0]!.pattern.test("Max font size sliders")).toBe(false);
  });

  it("no served sentence makes a banned claim", () => {
    for (const slug of SLUGS) {
      const all = sentences(servedFields(getToolBySlug(slug)!));
      for (const ban of BANS)
        expect(
          all.filter((s) => ban.pattern.test(s)),
          `${slug}: ${ban.name}`,
        ).toEqual([]);
    }
  });

  it("where the page lists the controls, it names every slider by its label", () => {
    for (const slug of SLUGS) {
      const fields = servedFields(getToolBySlug(slug)!);
      const listing = fields.filter((f) => /\bsliders\b/.test(f));
      const appearance = fields.filter((f) => /\bUnder Appearance\b/.test(f));
      expect(listing.length, `${slug} no longer lists its sliders`).toBe(1);
      expect(appearance.length, `${slug} lost its Appearance step`).toBe(1);
      for (const field of [...listing, ...appearance])
        expect(SLIDERS.filter((label) => !field.includes(label))).toEqual([]);
    }
  });

  it("licence: a line too long for A4 at the maximum size is shrunk to fit, not clipped", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const report = await watermarkPdf(
      await doc.save(),
      "Property of Acme Corporation",
      { fontSize: 160, rotation: 45 },
    );
    expect(report.shrunkPages).toBe(1);
    expect(report.smallestFontSize).toBeLessThan(160);
    expect(WATERMARK_FIT).toBeLessThan(1);
  });

  it("licence: a cropped page's mark is centred inside the crop, not on the full sheet", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    // Crop PDF keeps only the right half.
    page.setCropBox(300, 0, 300, 800);
    const report = await watermarkPdf(await doc.save(), "X", {
      fontSize: 20,
      rotation: 0,
    });
    const xs = await textMatrixXs(report.bytes);
    expect(xs.length, "no text matrix was found, so nothing was measured").toBe(
      1,
    );
    // Inside the crop and near its middle (450), not the sheet's (300).
    expect(xs[0]!).toBeGreaterThan(400);
    expect(xs[0]!).toBeLessThan(460);
  });
});

/*
 * The monospace pack is a typeface, not an alphabet. A page that splits pack
 * labels into script names without the role filter prints "monospace" among
 * them — watermark-pdf did ("Bengali, monospace, Greek, …") and text-to-pdf did
 * ("Bengali; monospace; Latin, …") until 2026-10-07. Over every page served.
 */
describe("no page lists the monospace face among the scripts", () => {
  const mono = fontPack("mono").label;
  const scriptWords = [
    ...new Set(
      FONT_PACKS.filter((p) => p.role === "script").flatMap((p) => [
        ...p.label.split(/, | and /),
        ...p.scripts,
      ]),
    ),
  ];
  const words = scriptWords.join("|");
  const LISTED = new RegExp(
    `\\b(?:${words})[,;]\\s*(?:and\\s+)?${mono}\\b|\\b${mono}[,;]\\s*(?:and\\s+)?(?:${words})\\b`,
  );

  it("health check, and the predicate catches both shipped lists", () => {
    expect(mono).toBe("monospace");
    expect(scriptWords.length).toBeGreaterThan(5);
    const everyLabel = FONT_PACKS.flatMap((p) => p.label.split(/, | and /));
    const watermark = new Intl.ListFormat("en", {
      type: "conjunction",
    }).format([...new Set(everyLabel.filter((n) => n !== "Latin"))]);
    const textToPdf = FONT_PACKS.map((p) => p.label).join("; ");
    expect(watermark).toContain(mono);
    expect(LISTED.test(watermark), watermark).toBe(true);
    expect(LISTED.test(textToPdf), textToPdf).toBe(true);
    // The face named as a face is not a list member.
    expect(LISTED.test("set in a monospace face, under its language tag")).toBe(
      false,
    );
  });

  it("no served field does it", () => {
    const offenders = tools.flatMap((tool) =>
      servedFields(tool)
        .filter((f) => LISTED.test(f))
        .map((f) => `${tool.slug}: ${f}`),
    );
    expect(offenders).toEqual([]);
  });
});
