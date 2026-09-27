// @vitest-environment jsdom
/**
 * Sign PDF's form, driven the way a person drives it.
 *
 * The audit (at 67e8d0f): switching from Draw to another source and back
 * remounted the signature pad empty, while the drawing it had exported stayed
 * the active signature — so the pad showed nothing, its Clear button was
 * disabled, and Run would still place the old drawing. The pad now stays
 * mounted (hidden) while another source is shown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { SignRunner } from "./sign-runner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/tools/sign-pdf",
  useSearchParams: () => new URLSearchParams(),
}));

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
  const { container } = render(<SignRunner />);
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input, "the dropzone's file input").not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
  await screen.findByText("Signature", {}, { timeout: 5000 });
}

const source = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name }));

describe("Sign PDF form", () => {
  it("keeps the drawing pad — and what is drawn on it — across source switches", async () => {
    await openSignRunner();
    source("Draw");
    const pad = screen.getByLabelText("Signature drawing area");
    expect(pad).toBeVisible();

    source("Type");
    // Still the same element, only hidden: its pixels (and Clear) survive.
    expect(pad.isConnected).toBe(true);
    expect(pad).not.toBeVisible();

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

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = PHOTO.width;
  naturalHeight = PHOTO.height;
  width = PHOTO.width;
  height = PHOTO.height;
  set src(_: string) {
    queueMicrotask(() => this.onload?.());
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

describe("Sign PDF, uploading a phone photo of a signature", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("decodes at a bounded size, crops to the ink, and keys out the paper — or keeps it as a JPEG", async () => {
    await openSignRunner();
    const { decodedAt, encoded } = stubBrowserImaging();
    source("Upload");
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="image"]',
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
    await vi.waitFor(() => expect(encoded.length).toBe(1));
    const keyed = encoded[0]!;
    expect(keyed.type).toBe("image/png");
    expect(keyed.width).toBe(1200);
    expect(keyed.width / keyed.height).toBeCloseTo((1500 + 90) / (225 + 90), 1);

    // Paper kept: still cropped and bounded, but a JPEG — not a lossless PNG
    // of a photograph.
    fireEvent.click(keep);
    await vi.waitFor(() => expect(encoded.length).toBe(2));
    expect(encoded[1]).toEqual({ ...keyed, type: "image/jpeg" });
    expect(screen.getByAltText("Signature preview")).toBeInTheDocument();
  });
});
