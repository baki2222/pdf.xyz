// @vitest-environment jsdom
/**
 * Photo details (audit jpg-to-pdf#5, 2026-11-07): the runner offers Remove
 * (the default) and Keep, and the downloaded PDF holds what was chosen. Read
 * from the file Download PDF hands over, not from the engine call: the
 * engine's own behaviour is held by image-to-pdf.test.ts ("photo details").
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
import { resetAnnouncer } from "@/components/a11y/live-region";
import { JPEG_30X20, spliceAfterSoi } from "@/tests/jpeg-fixtures";
import { withAppRouter } from "@/tests/app-router";
import {
  PHOTO_DETAILS_CHOICES,
  PHOTO_DETAILS_LABELS,
} from "@/lib/pdf/image-page-layout";
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

const GPS = "GPS 23.8103N 90.4125E";
/** A JPEG carrying a recognisable location string in a comment segment. */
const PHOTO = spliceAfterSoi(
  JPEG_30X20,
  new Uint8Array([0xff, 0xfe, 0, GPS.length + 2, ...Buffer.from(GPS)]),
);

async function mount() {
  const { container } = render(withAppRouter(<ImageToPdfRunner kind="jpg" />));
  const file = new File([new Uint8Array(PHOTO)], "phone.jpg", {
    type: "image/jpeg",
  });
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await screen.findByText("phone.jpg", undefined, { timeout: 4_000 });
  return screen.getByRole("group", { name: PHOTO_DETAILS_LABELS.heading });
}

const chip = (group: HTMLElement, id: string) =>
  within(group).getByRole("button", {
    name: PHOTO_DETAILS_CHOICES.find((c) => c.id === id)!.label,
  });

/** Create the PDF, press Download PDF, and return the downloaded bytes. */
async function createAndDownload(): Promise<Buffer> {
  const blobs: Blob[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return "blob:photo-details-test";
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
  return Buffer.from(await blobs.at(-1)!.arrayBuffer());
}

describe("JPG to PDF · photo location & camera details", () => {
  it("offers Remove, pressed by default, and the PDF carries no location", async () => {
    const group = await mount();
    expect(chip(group, "remove")).toHaveAttribute("aria-pressed", "true");
    expect(chip(group, "keep")).toHaveAttribute("aria-pressed", "false");
    const pdf = await createAndDownload();
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.includes(Buffer.from(GPS, "latin1"))).toBe(false);
  });

  it("Keep puts the JPEG in with its location details", async () => {
    const group = await mount();
    fireEvent.click(chip(group, "keep"));
    expect(chip(group, "keep")).toHaveAttribute("aria-pressed", "true");
    const pdf = await createAndDownload();
    expect(pdf.includes(Buffer.from(GPS, "latin1"))).toBe(true);
  });
});
