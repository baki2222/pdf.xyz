// @vitest-environment jsdom
// @native-canvas
/**
 * Audit pdf-to-png#7 (2026-11-06): PDF to PNG / JPG took a typed range only
 * ("1-3, 5"), so a person had to know the page numbers first — awkward on a
 * phone and on an unfamiliar document.
 *
 * "Select pages" now draws the pages under the box; pressing a page toggles
 * it, and the box and the pages are one choice: a press rewrites the box,
 * typing redraws the pages. Judged on the file the person saves: the ZIP's
 * images are named for the pages rendered.
 *
 * WHAT IS STUBBED (as in pdf-to-image-chain.test.tsx, which proves the
 * renderer's sizing): pdfjs is its legacy build, `render` does not paint,
 * and `toBlob` returns a 1x1 PNG. The page choice, the hand-off to
 * `rasterizePdf` and the ZIP are the real ones.
 */
import { crc32, deflateSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { pageImageName } from "@/lib/pdf/pdf-to-image";
import { withAppRouter } from "@/tests/app-router";
import { PdfToImageRunner } from "./pdf-to-image-runner";

vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

type Legacy = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let legacy: Legacy;
let savedWorkerSrc: string;
let pageProto: { render: (...args: unknown[]) => unknown };

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** A white 1x1 grayscale PNG. */
function onePixelPng(): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from([0, 0xff]))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

beforeAll(async () => {
  legacy = await import("pdfjs-dist/legacy/build/pdf.mjs");
  savedWorkerSrc = legacy.GlobalWorkerOptions.workerSrc;
  (globalThis as Record<string, unknown>).pdfjsWorker =
    // @ts-expect-error -- pdfjs-dist ships no .d.ts for its worker entry.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await PDFDocument.create();
  doc.addPage([10, 10]);
  const task = legacy.getDocument({ data: await doc.save() });
  const loaded = await task.promise;
  pageProto = Object.getPrototypeOf(await loaded.getPage(1));
  await task.destroy();
});

afterAll(() => {
  legacy.GlobalWorkerOptions.workerSrc = savedWorkerSrc;
  delete (globalThis as Record<string, unknown>).pdfjsWorker;
});

let downloads: { name: string; blob: Blob | undefined }[];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  downloads = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    const url = `blob:picker-${++n}`;
    if (blob instanceof Blob) blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({
      name: this.download,
      blob: blobs.get(this.getAttribute("href") ?? ""),
    });
  });
  vi.spyOn(pageProto, "render").mockImplementation(() => ({
    promise: Promise.resolve(),
    cancel: () => {},
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    done: BlobCallback,
  ) {
    done(
      new Blob([onePixelPng().buffer as ArrayBuffer], { type: "image/png" }),
    );
  });
});

afterEach(() => {
  cleanup();
  resetAnnouncer();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

const NAME = "deck.pdf";

async function mount(count: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([300, 400]);
  const file = new File([new Uint8Array(await doc.save())], NAME, {
    type: "application/pdf",
  });
  const { container } = render(
    withAppRouter(<PdfToImageRunner format="png" />),
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  fireEvent.change(input!, { target: { files: [file] } });
  await screen.findByRole(
    "button",
    { name: new RegExp(`render ${count} page`, "i") },
    { timeout: 10_000 },
  );
  fireEvent.click(screen.getByRole("button", { name: /^select pages$/i }));
}

const box = () =>
  screen.getByRole("textbox", { name: /pages to render/i }) as HTMLInputElement;
const tile = (n: number) =>
  screen.findByRole("button", { name: `Page ${n}` }, { timeout: 10_000 });

describe("PDF to PNG · pick the pages on their thumbnails", () => {
  it("a press on a page writes the box, and typing redraws the pages", async () => {
    await mount(4);
    fireEvent.click(await tile(2));
    fireEvent.click(await tile(4));
    expect(box().value).toBe("2, 4");
    expect(await tile(2)).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(box(), { target: { value: "1-3" } });
    for (const [n, on] of [
      [1, "true"],
      [2, "true"],
      [3, "true"],
      [4, "false"],
    ] as const) {
      expect(await tile(n), `page ${n}`).toHaveAttribute("aria-pressed", on);
    }
    fireEvent.click(screen.getByRole("button", { name: /^even pages$/i }));
    expect(box().value).toBe("2, 4");
  }, 30_000);

  // Review of 7d46f446: select mode's keyboard model (one tab stop, arrows,
  // Home/End, Space) had no test — PageTile could ignore its tabIndex prop
  // and every picker test stayed green. Only cut mode's keys were covered.
  it("one tab stop for the grid; arrows, Home and End move it; Space presses", async () => {
    await mount(4);
    await tile(4);
    const stops = () =>
      [1, 2, 3, 4].filter(
        (n) =>
          screen
            .getByRole("button", { name: `Page ${n}` })
            .getAttribute("tabindex") === "0",
      );
    expect(stops()).toEqual([1]);
    expect(await tile(2)).toHaveAttribute("tabindex", "-1");
    (await tile(1)).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(await tile(2));
    expect(stops()).toEqual([2]);
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(box().value).toBe("2");
    expect(await tile(2)).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(await tile(4));
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(box().value).toBe("2, 4");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(await tile(1));
    expect(stops()).toEqual([1]);
  }, 30_000);

  it("renders exactly the pages pressed", async () => {
    await mount(4);
    fireEvent.click(await tile(2));
    fireEvent.click(await tile(4));
    fireEvent.click(screen.getByRole("button", { name: /render 2 pages/i }));
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: /download zip/i },
        { timeout: 20_000 },
      ),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    const zip = await JSZip.loadAsync(await downloads[0]!.blob!.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(
      [1, 3].map((i) => pageImageName(NAME, i, 4, "png")),
    );
  }, 30_000);
});

describe("PDF to PNG / JPG · the pages say what Select pages does", () => {
  it("both tool pages name the thumbnails under the box", async () => {
    for (const slug of ["pdf-to-png", "pdf-to-jpg"] as const) {
      const { default: content } = await import(
        `@/lib/tools/content/${slug}.ts`
      );
      const steps = (content.steps as { body: string }[])
        .map((s) => s.body)
        .join(" ");
      expect(steps, slug).toMatch(
        /press them on the thumbnails drawn below the box/,
      );
    }
  });
});
