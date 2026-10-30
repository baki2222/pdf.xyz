// @vitest-environment jsdom
// @native-canvas
/**
 * Sign PDF's signature panel, driven the way a person drives it.
 *
 * SINCE 2026-10-24 Sign PDF opens the shared editor on its Sign tool, and the
 * signature is made in its panel (`editor/signature-panel.tsx`): the sources
 * are tabs, not radios, and the panel's "Use signature" hands the signature
 * to the page, where the form's "Sign PDF" button used to place it. The three
 * properties below are the form's, kept and driven through the panel.
 *
 * The audit (at 67e8d0f): switching from Draw to another source and back
 * remounted the signature pad empty, while the drawing it had exported stayed
 * the active signature — so the pad showed nothing, its Clear button was
 * disabled, and Run would still place the old drawing. The pad now stays
 * mounted (hidden) while another source is shown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { withAppRouter } from "@/tests/app-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { SignRunner } from "./sign-runner";

// The router comes from its context (`withAppRouter`), not a module mock:
// under isolate:false a runner another file imported first stays cached bound
// to the real `next/navigation`, and a mock here would never reach it.

afterEach(() => {
  cleanup();
});

async function openSignRunner() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = await doc.save();
  const file = new File([bytes.slice().buffer], "contract.pdf", {
    type: "application/pdf",
  });
  const { container } = render(withAppRouter(<SignRunner />));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone's file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
  // The editor opens with the signature panel showing.
  await screen.findByRole("tab", { name: "Draw" }, { timeout: 8000 });
}

const source = (name: string) =>
  fireEvent.click(screen.getByRole("tab", { name }));

/** Press "Use signature": the panel's equivalent of the form's Run. */
const useSignature = () =>
  fireEvent.click(screen.getByRole("button", { name: "Use signature" }));

/** The signature is ready to place (the panel closed and says so). */
const placing = () =>
  screen.queryByText("Click on a page to place your signature.") !== null;

describe("Sign PDF signature panel", () => {
  it("keeps the drawing pad — and what is drawn on it — across source switches", async () => {
    await openSignRunner();
    source("Draw");
    const pad = screen.getByLabelText("Signature drawing area");
    expect(pad).toBeVisible();

    source("Type");
    // Still the same element, only hidden: its pixels (and Clear) survive.
    expect(pad.isConnected).toBe(true);
    expect(pad).not.toBeVisible();
    // jsdom's toBeVisible reads the `hidden` ATTRIBUTE; a browser applies it
    // through CSS, where a `display: flex` class on the same element competes
    // with it. The hidden wrapper carries no display class at all.
    const hiddenWrapper = pad.closest("[hidden]");
    expect(hiddenWrapper, "the pad's hidden wrapper").not.toBeNull();
    expect(hiddenWrapper!.className).not.toMatch(/\b(flex|grid|block)\b/);

    source("Draw");
    expect(screen.getByLabelText("Signature drawing area")).toBe(pad);
    expect(pad).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 *  An uploaded photo, through the runner's real decode and encode
 * ------------------------------------------------------------------ */

/**
 * jsdom has no image decoder and no canvas. These stand-ins serve what a
 * browser would — a phone photo's pixels at whatever size the runner asks to
 * draw it — and record what the runner decodes at and encodes. The pixel logic
 * between the two (`signature-image.ts`) runs for real.
 */
const PHOTO = { width: 8000, height: 6000 };
/** Ink as a fraction of the photo, so it lands the same at any decode size. */
const INK_FRAC = { x: 0.25, y: 0.4, width: 0.5, height: 0.1 };

function photoPixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const x0 = Math.round(width * INK_FRAC.x);
  const x1 = Math.round(width * (INK_FRAC.x + INK_FRAC.width));
  const y0 = Math.round(height * INK_FRAC.y);
  const y1 = Math.round(height * (INK_FRAC.y + INK_FRAC.height));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ink = x >= x0 && x < x1 && y >= y0 && y < y1;
      data.set(
        ink ? [20, 40, 160, 255] : [190, 188, 184, 255],
        (y * width + x) * 4,
      );
    }
  }
  return data;
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

/** The photo the NEXT decode will see; a test may swap it between uploads. */
let photo = { ...PHOTO };
/** When set, decodes wait here until the test releases them. */
let held: (() => void)[] | null = null;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = photo.width;
  naturalHeight = photo.height;
  width = photo.width;
  height = photo.height;
  set src(_: string) {
    const load = () => this.onload?.();
    if (held) held.push(load);
    else queueMicrotask(load);
  }
}

function stubBrowserImaging() {
  const decodedAt: { width: number; height: number }[] = [];
  const encoded: { width: number; height: number; type: string }[] = [];
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("ImageData", FakeImageData);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stub");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        drawImage: (_img: unknown, _x: number, _y: number, w = 0, h = 0) => {
          decodedAt.push({ width: w, height: h });
          expect([w, h]).toEqual([this.width, this.height]);
        },
        getImageData: () => ({
          data: photoPixels(this.width, this.height),
          width: this.width,
          height: this.height,
        }),
        putImageData: () => {},
      } as unknown as CanvasRenderingContext2D;
    } as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
  ) {
    encoded.push({
      width: this.width,
      height: this.height,
      type: type ?? "image/png",
    });
    cb(new Blob([new Uint8Array([1, 2, 3])], { type }));
  });
  return { decodedAt, encoded };
}

