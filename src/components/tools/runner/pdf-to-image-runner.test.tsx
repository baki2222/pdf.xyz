// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { rasterCapNote, resolutionById } from "@/lib/pdf/pdf-to-image";
import type { RasterPage } from "@/lib/pdf/render";
import { RASTER_MAX_DEVICE_PX, rasterPageScale } from "@/lib/pdf/render-utils";
import { ImageResult } from "./pdf-to-image-runner";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";

/**
 * The PDF → PNG / JPG result panel, as a person reads it. A page too large for
 * the chosen preset is rendered below it (the rasterizer's pixel cap), and the
 * panel used to name only the preset — "Print · 4.1 MB · bundled as a ZIP" —
 * over an A2 drawing delivered at 213 DPI.
 *
 * The pages here are built BY HAND from `rasterPageScale`, so this file proves
 * the panel, not the engine's hand-off to it. A comment once claimed they were
 * "built the way rasterizePdf builds them", and review kept every test here
 * green while `rasterizePdf` dropped `dpiCapped`. The composed chain — the
 * real `rasterizePdf`, the note, the downloaded PNG's pixel size — is proved
 * in pdf-to-image-chain.test.tsx.
 */

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:pdf-to-image-test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
});

const SIZES = {
  Letter: [612, 792],
  A2: [1190.55, 1683.78],
} as const;

function rendered(
  sizes: (keyof typeof SIZES)[],
  presetId: string,
): RasterPage[] {
  const preset = resolutionById(presetId);
  return sizes.map((size, index) => {
    const [pageWidth, pageHeight] = SIZES[size];
    const { scale, dpi, dpiCapped } = rasterPageScale(
      pageWidth,
      pageHeight,
      preset.dpi,
    );
    return {
      index,
      bytes: new Uint8Array([index]),
      width: Math.floor(pageWidth * scale),
      height: Math.floor(pageHeight * scale),
      pageWidth,
      pageHeight,
      dpi,
      dpiCapped,
      undecodedImages: 0,
    };
  });
}

function mount(pages: RasterPage[], presetId: string) {
  const preset = resolutionById(presetId);
  render(
    <ImageResult
      pdf={{
        file: new File([new Uint8Array([1])], "plans.pdf"),
        bytes: new Uint8Array([1]),
        pageCount: pages.length,
        rotations: pages.map(() => 0 as const),
        digitalSignatures: countDigitalSignatures(new Uint8Array([1])),
      }}
      format="png"
      result={{
        pages,
        totalBytes: pages.length,
        zip: pages.length > 1,
        resolutionId: preset.id,
        resolutionLabel: preset.label,
        dpi: preset.dpi,
        grayscale: false,
        documentPages: pages.length,
      }}
      onReset={() => {}}
      onStartOver={() => {}}
    />,
  );
}

describe("PDF to image result — the DPI the pages actually have", () => {
  it("an A2 sheet at Print says it came out below 300 DPI, and by how much", async () => {
    const pages = rendered(["Letter", "A2"], "print");
    mount(pages, "print");
    const note = rasterCapNote(pages, 300, RASTER_MAX_DEVICE_PX);
    expect(note).not.toBeNull();
    expect(await screen.findByText(note!)).toBeVisible();
    expect(screen.getByText(/1 of 2 pages/)).toHaveTextContent(/213 DPI/);
  });

  it("control: Letter pages at Print say nothing about a cap", async () => {
    mount(rendered(["Letter", "Letter"], "print"), "print");
    await screen.findByRole("button", { name: /download zip/i });
    expect(screen.queryByText(/too large for/i)).toBeNull();
  });

  it("control: the same A2 sheet at High fits, and says nothing", async () => {
    mount(rendered(["A2"], "high"), "high");
    await screen.findByRole("button", { name: /download png/i });
    expect(screen.queryByText(/too large for/i)).toBeNull();
  });
});
