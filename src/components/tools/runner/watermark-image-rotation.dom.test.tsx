// @vitest-environment jsdom
/**
 * Audit watermark-pdf#6: text and image marks shared one Rotation, which
 * started at 45 degrees, so the advertised "logo small in a corner" came out
 * tilted. An image mark now starts upright and keeps its own remembered
 * angle; text keeps 45. The last check decodes the DOWNLOADED file: the
 * matrices in front of the image's `Do` compose to no rotation at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { OPTIONS_STORAGE_KEY } from "@/lib/intent/options-key";
import { recallOptions } from "@/lib/intent/option-memory";
import { solidPng } from "@/tests/epub-fixtures";
import { WatermarkEditor } from "./watermark-runner";
import type { LoadedPdf } from "./use-single-pdf";

const router = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  hmrRefresh: () => {},
};
function Router({ children }: { children: ReactNode }) {
  return (
    <AppRouterContext.Provider value={router as never}>
      {children}
    </AppRouterContext.Provider>
  );
}

let downloads: Blob[] = [];
let pending: Blob | null = null;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeEach(() => {
  downloads = [];
  window.localStorage.removeItem(OPTIONS_STORAGE_KEY);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    if (obj instanceof Blob) pending = obj;
    return "blob:watermark-image-rotation";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    if (pending) downloads.push(pending);
    pending = null;
  });
});
afterEach(() => {
  cleanup();
  resetAnnouncer();
  window.localStorage.removeItem(OPTIONS_STORAGE_KEY);
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

async function loaded(): Promise<LoadedPdf> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]);
  const bytes = await doc.save();
  return {
    file: new File([bytes.slice()], "doc.pdf", { type: "application/pdf" }),
    bytes,
    pageCount: 1,
    rotations: [0],
    digitalSignatures: 0,
  };
}

const rotation = () =>
  (screen.getByLabelText("Rotation") as HTMLInputElement).value;
const setRotation = (value: number) =>
  fireEvent.change(screen.getByLabelText("Rotation"), {
    target: { value: String(value) },
  });
const pickType = (name: "Text" | "Image") =>
  fireEvent.click(screen.getByRole("radio", { name }));

async function pickImage(container: HTMLElement) {
  const input = container.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const png = solidPng(24);
  fireEvent.change(input, {
    target: {
      files: [new File([png.slice()], "logo.png", { type: "image/png" })],
    },
  });
  await screen.findByRole("button", { name: "Remove watermark image" });
}

/** Every `a b c d e f cm` before the image's `Do`, composed. */
function imageMatrix(ops: string): number[] {
  const at = ops.search(/\/\S+ Do/);
  expect(at, ops).toBeGreaterThan(-1);
  const block = ops.slice(ops.lastIndexOf("q", at), at);
  let m = [1, 0, 0, 1, 0, 0];
  for (const match of block.matchAll(
    /(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) cm/g,
  )) {
    const [a, b, c, d, e, f] = match.slice(1, 7).map(Number) as number[];
    // New CTM = this × old (PDF: concatenate on the left).
    const [A, B, C, D, E, F] = m as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    m = [
      a! * A + b! * C,
      a! * B + b! * D,
      c! * A + d! * C,
      c! * B + d! * D,
      e! * A + f! * C + E,
      e! * B + f! * D + F,
    ];
  }
  return m;
}

async function pageOps(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .map((s) =>
      new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()),
    )
    .join("\n");
}

describe("image marks have their own rotation (audit watermark-pdf#6)", () => {
  it("text starts at 45, image at 0, and each keeps its own value", async () => {
    render(
      <Router>
        <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
      </Router>,
    );
    expect(rotation()).toBe("45");
    pickType("Image");
    expect(rotation()).toBe("0");
    setRotation(10);
    pickType("Text");
    expect(rotation()).toBe("45");
    setRotation(30);
    pickType("Image");
    expect(rotation()).toBe("10");
  });

  it(
    "a run remembers both angles apart, and the next visit gets each back",
    { timeout: 60_000 },
    async () => {
      const { container, unmount } = render(
        <Router>
          <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
        </Router>,
      );
      setRotation(30);
      pickType("Image");
      setRotation(-12);
      await pickImage(container);
      fireEvent.click(screen.getByRole("button", { name: /Add watermark/ }));
      await screen.findByRole(
        "button",
        { name: /Download watermarked PDF/ },
        { timeout: 30_000 },
      );
      expect(recallOptions("watermark")).toMatchObject({
        rotation: 30,
        imageRotation: -12,
      });
      unmount();
      render(
        <Router>
          <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
        </Router>,
      );
      expect(rotation()).toBe("30");
      pickType("Image");
      expect(rotation()).toBe("-12");
    },
  );

  it(
    "an untouched image mark is drawn upright in the download",
    { timeout: 60_000 },
    async () => {
      const { container } = render(
        <Router>
          <WatermarkEditor pdf={await loaded()} onReset={() => {}} />
        </Router>,
      );
      pickType("Image");
      await pickImage(container);
      fireEvent.click(screen.getByRole("button", { name: /Add watermark/ }));
      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: /Download watermarked PDF/ },
          { timeout: 30_000 },
        ),
      );
      await waitFor(() => expect(downloads).toHaveLength(1));
      const ops = await pageOps(
        new Uint8Array(await downloads[0]!.arrayBuffer()),
      );
      const [a, b, c, d] = imageMatrix(ops);
      expect(Math.abs(b!), ops).toBeLessThan(1e-6);
      expect(Math.abs(c!)).toBeLessThan(1e-6);
      expect(a!).toBeGreaterThan(0);
      expect(d!).toBeGreaterThan(0);
    },
  );
});