/** Width / height of what was encoded, for an upload of `p` (see INK_FRAC). */
const encodedAspect = (p: { width: number; height: number }) => {
  const scale = 3000 / Math.max(p.width, p.height);
  const w = p.width * scale * INK_FRAC.width;
  const h = p.height * scale * INK_FRAC.height;
  const pad = Math.max(w, h) * 0.03;
  return (w + 2 * pad) / (h + 2 * pad);
};

const uploadSignature = (name: string) => {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Create a signature"] input[type="file"]',
  );
  expect(input, "the signature image input").not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        new File([new Uint8Array([0xff, 0xd8])], name, { type: "image/jpeg" }),
      ],
    },
  });
};

describe("Sign PDF, uploading a phone photo of a signature", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    photo = { ...PHOTO };
    held = null;
  });

  // Its own waits are bounded at 5 s each (four of them), so vitest's 5 s
  // default for the whole test could not hold them: on CI's loaded runner it
  // timed out three times in a week (2026-10-24 to 10-30, PRs #211 #225),
  // always at the test level, never at a wait. 30 s, as #189 gave its peers.
  it("a second upload replaces the first — even if the paper toggle moves while it decodes", async () => {
    await openSignRunner();
    const { encoded } = stubBrowserImaging();
    source("Upload");
    uploadSignature("first.jpg");
    const keep = await screen.findByRole("checkbox", {
      name: "Remove paper background",
    });
    await vi.waitFor(() => expect(encoded.length).toBe(1), { timeout: 5000 });
    expect(encoded[0]!.width / encoded[0]!.height).toBeCloseTo(
      encodedAspect(PHOTO),
      1,
    );
    // WAS: the form's "Sign PDF" button, blocked by aria-disabled until a
    // signature existed. Now "Use signature" refuses with a message when there
    // is no prepared picture — read before pressing it for real, below.

    // A different photo, whose decode the test holds open.
    const second = { width: 4000, height: 4000 };
    expect(encodedAspect(second)).not.toBeCloseTo(encodedAspect(PHOTO), 1);
    photo = second;
    held = [];
    uploadSignature("second.jpg");

    // While it decodes, the FIRST signature must not be the one used.
    await vi.waitFor(() => expect(held!.length).toBe(1), { timeout: 5000 });
    useSignature();
    expect(
      await screen.findByText("Choose a picture of your signature first."),
      "the previous file would have been used",
    ).toBeInTheDocument();
    expect(placing()).toBe(false);

    // The person keeps the paper while the new file is still decoding.
    fireEvent.click(keep);
    const release = held!;
    held = null;
    release.forEach((load) => load());

    // The second file lands, honouring the toggle; the first is not re-encoded.
    await vi.waitFor(() => expect(encoded.length).toBe(2), { timeout: 5000 });
    expect(
      encoded.slice(1).map((e) => ({
        type: e.type,
        aspect: Number((e.width / e.height).toFixed(1)),
      })),
    ).toEqual([
      { type: "image/jpeg", aspect: Number(encodedAspect(second).toFixed(1)) },
    ]);
    // Positive control: once its preview shows, it is the one used.
    await screen.findByAltText("Signature preview");
    useSignature();
    await vi.waitFor(() => expect(placing()).toBe(true), { timeout: 5000 });
  }, 30_000);

  it("decodes at a bounded size, crops to the ink, and keys out the paper — or keeps it as a JPEG", async () => {
    await openSignRunner();
    const { decodedAt, encoded } = stubBrowserImaging();
    source("Upload");
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Create a signature"] input[type="file"]',
    );
    expect(input, "the signature image input").not.toBeNull();
    fireEvent.change(input!, {
      target: {
        files: [
          new File([new Uint8Array([0xff, 0xd8])], "sig.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });

    const keep = await screen.findByRole("checkbox", {
      name: "Remove paper background",
    });
    expect(keep).toBeChecked();

    // Decoded at 3000 px on the long side, not the photo's 8000.
    expect(decodedAt).toEqual([{ width: 3000, height: 2250 }]);

    // Encoded: the ink (1500 × 225 at that size) plus 3 % of 1500 = 45 px on
    // each side, bounded to 1200 px — as a PNG, because the paper is now
    // transparent. The whole photo would have been 3000 × 2250.
    await vi.waitFor(() => expect(encoded.length).toBe(1), { timeout: 5000 });
    const keyed = encoded[0]!;
    expect(keyed.type).toBe("image/png");
    expect(keyed.width).toBe(1200);
    expect(keyed.width / keyed.height).toBeCloseTo((1500 + 90) / (225 + 90), 1);

    // Paper kept: still cropped and bounded, but a JPEG — not a lossless PNG
    // of a photograph.
    fireEvent.click(keep);
    await vi.waitFor(() => expect(encoded.length).toBe(2), { timeout: 5000 });
    expect(encoded[1]).toEqual({ ...keyed, type: "image/jpeg" });
    expect(screen.getByAltText("Signature preview")).toBeInTheDocument();
  });
});
