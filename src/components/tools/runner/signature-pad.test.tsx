// @vitest-environment jsdom
/**
 * The pad hands on its INK, not its canvas.
 *
 * `signature-image.test.ts` proves the cropping on pixels. This file proves the
 * pad reaches it: that what a stroke exports is the prepared bitmap — the ink's
 * size — and not the whole 520×180 pad, which is what made the Size control
 * size the canvas instead of the signature (audit at 67e8d0f).
 *
 * jsdom has no canvas, so the 2D context is a recording stand-in: it serves
 * the pixels a real pad would hold after the stroke, and records what the pad
 * encodes. The pixel logic itself runs for real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImageSignature } from "@/lib/pdf/signature";
import { SignaturePad } from "./signature-pad";

const W = 520;
const H = 180;
/** Where the stand-in canvas holds ink after the stroke. */
const INK = { x: 180, y: 60, width: 160, height: 60 };

function padPixels(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = INK.y; y < INK.y + INK.height; y += 1) {
    for (let x = INK.x; x < INK.x + INK.width; x += 1) {
      data.set([15, 23, 42, 255], (y * W + x) * 4);
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SignaturePad", () => {
  it("exports the ink cropped from the pad, not the whole pad", async () => {
    const encoded: { width: number; height: number }[] = [];
    vi.stubGlobal("ImageData", FakeImageData);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        return {
          beginPath() {},
          moveTo() {},
          lineTo() {},
          stroke() {},
          clearRect() {},
          getImageData: () => ({ data: padPixels(), width: W, height: H }),
          putImageData: (img: FakeImageData) => {
            encoded.push({ width: this.width, height: this.height });
            expect([img.width, img.height]).toEqual([this.width, this.height]);
          },
        } as unknown as CanvasRenderingContext2D;
      } as never,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (cb: BlobCallback) {
        cb(
          new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
        );
      },
    );

    const onChange = vi.fn<(s: ImageSignature | null) => void>();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByLabelText("Signature drawing area");
    // Health: the stand-in really is the pad's full backing store.
    expect([
      (canvas as HTMLCanvasElement).width,
      (canvas as HTMLCanvasElement).height,
    ]).toEqual([W, H]);

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const signature = onChange.mock.calls.at(-1)![0];
    expect(signature).toMatchObject({ kind: "image", format: "png" });
    // What was encoded is the ink plus its small pad — 3 % of 160 px is 5 px.
    expect(encoded).toEqual([
      { width: INK.width + 10, height: INK.height + 10 },
    ]);
  });
});
