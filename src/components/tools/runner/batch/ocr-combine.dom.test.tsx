// @vitest-environment jsdom
/**
 * OCR PDF's "Combine into one PDF" (audit ocr-pdf#3), through the page's own
 * panel with the worker at the wire.
 *
 * Several photos and scans become ONE PDF in the browser, in the order
 * listed, and go as ONE upload and ONE job: what is counted here is the
 * requests the page makes, and the PDF it uploads is decoded (its page count
 * and each page's size, which tell the sources apart). The control: with the
 * box unticked, the same files are one job each, as before.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  OCR_COMBINE_LABEL,
  ocrCombineTooLarge,
  type OcrLanguage,
} from "@/lib/jobs/ocr";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";
import { resetTelemetry } from "@/lib/telemetry/track";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { resetUnsavedForTests } from "@/lib/intent/unsaved";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { JPEG_30X20, JPEG_30X20_EXIF6 } from "@/tests/jpeg-fixtures";
import { OcrWorkerPanel } from "../../ocr-worker-panel";

const tool = getToolBySlug("ocr-pdf")!;
const { verb, noun } = WORKER_BATCH_TOOLS["ocr-pdf"];
const runName = (n: number) => `${verb} ${n} ${noun[n === 1 ? 0 : 1]}`;

function statusWith(languages: readonly OcrLanguage[]): WorkerStatus {
  return {
    ...READY_WORKER_STATUS,
    ocr: { ...READY_WORKER_STATUS.ocr, languages: [...languages] },
  };
}

const jpg = (name: string, bytes = JPEG_30X20) =>
  new File([bytes.slice()], name, { type: "image/jpeg" });

async function pdfFile(name: string): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return new File([(await doc.save()).slice()], name, {
    type: "application/pdf",
  });
}

/** The worker at the wire: counts each request, keeps each upload. */
function worker(status: WorkerStatus) {
  const net = {
    reserves: [] as { filename: string; contentType: string }[],
    puts: [] as Uint8Array[],
    jobs: 0,
  };
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const now = new Date(0).toISOString();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/worker/status")) return json(status);
      if (url === "/api/uploads" && method === "POST") {
        const body = JSON.parse(
          new TextDecoder().decode(init!.body as ArrayBuffer),
        ) as { files: { filename: string; contentType: string }[] };
        net.reserves.push(body.files[0]!);
        const n = net.reserves.length;
        return json({
          sessionId: `s${n}`,
          slots: [
            {
              fileId: `f${n}`,
              filename: "in",
              url: `/__put/${n}`,
              method: "PUT",
              headers: {},
            },
          ],
          expiresAt: now,
          retention: {},
        });
      }
      if (url.startsWith("/__put/")) {
        net.puts.push(new Uint8Array(init!.body as ArrayBuffer));
        return json({});
      }
      if (url === "/api/jobs" && method === "POST") {
        net.jobs += 1;
        const n = net.jobs;
        return json({
          jobId: `job_${n}`,
          status: "completed",
          artifacts: [
            {
              artifactId: `a${n}`,
              filename: `out-${n}-ocr.pdf`,
              contentType: "application/pdf",
              bytes: 8,
              url: `/__art/${n}`,
              expiresAt: now,
            },
          ],
        });
      }
      if (url.startsWith("/__art/")) return new Response("%PDF-out");
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return net;
}

afterEach(() => {
  cleanup();
  resetTelemetry();
  resetAnnouncer();
  resetUnsavedForTests();
  vi.unstubAllGlobals();
});

async function drop(files: File[]) {
  render(
    <InToolPage tool={tool}>
      <OcrWorkerPanel tool={tool} />
    </InToolPage>,
  );
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, { target: { files } });
}

const combineBox = () =>
  screen.findByRole(
    "checkbox",
    { name: new RegExp(OCR_COMBINE_LABEL) },
    { timeout: 10_000 },
  );

describe("OCR PDF: Combine into one PDF", { timeout: 30_000 }, () => {
  it("3 photos + 1 PDF: one upload of a 4-page PDF in list order, and exactly one job", async () => {
    const net = worker(statusWith(["eng"]));
    await drop([
      jpg("one.jpg"),
      jpg("two.jpg", JPEG_30X20_EXIF6),
      jpg("three.jpg"),
      await pdfFile("four.pdf"),
    ]);
    fireEvent.click(await combineBox());
    const run = await screen.findByRole("button", {
      name: /recognize text in one pdf/i,
    });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText(/OCR complete/, undefined, { timeout: 10_000 });
    expect(net.jobs).toBe(1);
    expect(net.reserves).toEqual([
      {
        filename: "one-combined.pdf",
        contentType: "application/pdf",
        bytes: expect.any(Number),
      },
    ]);
    const doc = await PDFDocument.load(net.puts[0]!);
    expect(doc.getPageCount()).toBe(4);
    expect(
      doc.getPages().map((p) => {
        const { width, height } = p.getSize();
        return [Math.round(width), Math.round(height)];
      }),
    ).toEqual([
      [30, 20],
      [20, 30],
      [30, 20],
      [200, 200],
    ]);
    expect(
      screen.getByRole("link", { name: /download out-1-ocr\.pdf/i }),
    ).toBeInTheDocument();
  });

  it("CONTROL: unticked, the same files are one job each", async () => {
    const net = worker(statusWith(["eng"]));
    await drop([jpg("one.jpg"), jpg("two.jpg"), await pdfFile("three.pdf")]);
    expect(await combineBox()).not.toBeChecked();
    const run = await screen.findByRole(
      "button",
      { name: runName(3) },
      { timeout: 10_000 },
    );
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText("Batch complete. 3 done, 0 failed.", undefined, {
      timeout: 10_000,
    });
    expect(net.jobs).toBe(3);
  });

  it("over the per-file ceiling together: refused in words, Run held, nothing sent", async () => {
    const net = worker(statusWith(["eng"]));
    const half = Math.ceil(WORKER_FILE_CEILING / 2) + 1;
    const big = (name: string) =>
      new File([new Uint8Array(half)], name, { type: "image/jpeg" });
    await drop([big("a.jpg"), big("b.jpg")]);
    fireEvent.click(await combineBox());
    expect(
      await screen.findByText(
        ocrCombineTooLarge(half * 2, WORKER_FILE_CEILING),
      ),
    ).toBeInTheDocument();
    const run = screen.getByRole("button", {
      name: /recognize text in one pdf/i,
    });
    expect(run).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(run);
    expect(net.reserves).toEqual([]);
    expect(net.jobs).toBe(0);
  });
});
