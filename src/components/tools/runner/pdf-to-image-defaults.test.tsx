// @vitest-environment jsdom
// @native-canvas
/**
 * PDF to Image's smart default and option memory arrive WITH the file, not
 * with the page (`raster-defaults-chunk`): both modules are fetched while
 * the file opens, so the editor's first draw already holds the right chip
 * and its reason. The composed chain, from a file input to the first draw.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { rememberOptions } from "@/lib/intent/option-memory";
import { withAppRouter } from "@/tests/app-router";
import { PdfToImageRunner } from "./pdf-to-image-runner";

afterEach(() => {
  cleanup();
  resetAnnouncer();
  window.localStorage.clear();
});

async function openWith(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  const file = new File([new Uint8Array(await doc.save())], "doc.pdf", {
    type: "application/pdf",
  });
  const { container } = render(
    withAppRouter(<PdfToImageRunner format="png" />),
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await screen.findByRole(
    "button",
    { name: new RegExp(`render ${pages} page`, "i") },
    { timeout: 10_000 },
  );
  return container;
}

const pressed = () =>
  screen
    .getAllByRole("button", { pressed: true })
    .map((b) => b.textContent ?? "");

describe("PDF to Image opens with its defaults already drawn", () => {
  it("a long PDF: Screen, and the reason, on the editor's first draw", async () => {
    const container = await openWith(61);
    expect(container.querySelector("[data-smart-default]")?.textContent).toBe(
      "Screen resolution — this PDF has 61 pages",
    );
    expect(pressed().some((t) => t.startsWith("Screen"))).toBe(true);
  });

  it("a short PDF: the resolution last picked, and no reason line", async () => {
    rememberOptions("pdf-to-image", { resolution: "print" });
    const container = await openWith(2);
    expect(container.querySelector("[data-smart-default]")).toBeNull();
    expect(pressed().some((t) => t.startsWith("Print"))).toBe(true);
  });
});
