/**
 * The signature pages describe the placement and the image cleanup that ship.
 *
 * WHAT SHIPPED until 2026-10-07, each sentence true of the code it was written
 * over and false after a fix landed underneath it:
 *
 *  - Request Signatures said its boxes "ignore any rotation or crop the page
 *    carries" and told readers to "pick an upright page"; the worker resolves
 *    every box against the page's visible frame and turns it upright.
 *  - Sign PDF said "Placement also ignores a page's rotation flag"; signPdf
 *    anchors in the viewer's frame and draws counter-rotated.
 *  - Sign PDF said "a drawn signature is sized as the whole pad, blank space
 *    included"; the pad crops each drawing to its ink.
 *  - Sign PDF said "A JPEG cannot be transparent, so the paper ... lands on the
 *    page" and told readers to "choose a PNG ... with a transparent
 *    background"; every opaque upload has its paper keyed out by default.
 *
 * Each claim is a pattern held to the shipped sentences in BOTH directions,
 * read over every string every tool page serves and every guide (discovered,
 * not named — a third page repeating it is caught too), and refuted by RUNNING
 * the code it describes. The runner's own default (the checkbox starts ticked)
 * and the pad's crop through the canvas are proven by sign-runner.test.tsx and
 * signature-pad.test.tsx; this runs the pure functions they call.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument, degrees } from "pdf-lib";
import { tools } from "./catalog";
import type { Tool } from "./types";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { guides } from "@/lib/guides/catalog";
import { readAsViewer } from "@/tests/pdf-viewer-read";
import { encodePng } from "@/lib/pdf/extract-images";
import { signPdf } from "@/lib/pdf/signature";
import {
  prepareSignatureBitmap,
  type RgbaImage,
} from "@/lib/pdf/signature-image";
import { signatureBlockFields } from "@/lib/jobs/request-signatures";
import { runSignatureRequest } from "@/lib/workers/request-signatures/engine";
import { signatureRequestDeps } from "@/lib/workers/request-signatures/native";

const SHIPPED = [
  "The block climbs higher with each extra signer, positions ignore any rotation or crop the page carries, and the boxes sit on top of whatever is printed there, so pick an upright page with blank space at the foot.",
  "Placement also ignores a page's rotation flag, so on a page displayed turned the signature can land in another corner and run sideways or upside down.",
  "No. It snaps to one of 9 anchor points, Margin pushes it in from the edges, and Size sets its width with the height in proportion; a short typed name stops growing at the largest letter size the tool draws, and a drawn signature is sized as the whole pad, blank space included, so the ink itself comes out narrower.",
  "A JPEG cannot be transparent, so the paper around your ink, white or the grey of a scan, lands on the page with it.",
  "A PNG avoids that only if its background really is transparent; a signature drawn on the pad always is, because the pad exports ink with nothing behind it.",
  "Under Upload, choose a PNG of your scanned signature with a transparent background, and the page shows through around the ink instead of a rectangle of paper.",
];

/** One claim may be made in one clause. */
const clauses = (text: string) => text.split(/(?<=[.;:!?])\s+/);

const LETTER: [number, number] = [612, 792];

async function rotatedPage(rotate: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(LETTER).setRotation(degrees(rotate));
  return doc.save();
}

function rgba(
  width: number,
  height: number,
  fill: [number, number, number, number],
  ink: { x: number; y: number; width: number; height: number },
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  for (let y = ink.y; y < ink.y + ink.height; y += 1)
    for (let x = ink.x; x < ink.x + ink.width; x += 1)
      data.set([15, 23, 42, 255], (y * width + x) * 4);
  return { width, height, data };
}

/** Sign PDF on a /Rotate 90 page: bottom-right as the viewer sees it, upright. */
async function signPlacesInTheDisplayedFrame() {
  const png = encodePng(4, 2, "rgb8", new Uint8Array(4 * 2 * 3).fill(40));
  const out = await signPdf(
    await rotatedPage(90),
    { kind: "image", bytes: png, format: "png" },
    { pageIndex: 0, position: "bottom-right", width: 200, margin: 24 },
  );
  const read = await readAsViewer(out);
  // Health: the page is displayed turned, and the reader found the image.
  expect(read.width).toBeGreaterThan(read.height);
  expect(read.imageFrames.length).toBe(1);
  const img = read.imageFrames[0]!;
  expect(img.upright).toBe(true);
  expect(Math.abs(img.box[2] - (read.width - 24))).toBeLessThan(0.5);
  expect(Math.abs(img.box[1] - 24)).toBeLessThan(0.5);
}

