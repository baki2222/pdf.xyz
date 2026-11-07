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
import { SIGNATURE_INKS, inkRgb } from "@/lib/pdf/editor/signature-ink";
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

/*
 * The pad's INK (audit sign-pdf#2; review 2026-11-08: nothing went through
 * the pad — strokes, the recolour and the export tint could all be black
 * and every test stayed green).
 *
 * This stand-in is a tiny canvas: `stroke()` paints the ink box in the
 * CURRENT `strokeStyle`, with a ring of faint edge pixels whose colour is
 * a little off — what a real canvas returns for low-alpha anti-aliasing
 * once `getImageData` un-premultiplies it — and a `source-in` `fillRect`
 * recolours what is drawn in the current `fillStyle`, keeping alpha.
 */
describe("SignaturePad ink", () => {
  const ink = (label: string) => SIGNATURE_INKS.find((i) => i.label === label)!;

  function canvasStandIn() {
    const pixels = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
    const encoded: Uint8ClampedArray[] = [];
    const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    const of = (c: HTMLCanvasElement) => {
      if (!pixels.has(c))
        pixels.set(c, new Uint8ClampedArray(c.width * c.height * 4));
      return pixels.get(c)!;
    };
    vi.stubGlobal("ImageData", FakeImageData);
    // One context per canvas, as a real canvas keeps: its styles persist.
    const contextFor = (canvas: HTMLCanvasElement) => {
      const cached = contexts.get(canvas);
      if (cached) return cached;
      const ctx = {
        strokeStyle: "#000000",
        fillStyle: "#000000",
        globalCompositeOperation: "source-over",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        stack: [] as string[],
        save() {
          ctx.stack.push(ctx.globalCompositeOperation);
        },
        restore() {
          ctx.globalCompositeOperation = ctx.stack.pop() ?? "source-over";
        },
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {
          const data = of(canvas);
          const [r, g, b] = inkRgb(ctx.strokeStyle);
          for (let y = INK.y - 1; y <= INK.y + INK.height; y += 1) {
            for (let x = INK.x - 1; x <= INK.x + INK.width; x += 1) {
              const edge =
                y < INK.y ||
                x < INK.x ||
                y === INK.y + INK.height ||
                x === INK.x + INK.width;
              data.set(
                edge ? [r + 6, g + 6, b + 6, 40] : [r, g, b, 255],
                (y * canvas.width + x) * 4,
              );
            }
          }
        },
        fillRect() {
          if (ctx.globalCompositeOperation !== "source-in") return;
          const data = of(canvas);
          const [r, g, b] = inkRgb(ctx.fillStyle);
          for (let i = 0; i < data.length; i += 4)
            if (data[i + 3]! > 0) data.set([r, g, b], i);
        },
        clearRect() {
          of(canvas).fill(0);
        },
        getImageData: () => ({
          data: new Uint8ClampedArray(of(canvas)),
          width: canvas.width,
          height: canvas.height,
        }),
        putImageData: (img: FakeImageData) => {
          encoded.push(new Uint8ClampedArray(img.data));
        },
      };
      const typed = ctx as unknown as CanvasRenderingContext2D;
      contexts.set(canvas, typed);
      return typed;
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        return contextFor(this);
      } as never,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (cb: BlobCallback) {
        cb(
          new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
        );
      },
    );
    return { encoded, pixelsOf: of };
  }

  /** Every distinct RGB among pixels with any alpha. */
  function inkColours(data: Uint8ClampedArray): string[] {
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3]! > 0)
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return [...seen];
  }
  const rgbOf = (hex: string) => inkRgb(hex).join(",");

  it("strokes in the chosen ink, exports exactly that ink, and a new ink recolours the drawing", async () => {
    const { encoded, pixelsOf } = canvasStandIn();
    const blue = ink("Blue").hex;
    const red = ink("Red").hex;
    const onChange = vi.fn<(s: ImageSignature | null) => void>();
    const { rerender } = render(
      <SignaturePad onChange={onChange} ink={blue} />,
    );
    const canvas = screen.getByLabelText(
      "Signature drawing area",
    ) as HTMLCanvasElement;

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas);
    await vi.waitFor(() => expect(encoded).toHaveLength(1));

    // On screen: the stroke is blue at its core.
    const drawn = inkColours(pixelsOf(canvas));
    expect(drawn).toContain(rgbOf(blue));
    // Health: the stand-in's faint edge is off-colour, as a real canvas is.
    expect(drawn.length).toBeGreaterThan(1);
    // Exported: every inked pixel is exactly blue, the faint ones included.
    expect(inkColours(encoded[0]!)).toEqual([rgbOf(blue)]);
    expect(encoded[0]!.some((v, i) => i % 4 === 3 && v > 0 && v < 255)).toBe(
      true,
    );
    await vi.waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "image" }),
    );
    const calls = onChange.mock.calls.length;

    // A new ink: what is drawn turns red, and is exported again in red.
    rerender(<SignaturePad onChange={onChange} ink={red} />);
    await vi.waitFor(() => expect(encoded).toHaveLength(2));
    expect(inkColours(pixelsOf(canvas))).toEqual([rgbOf(red)]);
    expect(inkColours(encoded[1]!)).toEqual([rgbOf(red)]);
    await vi.waitFor(() =>
      expect(onChange.mock.calls.length).toBeGreaterThan(calls),
    );
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ kind: "image" });

    // And the next stroke is drawn in the new ink, not the old one.
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 30 });
    fireEvent.pointerUp(canvas);
    await vi.waitFor(() => expect(encoded).toHaveLength(3));
    const redrawn = inkColours(pixelsOf(canvas));
    expect(redrawn).toContain(rgbOf(red));
    expect(redrawn).not.toContain(rgbOf(blue));
  });
});
