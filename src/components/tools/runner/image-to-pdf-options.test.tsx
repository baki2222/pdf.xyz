// @vitest-environment jsdom
/**
 * The image runner's wave-3 controls (audit 2026-11-06, lane w3-l05), each
 * read from the file Download PDF hands over — not from the engine call. The
 * engine's own behaviour is held beside it (image-rotation.test.ts and the
 * others named per block).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { apply, boxOf, drawnImages } from "@/tests/drawn-images";
import { JPEG_30X20, JPEG_HEIGHT, JPEG_WIDTH } from "@/tests/jpeg-fixtures";
import { withAppRouter } from "@/tests/app-router";
import { IMAGE_ROTATION_LABELS } from "@/lib/pdf/image-rotation";
import {
  SMALL_IMAGES_CHOICES,
  SMALL_IMAGES_LABELS,
} from "@/lib/pdf/image-enlarge";

import { ImageToPdfRunner } from "./image-to-pdf-runner";

const URL_STATICS = ["createObjectURL", "revokeObjectURL"] as const;
const original = URL_STATICS.map(
  (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
);

afterEach(() => {
  cleanup();
  resetAnnouncer();
  vi.restoreAllMocks();
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

const jpeg = (name: string, bytes: Uint8Array = JPEG_30X20) =>
  new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });

/** Mount the runner and add files, waiting until each is listed. */
async function mount(files: File[], kind: "jpg" | "png" = "jpg") {
  const { container } = render(withAppRouter(<ImageToPdfRunner kind={kind} />));
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files },
  });
  for (const f of files) {
    await screen.findByText(f.name, undefined, { timeout: 4_000 });
  }
  return container;
}

/** Create the PDF, press Download PDF, and return the downloaded bytes. */
async function createAndDownload(): Promise<Uint8Array> {
  const blobs: Blob[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return "blob:image-options-test";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: /Create PDF/ }));
  const download = await screen.findByRole(
    "button",
    { name: /Download PDF/ },
    { timeout: 5_000 },
  );
  fireEvent.click(download);
  await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
  return new Uint8Array(await blobs.at(-1)!.arrayBuffer());
}

/** Each page's size, and where its image's stored top-left corner landed. */
async function pages(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  const images = await drawnImages(pdf);
  return doc.getPages().map((page, i) => {
    const image = images.find((d) => d.page === i)!;
    const { width, height } = page.getSize();
    const [x, y] = apply(image.ctm, 0, 1).map((n) => Math.round(n) + 0);
    return { width, height, x, y };
  });
}

/** Audit png-to-pdf#2: a Rotate button on each card turns that image only. */
describe("image to PDF · Rotate on a card", () => {
  it("is a named button on every card, and turns only its own image", async () => {
    await mount([jpeg("one.jpg"), jpeg("two.jpg")]);
    fireEvent.click(screen.getByRole("button", { name: "Fit to image" }));
    const rotateTwo = screen.getByRole("button", {
      name: IMAGE_ROTATION_LABELS.aria("two.jpg"),
    });
    expect(rotateTwo).toHaveAttribute("title", IMAGE_ROTATION_LABELS.button);
    expect(
      screen.getByRole("button", {
        name: IMAGE_ROTATION_LABELS.aria("one.jpg"),
      }),
    ).toBeInTheDocument();
    fireEvent.click(rotateTwo);
    const [one, two] = await pages(await createAndDownload());
    // Fit to image keeps the default Large margin: subtract it on each side.
    const m = (one!.width - JPEG_WIDTH) / 2;
    expect(one).toMatchObject({ x: m, y: JPEG_HEIGHT + m });
    // A quarter turn clockwise: portrait page, top-left corner now top-right.
    expect(two!.height).toBeGreaterThan(two!.width);
    expect(two).toMatchObject({ x: JPEG_HEIGHT + m, y: JPEG_WIDTH + m });
  });

  it("says the turn on the card, and four presses come back upright", async () => {
    await mount([jpeg("one.jpg")]);
    const rotate = screen.getByRole("button", {
      name: IMAGE_ROTATION_LABELS.aria("one.jpg"),
    });
    fireEvent.click(rotate);
    expect(screen.getByText(/· 90°/)).toBeInTheDocument();
    fireEvent.click(rotate);
    fireEvent.click(rotate);
    fireEvent.click(rotate);
    expect(screen.queryByText(/°/)).toBeNull();
  });
});

/** Audits jpg-to-pdf#4 / png-to-pdf#4: Small images, Keep size or Enlarge. */
describe("image to PDF · Small images", () => {
  const group = () =>
    screen.getByRole("group", { name: SMALL_IMAGES_LABELS.heading });
  const chip = (id: string) =>
    within(group()).getByRole("button", {
      name: SMALL_IMAGES_CHOICES.find((c) => c.id === id)!.label,
    });
  const imageWidth = async (pdf: Uint8Array) => {
    const b = boxOf((await drawnImages(pdf))[0]!.ctm);
    return b.x1 - b.x0;
  };

  it("starts on Keep size, and the small photo stays its own size", async () => {
    await mount([jpeg("small.jpg")]);
    fireEvent.click(screen.getByRole("button", { name: "A4" }));
    expect(chip("keep")).toHaveAttribute("aria-pressed", "true");
    expect(await imageWidth(await createAndDownload())).toBeCloseTo(
      JPEG_WIDTH,
      6,
    );
  });

  it("Enlarge to fit scales the photo up to the margin in the downloaded PDF", async () => {
    await mount([jpeg("small.jpg")]);
    fireEvent.click(screen.getByRole("button", { name: "A4" }));
    fireEvent.click(chip("enlarge"));
    expect(chip("enlarge")).toHaveAttribute("aria-pressed", "true");
    const pdf = await createAndDownload();
    const page = (await PDFDocument.load(pdf)).getPage(0).getSize();
    expect(await imageWidth(pdf)).toBeGreaterThan(page.width / 2);
  });

  it("is switched off, with a note, under Fit to image", async () => {
    await mount([jpeg("small.jpg")]);
    fireEvent.click(screen.getByRole("button", { name: "Fit to image" }));
    expect(chip("enlarge")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(SMALL_IMAGES_LABELS.fitNote)).toBeInTheDocument();
  });
});
