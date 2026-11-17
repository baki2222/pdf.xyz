// @native-canvas
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
 * WHAT SHIPPED until 2026-11-17 (audit #21), true of the fixed block it was
 * written over and false once the placement editor landed: Request
 * Signatures said its server "stacks one fillable signature box per signer
 * near the bottom", that the boxes are "placed automatically" / "placed for
 * you", "There is no dragging.", "all on the one page you choose", and its
 * FAQ and guide answered "Can I drag/move the boxes?" with "No.". The reader
 * now drags, resizes, adds (per type and signer) and moves boxes between
 * pages. A bare "No." has no words a clause pattern can catch, so the FAQ
 * half is a RELATIONSHIP below: a question about moving the boxes may not be
 * answered "No".
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
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import {
  prepareSignatureBitmap,
  type RgbaImage,
} from "@/lib/pdf/signature-image";
import { signatureBlockFields } from "@/lib/jobs/request-signatures";
import { readPdfFrames } from "@/lib/pdf/page-frame";
import {
  addField,
  moveField,
  startingLayout,
  toRequestFields,
} from "@/lib/signatures/request-layout";
import { runSignatureRequest } from "@/lib/workers/request-signatures/engine";
import { signatureRequestDeps } from "@/lib/workers/request-signatures/native";

const SHIPPED = [
  "The block climbs higher with each extra signer, positions ignore any rotation or crop the page carries, and the boxes sit on top of whatever is printed there, so pick an upright page with blank space at the foot.",
  "Placement also ignores a page's rotation flag, so on a page displayed turned the signature can land in another corner and run sideways or upside down.",
  "No. It snaps to one of 9 anchor points, Margin pushes it in from the edges, and Size sets its width with the height in proportion; a short typed name stops growing at the largest letter size the tool draws, and a drawn signature is sized as the whole pad, blank space included, so the ink itself comes out narrower.",
  "A JPEG cannot be transparent, so the paper around your ink, white or the grey of a scan, lands on the page with it.",
  "A PNG avoids that only if its background really is transparent; a signature drawn on the pad always is, because the pad exports ink with nothing behind it.",
  "Under Upload, choose a PNG of your scanned signature with a transparent background, and the page shows through around the ink instead of a rectangle of paper.",
  // Request Signatures, served until 2026-11-17 (audit #21).
  "Our server stacks one fillable signature box per signer near the bottom of that page, each with a date box beside it unless you untick that option.",
  "No. They are placed automatically near the left edge, just above the bottom of the chosen page as it is displayed, so any rotation or crop the page carries is taken into account.",
  "The boxes are placed for you, near the left edge just above the foot of the chosen page as it is displayed, so a rotation or crop the page carries is taken into account.",
  "There is no dragging.",
  "No. They are placed automatically near the foot of the chosen page, signer 1 lowest.",
  "Up to 10, each with their own signature box and, unless you untick the option, a date box, all on the one page you choose.",
];

/**
 * The FAQ pairs that answered "No" while the boxes were fixed (tool page and
 * guide), kept as the positive control for the question-answer rule.
 */
const SHIPPED_NO_PAIRS: { question: string; answer: string }[] = [
  {
    question: "Can I drag the boxes somewhere else?",
    answer: SHIPPED[7]!,
  },
  { question: "Can I move the boxes?", answer: SHIPPED[10]! },
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

/**
 * Sign PDF on a /Rotate 90 page: where the editor placed it, as the viewer
 * sees it, upright. Until 2026-10-24 this ran `signPdf` with the form's
 * bottom-right anchor and a 24 pt margin; the page now places a signature by
 * click in the shared editor, so it is that editor's export, with the box a
 * click near the bottom-right would leave (viewer frame, top-left origin).
 */
async function signPlacesInTheDisplayedFrame() {
  const png = encodePng(4, 2, "rgb8", new Uint8Array(4 * 2 * 3).fill(40));
  // Letter turned 90: displayed 792 x 612.
  const box = { x: 792 - 24 - 200, y: 612 - 24 - 100, width: 200, height: 100 };
  const { bytes: out } = await exportEditedPdf(await rotatedPage(90), [
    { id: "s", kind: "signature", page: 0, ...box, format: "png", bytes: png },
  ]);
  const read = await readAsViewer(out);
  // Health: the page is displayed turned, and the reader found the image.
  expect(read.width).toBeGreaterThan(read.height);
  expect(read.imageFrames.length).toBe(1);
  const img = read.imageFrames[0]!;
  expect(img.upright).toBe(true);
  expect(Math.abs(img.box[2] - (read.width - 24))).toBeLessThan(0.5);
  expect(Math.abs(img.box[1] - 24)).toBeLessThan(0.5);
}

type RequestField = ReturnType<typeof signatureBlockFields>[number];

/**
 * Run `fields` through the real engine on `pdf` and read each field back as a
 * viewer displays it: its rect in the viewport (y down from the top), and its
 * widget rotation against the page's.
 */
async function requestAsViewed(pdf: Uint8Array, fields: RequestField[]) {
  const run = await runSignatureRequest(
    pdf,
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
    const annotations = (await page.getAnnotations()) as {
      rect: [number, number, number, number];
      rotation: number;
    }[];
    const [a, b, c, d, e, f] = viewport.transform as number[];
    return {
      rotate: page.rotate,
      width: viewport.width,
      height: viewport.height,
      boxes: annotations.map((ann) => {
        const xs = [ann.rect[0], ann.rect[2]];
        const ys = [ann.rect[1], ann.rect[3]];
        const vx = xs.flatMap((x) => ys.map((y) => a! * x + c! * y + e!));
        const vy = xs.flatMap((x) => ys.map((y) => b! * x + d! * y + f!));
        return {
          left: Math.min(...vx),
          right: Math.max(...vx),
          top: Math.min(...vy),
          bottom: Math.max(...vy),
          rotation: ann.rotation,
        };
      }),
    };
  } finally {
    await task.destroy();
  }
}

/** Each requested field sits where it was asked to, as displayed, within `tol` pt. */
function expectPlaced(
  seen: Awaited<ReturnType<typeof requestAsViewed>>,
  fields: RequestField[],
  tol: number,
) {
  expect(seen.boxes, "every field is on the page").toHaveLength(fields.length);
  fields.forEach((field, i) => {
    const box = seen.boxes[i]!;
    // Viewport y runs down from the top; the field's y is up from the bottom.
    expect(Math.abs(box.left - field.x * seen.width)).toBeLessThan(tol);
    expect(
      Math.abs(box.right - (field.x + field.width) * seen.width),
    ).toBeLessThan(tol);
    expect(Math.abs(box.bottom - (1 - field.y) * seen.height)).toBeLessThan(
      tol,
    );
    expect(
      Math.abs(box.top - (1 - field.y - field.height) * seen.height),
    ).toBeLessThan(tol);
    expect(box.rotation, "turned to read upright").toBe(seen.rotate);
  });
}

/**
 * Request Signatures on a /Rotate 90 page: the boxes sit where the panel drew
 * them — the starting block's box, and (since 2026-11-17) an asymmetric one
 * in the top-right corner, which a mapping that swapped or mirrored an axis
 * would put somewhere else.
 */
async function requestPlacesInTheDisplayedFrame() {
  const fields: RequestField[] = [
    ...signatureBlockFields(1, 1, false),
    {
      signer: 0,
      page: 1,
      type: "initials",
      x: 0.85,
      y: 0.9,
      width: 0.1,
      height: 0.05,
      required: true,
    },
  ];
  const seen = await requestAsViewed(await rotatedPage(90), fields);
  expect(seen.rotate).toBe(90);
  expectPlaced(seen, fields, 1.5);
}

/** A /Rotate 90 Letter page with an inset CropBox. */
async function rotatedCroppedPage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(LETTER);
  page.setCropBox(36, 48, 540, 696);
  page.setRotation(degrees(90));
  return doc.save();
}

/**
 * Refutes "the boxes cannot be moved, resized or added" by RUNNING the
 * editor's own operations (`@/lib/signatures/request-layout`): the starting
 * layout, its signature box moved to the top-right, an Initials box added —
 * on a turned, cropped page, through the real engine, read by pdf.js.
 */
async function requestBoxesMoveAndAdd() {
  const pdf = await rotatedCroppedPage();
  const read = await readPdfFrames(pdf);
  const frame = read!.frames[0]!;
  const start = startingLayout([7], 1, false);
  const moved = [moveField(start[0]!, 1, 1, frame)];
  const layout = addField(moved, "initials", 7, 1, frame);
  const fields = toRequestFields(layout, new Map([[7, 0]]));
  // Health: the move did something, and the add added exactly one box.
  expect(fields[0]).not.toEqual(signatureBlockFields(1, 1, false)[0]);
  expect(fields[0]!.x + fields[0]!.width).toBeCloseTo(1, 3);
  expect(fields[0]!.y + fields[0]!.height).toBeCloseTo(1, 3);
  expect(fields).toHaveLength(start.length + 1);
  expect(fields[1]!.type).toBe("initials");
  const seen = await requestAsViewed(pdf, fields);
  expect(seen.rotate).toBe(90);
  expectPlaced(seen, fields, 1);
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
    says: "the boxes cannot be moved, resized or added",
    patterns: [
      /\bplaced automatically\b/i,
      /\bplaced for you\b/i,
      /\bno (?:dragging|drag)\b/i,
      /\bstacks? one\b[^.;]*\bper signer\b/i,
      /\ball on the one page\b/i,
    ],
    refute: requestBoxesMoveAndAdd,
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

/** Every FAQ pair a reader of a Request Signatures page or guide is served. */
function requestFaqs(): { where: string; question: string; answer: string }[] {
  const out: { where: string; question: string; answer: string }[] = [];
  for (const tool of tools)
    if (tool.slug === "request-signatures")
      for (const f of pageFaq(tool))
        out.push({ where: tool.slug, question: f.question, answer: f.answer });
  for (const guide of guides)
    if (guide.tools[0] === "request-signatures")
      for (const f of guide.faq)
        out.push({
          where: `guide ${guide.slug}`,
          question: f.question,
          answer: f.answer,
        });
  return out;
}

/** A question about moving the boxes… */
const ABOUT_MOVING_BOXES =
  /\b(?:drag|move|reposition|resize|place)\b[^?]*\bbox(?:es)?\b/i;
/** …may not be answered "No". */
const ANSWERED_NO = /^No\b/;
const refusesToMove = (f: { question: string; answer: string }) =>
  ABOUT_MOVING_BOXES.test(f.question) && ANSWERED_NO.test(f.answer.trim());

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

  it("no Request Signatures FAQ answers a question about moving the boxes with No", () => {
    // Positive control: the pairs served while the boxes were fixed are caught.
    for (const pair of SHIPPED_NO_PAIRS)
      expect(refusesToMove(pair), pair.question).toBe(true);
    // …and a Yes to the same question is not.
    expect(
      refusesToMove({
        question: SHIPPED_NO_PAIRS[0]!.question,
        answer: "Yes.",
      }),
    ).toBe(false);
    const live = requestFaqs();
    // Health: the tool page and its guide were read, and the rule has
    // questions to ask of (a walk that found none would pass vacuously).
    expect(live.some((f) => f.where === "request-signatures")).toBe(true);
    expect(live.some((f) => f.where.startsWith("guide "))).toBe(true);
    const asked = live.filter((f) => ABOUT_MOVING_BOXES.test(f.question));
    expect(
      asked.length,
      asked.map((f) => f.question).join(" | "),
    ).toBeGreaterThanOrEqual(2);
    const offenders = live
      .filter(refusesToMove)
      .map((f) => `${f.where}: ${f.question} ${f.answer}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

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
