// @vitest-environment jsdom
/**
 * What the Extract Images user is TOLD, read from the rendered runner and fed
 * by the real extractor, never by a hand-built result object.
 *
 * Found 2026-09-27, three ways the screen disagreed with the PDF:
 *
 *  - a PDF whose only image was written inline (`BI … ID … EI`) came back
 *    `{ images: 0, skipped: 0 }`, and the runner said, as a fact, "found no
 *    embedded raster images in this PDF";
 *  - an image whose transparency could not be kept (a JPEG with a soft mask)
 *    was handed over opaque, and nothing on screen said so;
 *  - the "Honest about limits" tile said palette (indexed) images could not be
 *    recovered, which stops being true in the same change that lets the
 *    extractor recover them.
 *
 * Each case here builds a real PDF, runs it through `extractPdfImages` (or the
 * runner's own button, which imports it), and asserts on the DOM a user reads.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PDFArray, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { extractPdfImages } from "@/lib/pdf/extract-images";
import {
  ExtractImagesEditor,
  ExtractionResult,
  type Extraction,
} from "./extract-images-runner";
import type { LoadedPdf } from "./use-single-pdf";

const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

beforeAll(() => {
  // jsdom has no object URLs; the preview grid only needs a string back.
  URL.createObjectURL ??= () => "blob:preview";
  URL.revokeObjectURL ??= () => undefined;
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

function loaded(bytes: Uint8Array): LoadedPdf {
  return {
    file: new File([Buffer.from(bytes)], "input.pdf", {
      type: "application/pdf",
    }),
    bytes,
    pageCount: 1,
    rotations: [0],
  };
}

async function showResult(bytes: Uint8Array) {
  const extracted = await extractPdfImages(bytes);
  const result: Extraction = {
    ...extracted,
    totalBytes: extracted.images.reduce((n, i) => n + i.bytes.byteLength, 0),
  };
  render(
    <ExtractionResult
      pdf={loaded(bytes)}
      result={result}
      onReset={() => undefined}
      onStartOver={() => undefined}
    />,
  );
  return extracted;
}

async function pageWithContent(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(
      doc.context.flateStream(Uint8Array.from(Buffer.from(content, "latin1"))),
    ),
  );
  return doc.save();
}

describe("Extract Images, as the user reads it", () => {
  it("an inline-only PDF is reported as having images in an unsupported form", async () => {
    const hex = "7f".repeat(4 * 4 * 3);
    const extracted = await showResult(
      await pageWithContent(
        `q 40 0 0 40 10 10 cm BI /W 4 /H 4 /CS /RGB /BPC 8 /F /AHx ID ${hex}> EI Q`,
      ),
    );
    // Health check: the extractor saw it, so the screen has something to say.
    expect(extracted.skipped).toHaveLength(1);

    const panel = screen.getByRole("group", {
      name: "No extractable images found",
    });
    expect(panel).toHaveTextContent(/formats this tool doesn't recover yet/);
    expect(panel).toHaveTextContent(/Inline image/);
  });

  it("a PDF with no image objects is not told, as fact, that it has no images", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText("only text here");
    const extracted = await showResult(await doc.save());
    expect(extracted.images).toHaveLength(0);
    expect(extracted.skipped).toHaveLength(0);

    const panel = screen.getByRole("group", {
      name: "No extractable images found",
    });
    expect(panel).toHaveTextContent(/No image objects were found/);
    expect(panel).toHaveTextContent(/vector graphics/);
    expect(
      within(panel).getByRole("link", { name: "PDF to PNG" }),
    ).toHaveAttribute("href", "/tools/pdf-to-png");
  });

  it("an image saved without its transparency is flagged by name, and not as skipped", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const jpeg = ctx.stream(JPG_1X1, {
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    });
    jpeg.dict.set(
      PDFName.of("SMask"),
      ctx.register(
        ctx.flateStream(Uint8Array.from([0]), {
          Type: "XObject",
          Subtype: "Image",
          Width: 1,
          Height: 1,
          ColorSpace: "DeviceGray",
          BitsPerComponent: 8,
        }),
      ),
    );
    doc
      .addPage([100, 100])
      .node.setXObject(PDFName.of("Im0"), ctx.register(jpeg));
    const extracted = await showResult(await doc.save());
    const note = extracted.images[0]?.note;
    expect(note).toBeTruthy();

    expect(screen.getByText(/1 image saved with a caveat/)).toBeInTheDocument();
    expect(screen.getByText(`${note}.`)).toBeInTheDocument();
    expect(screen.getByText("page-001-image-001.jpg")).toBeInTheDocument();
    // It was extracted, so it must not be double-counted as skipped.
    expect(screen.queryByText(/skipped/)).toBeNull();
  });

  it("positive control: an image with nothing to disclose shows no caveat", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const image = ctx.flateStream(Uint8Array.from([1, 2, 3]), {
      Type: "XObject",
      Subtype: "Image",
      Width: 1,
      Height: 1,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
    });
    doc
      .addPage([100, 100])
      .node.setXObject(PDFName.of("Im0"), ctx.register(image));
    await showResult(await doc.save());
    expect(screen.getByText("1 image extracted")).toBeInTheDocument();
    expect(screen.queryByText(/caveat/)).toBeNull();
  });

  it("a palette image goes through the runner's own button, and the limits tile no longer disowns palettes", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const cs = PDFArray.withContext(ctx);
    cs.push(PDFName.of("Indexed"));
    cs.push(PDFName.of("DeviceRGB"));
    cs.push(ctx.obj(1));
    cs.push(PDFHexString.of("ff00000000ff"));
    const image = ctx.flateStream(Uint8Array.from([0, 1]), {
      Type: "XObject",
      Subtype: "Image",
      Width: 2,
      Height: 1,
      BitsPerComponent: 8,
    });
    image.dict.set(PDFName.of("ColorSpace"), cs);
    doc
      .addPage([100, 100])
      .node.setXObject(PDFName.of("Im0"), ctx.register(image));
    const bytes = await doc.save();

    render(
      <ExtractImagesEditor pdf={loaded(bytes)} onReset={() => undefined} />,
    );
    // The tile renders before the run; it is the claim the run must not refute.
    const limits = screen.getByText("Honest about limits").parentElement!;
    expect(limits).toHaveTextContent(/listed as skipped/);
    expect(limits).not.toHaveTextContent(/palette|indexed/i);

    fireEvent.click(screen.getByRole("button", { name: /extract images/i }));
    expect(await screen.findByText("1 image extracted")).toBeInTheDocument();
    expect(screen.queryByText(/skipped/)).toBeNull();
  });
});