/** Request Signatures on a /Rotate 90 page: the box sits where the panel drew it. */
async function requestPlacesInTheDisplayedFrame() {
  const fields = signatureBlockFields(1, 1, false);
  const run = await runSignatureRequest(
    await rotatedPage(90),
    {
      signers: [{ name: "Ada Signer", email: "ada@example.com" }],
      fields,
      routing: "sequential",
      deliver: false,
    },
    signatureRequestDeps(),
  );
  if (!run.ok) throw new Error(run.message);
  const zip = await JSZip.loadAsync(run.output);
  const prepared = await zip.file("prepared.pdf")!.async("uint8array");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: prepared.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const [ann] = (await page.getAnnotations()) as {
      rect: [number, number, number, number];
      rotation: number;
    }[];
    expect(page.rotate).toBe(90);
    expect(ann, "the field is on the page").toBeDefined();
    const [a, b, c, d, e, f] = viewport.transform as number[];
    const xs = [ann!.rect[0], ann!.rect[2]];
    const ys = [ann!.rect[1], ann!.rect[3]];
    const vx = xs.flatMap((x) => ys.map((y) => a! * x + c! * y + e!));
    const vy = xs.flatMap((x) => ys.map((y) => b! * x + d! * y + f!));
    const field = fields[0]!;
    // Viewport y runs down from the top; the field's y is up from the bottom.
    expect(Math.abs(Math.min(...vx) - field.x * viewport.width)).toBeLessThan(
      1.5,
    );
    expect(
      Math.abs(Math.max(...vy) - (1 - field.y) * viewport.height),
    ).toBeLessThan(1.5);
    expect(ann!.rotation, "turned to read upright").toBe(page.rotate);
  } finally {
    await task.destroy();
  }
}

interface Claim {
  readonly says: string;
  readonly patterns: readonly RegExp[];
  /** Run the code; it must NOT do what `says` says. */
  readonly refute: () => Promise<void>;
}

const CLAIMS: Claim[] = [
  {
    says: "placement ignores the page's rotation or crop",
    patterns: [/\bignores?\b[^.;]*\b(?:rotation|crop)\b/i, /\bupright page\b/i],
    refute: async () => {
      await signPlacesInTheDisplayedFrame();
      await requestPlacesInTheDisplayedFrame();
    },
  },
  {
    says: "a drawn signature is sized as the whole pad",
    patterns: [/\bwhole pad\b/i, /\bblank space included\b/i],
    refute: async () => {
      // The pad's own call: transparent canvas, removeBackground false.
      const pad = rgba(520, 180, [0, 0, 0, 0], {
        x: 200,
        y: 80,
        width: 40,
        height: 20,
      });
      const out = prepareSignatureBitmap(pad, { removeBackground: false });
      expect(out).not.toBeNull();
      expect(out!.width).toBeLessThan(60);
      expect(out!.height).toBeLessThan(40);
    },
  },
  {
    says: "the paper of an opaque upload lands on the page",
    patterns: [
      /\bcannot be transparent\b/i,
      /\bonly if its background\b/i,
      /\bchoose a PNG\b[^.]*\btransparent background\b/i,
    ],
    refute: async () => {
      // A JPEG-like photo: fully opaque white paper, dark ink, defaults.
      const photo = rgba(300, 120, [250, 250, 250, 255], {
        x: 100,
        y: 50,
        width: 60,
        height: 15,
      });
      const out = prepareSignatureBitmap(photo);
      expect(out).not.toBeNull();
      // Not opaque, so it is encoded as a PNG with alpha, never a JPEG.
      expect(out!.opaque).toBe(false);
      // The corner is paper, and it is transparent.
      expect(out!.data[3]).toBe(0);
      // POSITIVE CONTROL: unticked, the paper is kept and the result is opaque.
      const kept = prepareSignatureBitmap(photo, { removeBackground: false });
      expect(kept!.opaque).toBe(true);
      expect(kept!.data[3]).toBe(255);
    },
  },
];

const caught = (pattern: RegExp, text: string) =>
  clauses(text).some((c) => pattern.test(c));

function servedFields(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

function surfaces(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const tool of tools)
    for (const text of servedFields(tool)) out.push({ where: tool.slug, text });
  for (const guide of guides)
    for (const text of [
      guide.title,
      guide.description,
      ...guide.intro,
      ...guide.steps,
      ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
      ...guide.faq.flatMap((f) => [f.question, f.answer]),
    ])
      out.push({ where: `guide ${guide.slug}`, text });
  return out;
}

describe("the signature pages describe the placement and cleanup that ship", () => {
  it("the corpus and the patterns cover each other", () => {
    for (const s of SHIPPED)
      expect(
        CLAIMS.some((c) => c.patterns.some((p) => caught(p, s))),
        `uncaught: ${s}`,
      ).toBe(true);
    for (const c of CLAIMS)
      for (const p of c.patterns)
        expect(
          SHIPPED.some((s) => caught(p, s)),
          `${c.says}: ${p} catches nothing shipped`,
        ).toBe(true);
  });

  for (const { says, refute } of CLAIMS)
    it(`the code does not do it: ${says}`, refute, 30_000);

  it("no page or guide says it", () => {
    const all = surfaces();
    // Health: every tool and guide was read, the two signature pages among them.
    expect(all.length).toBeGreaterThan(tools.length * 10);
    expect(all.some((s) => s.where === "sign-pdf")).toBe(true);
    expect(all.some((s) => s.where === "request-signatures")).toBe(true);
    expect(all.some((s) => s.where.startsWith("guide "))).toBe(true);
    const offenders = all.flatMap(({ where, text }) =>
      clauses(text).flatMap((clause) =>
        CLAIMS.flatMap((c) =>
          c.patterns
            .filter((p) => p.test(clause))
            .map(() => `${where}: [${c.says}] ${clause}`),
        ),
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
