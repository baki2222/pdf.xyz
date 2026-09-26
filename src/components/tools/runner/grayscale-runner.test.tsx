// @vitest-environment jsdom
/**
 * What the Grayscale PDF result screen tells a reader about size.
 *
 * Grayscale rebuilds every page as a JPEG, so a text PDF comes back far larger
 * than it went in: audited at 67e8d0f through the same pdf.js + JPEG q=0.88
 * pipeline, 13,707 bytes became 4,245,048 at the default 150 DPI (x310). The
 * result screen said only `10 pages rasterized · 4.0 MB` — the new size with
 * nothing to compare it to — while Compress PDF's related band and the
 * compress guide were sending readers here to make files SMALLER.
 *
 * So the screen owes the reader both numbers, and a reason when the second is
 * bigger. The editor is rendered for real, and only the canvas-bound engine
 * call is replaced (jsdom has no rasterizer): the sizes asserted are the ones
 * the editor reads from the loaded file and the engine's bytes, through the
 * same ResultPanel a user sees.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { formatBytes } from "@/lib/utils";
import type { LoadedPdf } from "./use-single-pdf";

const engine = vi.hoisted(() => ({ outputBytes: 0 }));

vi.mock("@/lib/pdf/grayscale", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf/grayscale")>();
  return {
    ...actual,
    grayscalePdf: async () => ({
      bytes: new Uint8Array(engine.outputBytes),
      pageCount: 10,
      totalImageBytes: engine.outputBytes,
      undecodedImages: 0,
    }),
  };
});

const { GrayscaleEditor } = await import("./grayscale-runner");
const { GRAYSCALE_GREW_NOTE } = await import("@/lib/pdf/grayscale");

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

function loaded(inputBytes: number): LoadedPdf {
  return {
    file: new File([new Uint8Array(inputBytes)], "report.pdf", {
      type: "application/pdf",
    }),
    bytes: new Uint8Array(0),
    pageCount: 10,
    rotations: Array.from({ length: 10 }, () => 0 as const),
  };
}

async function resultText(inputBytes: number, outputBytes: number) {
  engine.outputBytes = outputBytes;
  render(<GrayscaleEditor pdf={loaded(inputBytes)} onReset={() => {}} />);
  fireEvent.click(
    screen.getByRole("button", { name: /convert to grayscale/i }),
  );
  const panel = await waitFor(() =>
    screen.getByRole("group", { name: /grayscale pdf ready/i }),
  );
  return panel.textContent ?? "";
}

describe("the grayscale result screen states the size change", () => {
  it("a text PDF that grew shows both sizes and says why", async () => {
    const text = await resultText(13_707, 4_245_048);
    const before = text.indexOf(formatBytes(13_707));
    const after = text.indexOf(formatBytes(4_245_048));
    expect(before, `input size missing from: ${text}`).toBeGreaterThan(-1);
    expect(after, `output size missing from: ${text}`).toBeGreaterThan(before);
    expect(text).toContain(GRAYSCALE_GREW_NOTE);
  });

  it("a file that shrank shows both sizes and no warning", async () => {
    // Negative control: a scan at high resolution can shrink here, and a
    // warning that fires on every run would be a false claim of its own.
    const text = await resultText(5_000_000, 1_000_000);
    expect(text).toContain(formatBytes(5_000_000));
    expect(text).toContain(formatBytes(1_000_000));
    expect(text).not.toContain(GRAYSCALE_GREW_NOTE);
  });
});
