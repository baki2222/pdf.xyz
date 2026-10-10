// @vitest-environment jsdom
/**
 * The PDF to Office panel, driven through the REAL browser client over a
 * stubbed network, with job records built by the REAL worker processor and
 * the REAL persistence sanitizer.
 *
 * That chain is the point. The coverage notice renders from
 * `job.results.officeExport`; the processor has to set it, `sanitizeJobResults`
 * (a whitelist) has to keep it, and the client has to hand the job to the
 * panel. Each of those passing its own test proves nothing about the path,
 * and a partly scanned PDF used to "succeed" here with its scanned pages
 * silently missing. Likewise the next-step link on a failure keys on the job
 * error CODE the processor sets, so the failure cases run the processor too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Job } from "@/lib/jobs/types";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { resetTelemetry } from "@/lib/telemetry/track";
import { createPdfOfficeExportProcessor } from "@/lib/workers/processor/pdf-office-export";
import type { PdfFlowExtractor } from "@/lib/workers/pdf-office-export/engine";
import { PdfTextExecError } from "@/lib/workers/pdf-text/errors";
import { rc4EncryptedPdf } from "@/tests/pdf-office-fixtures";
import { PDFDocument } from "pdf-lib";
import { scanPdfPages } from "@/lib/workers/pdf-office-export/page-scan";
import {
  imageCaptionPdf,
  linesPdf,
  scannedPdf,
  undecodablePicturePdf,
} from "@/tests/pptx-fidelity-fixtures";
import { PdfOfficeExportWorkerPanel } from "./pdf-office-export-worker-panel";

const wordTool = getToolBySlug("pdf-to-word")!;
const providers = getProviderReadiness("remote-configured");

const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  security: {
    available: true,
    operations: ["protect", "unlock"],
    detail: "qpdf runs on the worker.",
  },
  providers: {
    ...providers,
    storage: { ...providers.storage, ready: true },
    queue: { ...providers.queue, ready: true },
  },
  daemon: { ...resolveDaemonReadiness({}), drainable: true },
  ai: resolveAiReadiness({}),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
  },
};

const SENTENCE = "A typed page with a full sentence of selectable text on it.";
const layoutExtract = async () => ({
  pageCount: 1,
  pages: [{ pageNumber: 1, text: SENTENCE, characterCount: SENTENCE.length }],
  text: SENTENCE,
  characterCount: SENTENCE.length,
  hasText: true,
});
function pages(...texts: string[]): PdfFlowExtractor {
  return async () => ({
    pageCount: texts.length,
    pages: texts.map((t, i) => ({
      pageNumber: i + 1,
      paragraphs: t ? [[t]] : [],
    })),
  });
}

/** Run the real processor, then shape its result the way the job API does. */
async function jobFrom(
  extractFlow: PdfFlowExtractor,
  input: Uint8Array = new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  keepResults = true,
): Promise<{ job: Job; output?: Uint8Array }> {
  const result = await createPdfOfficeExportProcessor({
    extract: layoutExtract,
    extractFlow,
  }).process({
    tool: "pdf-to-word",
    options: {},
    inputs: [
      {
        fileId: "f1",
        filename: "report.pdf",
        contentType: "application/pdf",
        bytes: input,
      },
    ],
  });
  const base = {
    jobId: "job_1",
    tool: "pdf-to-word",
    capability: "worker",
    progress: 100,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
  if (!result.ok)
    return {
      job: { ...base, status: "failed", error: result.error } as unknown as Job,
    };
  const results = keepResults ? sanitizeJobResults(result.results) : undefined;
  return {
    job: {
      ...base,
      status: "completed",
      artifacts: [
        {
          artifactId: "a1",
          filename: result.artifacts[0]!.filename,
          contentType: result.artifacts[0]!.contentType,
          bytes: result.artifacts[0]!.bytes.byteLength,
          url: "/download/a1",
          expiresAt: "2026-09-27T01:00:00.000Z",
        },
      ],
      ...(results ? { results } : {}),
    } as unknown as Job,
    output: result.artifacts[0]!.bytes,
  };
}

/** The whole job lifecycle the client runs, answered in order. */
function stubNetwork(served: { job: Job; output?: Uint8Array }) {
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/worker/status") return json(READY);
      if (url === "/api/uploads")
        return json({
          sessionId: "s1",
          tool: "pdf-to-word",
          slots: [
            {
              fileId: "f1",
              filename: "report.pdf",
              url: "/upload/f1",
              method: "PUT",
              headers: {},
            },
          ],
        });
      if (url === "/upload/f1") return json({});
      if (url === "/api/jobs") return json(served.job);
      if (url === "/download/a1")
        return {
          ...json({}),
          arrayBuffer: async () => served.output!.slice().buffer,
        };
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function exportOnePdf() {
  render(<PdfOfficeExportWorkerPanel tool={wordTool} />);
  const input = await vi.waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error("no file input yet");
    return found;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /export docx/i }));
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Copy that promises the result will say WHICH pages were left out. */
const PROMISES_A_PAGE_LIST =
  /(tells?|shows?|lists?|names?) you (exactly )?which (ones|pages)/i;

describe("PDF to Word panel — pages that were not exported", () => {
  it("names the scanned pages beside the download, with a way to OCR them", async () => {
    stubNetwork(await jobFrom(pages(SENTENCE, "", "", "")));
    await exportOnePdf();
    const notice = await screen.findByText(/Text found on 1 of 4 pages/);
    const box = notice.closest('[role="status"]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box).toHaveTextContent(/No selectable text on pages 2–4/);
    expect(
      within(box).getByRole("link", { name: "Open OCR PDF" }),
    ).toHaveAttribute("href", "/tools/ocr-pdf");
    expect(screen.getByText(/Your DOCX file is ready/)).toBeInTheDocument();
  });

  it("names pages with only a stamp on them, hedged", async () => {
    stubNetwork(await jobFrom(pages(SENTENCE, "BATES 000124")));
    await exportOnePdf();
    const notice = await screen.findByText(/Text found on 2 of 2 pages/);
    expect(notice.closest('[role="status"]')).toHaveTextContent(
      /Page 2 has under 40 characters of selectable text\. If it is a scan/,
    );
  });

  it("POSITIVE CONTROL: says nothing when every page had text", async () => {
    stubNetwork(await jobFrom(pages(SENTENCE, SENTENCE)));
    await exportOnePdf();
    expect(
      await screen.findByText(/Your DOCX file is ready/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Text found on/)).not.toBeInTheDocument();
  });

  it("says nothing — not 'every page had text' — when the worker did not report", async () => {
    // A worker image older than this page returns no block at all.
    stubNetwork(await jobFrom(pages(SENTENCE, "", ""), undefined, false));
    await exportOnePdf();
    expect(
      await screen.findByText(/Your DOCX file is ready/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Text found on/)).not.toBeInTheDocument();
    // …and nothing else on the page promised it would. The panel's intro
    // used to say "the result tells you which ones" whatever worker ran the
    // job; against this worker that sentence was false. Only the notice,
    // which renders from the worker's own report, may name pages.
    expect(document.body.textContent).not.toMatch(PROMISES_A_PAGE_LIST);
  });

  it("POSITIVE CONTROL: the promise pattern catches the sentence the panel used to show", () => {
    expect(
      "Pages without selectable text (scans) are not included, and the result tells you which ones. Run OCR first to include them.",
    ).toMatch(PROMISES_A_PAGE_LIST);
  });
});

describe("PDF to Word panel — failures link the tool that fixes them", () => {
  const refused: PdfFlowExtractor = async () => {
    throw new PdfTextExecError({
      exitCode: 1,
      killed: false,
      outputTooLarge: false,
    });
  };

  it("sends a password-protected PDF to Unlock PDF", async () => {
    stubNetwork(
      await jobFrom(
        refused,
        rc4EncryptedPdf({ userPassword: "pw", ownerPassword: "owner" }),
      ),
    );
    await exportOnePdf();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /password-protected/,
    );
    expect(
      screen.getByRole("link", { name: "Open Unlock PDF" }),
    ).toHaveAttribute("href", "/tools/unlock-pdf");
  });

  it("sends a PDF with no text to OCR PDF", async () => {
    stubNetwork(await jobFrom(pages("", "")));
    await exportOnePdf();
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "Open OCR PDF" })).toHaveAttribute(
      "href",
      "/tools/ocr-pdf",
    );
  });

  it("POSITIVE CONTROL: a retryable failure links nothing", async () => {
    stubNetwork(
      await jobFrom(async () => {
        throw new Error("the run did not finish");
      }),
    );
    await exportOnePdf();
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
  });
});

/**
 * PowerPoint keeps a page with no text, as pictures (since 2026-10-10), so
 * its notice says THAT — through the same chain as above: the REAL page
 * reader over a real PDF (a typed page, a scanned page, a blank page), the
 * real processor, the persistence whitelist, the client, the panel.
 */
describe("PDF to PowerPoint panel — pages kept only as pictures", () => {
  const pptxTool = getToolBySlug("pdf-to-powerpoint")!;

  async function threePagePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const [typed, scan] = await Promise.all([
      PDFDocument.load((await linesPdf([[SENTENCE]])).pdf),
      PDFDocument.load((await scannedPdf()).pdf),
    ]);
    doc.addPage((await doc.copyPages(typed, [0]))[0]!);
    doc.addPage((await doc.copyPages(scan, [0]))[0]!);
    doc.addPage([720, 540]);
    return doc.save();
  }

  async function pptxJob(keepPictureFields: boolean) {
    const result = await createPdfOfficeExportProcessor({
      extract: layoutExtract,
      extractFlow: pages(SENTENCE),
      scanPages: scanPdfPages,
    }).process({
      tool: "pdf-to-powerpoint",
      options: {},
      inputs: [
        {
          fileId: "f1",
          filename: "report.pdf",
          contentType: "application/pdf",
          bytes: await threePagePdf(),
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const sanitized = sanitizeJobResults(result.results)!;
    // An older worker's result: the same coverage, no picture fields.
    if (!keepPictureFields && sanitized.officeExport) {
      delete sanitized.officeExport.picturePageCount;
      delete sanitized.officeExport.pagesAsPictures;
    }
    return {
      job: {
        jobId: "job_1",
        tool: "pdf-to-powerpoint",
        capability: "worker",
        progress: 100,
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        status: "completed",
        artifacts: [
          {
            artifactId: "a1",
            filename: result.artifacts[0]!.filename,
            contentType: result.artifacts[0]!.contentType,
            bytes: result.artifacts[0]!.bytes.byteLength,
            url: "/download/a1",
            expiresAt: "2026-10-10T01:00:00.000Z",
          },
        ],
        results: sanitized,
      } as unknown as Job,
      output: result.artifacts[0]!.bytes,
    };
  }

  async function exportPptx() {
    render(<PdfOfficeExportWorkerPanel tool={pptxTool} />);
    const input = await vi.waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      if (!found) throw new Error("no file input yet");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /export pptx/i }));
  }

  it("says the scanned page is on its slide as a picture, and the blank one empty", async () => {
    stubNetwork(await pptxJob(true));
    await exportPptx();
    const notice = await screen.findByText(/Text found on 1 of 3 pages/);
    const box = notice.closest('[role="status"]') as HTMLElement;
    expect(box).toHaveTextContent(
      /No selectable text on page 2, so its slide carries the page as a picture/,
    );
    expect(box).toHaveTextContent(/One page has nothing on it/);
    // The sentence that was true of the text-only deck is not shown.
    expect(box).not.toHaveTextContent(/nothing from (it|them) is in this file/);
    expect(
      within(box).getByRole("link", { name: "Open OCR PDF" }),
    ).toHaveAttribute("href", "/tools/ocr-pdf");
  });

  it("says what an OLDER worker's deck did when its result has no picture fields", async () => {
    // A worker image from before 2026-10-10 left such pages empty, and its
    // result says nothing of pictures; the panel must not claim them.
    stubNetwork(await pptxJob(false));
    await exportPptx();
    const notice = await screen.findByText(/Text found on 1 of 3 pages/);
    expect(notice.closest('[role="status"]')).toHaveTextContent(
      /nothing from them is in this file/,
    );
  });
});

/**
 * A picture the worker could not carry is SAID, never turned into "nothing
 * on it". Until 2026-10-11 such a picture left no trace in the result: a page
 * whose only content was a picture pdf.js could not decode (or one past its
 * pixel ceiling) was counted with the blank pages — "2 pages have nothing on
 * them" — and a page with text kept its picture's loss to itself. Through
 * the same chain as above: the real page reader, processor, persistence
 * whitelist, client and panel.
 */
describe("PDF to PowerPoint panel — pictures that are not on their slides", () => {
  const pptxTool = getToolBySlug("pdf-to-powerpoint")!;

  async function pptxJobFor(
    pdf: Uint8Array,
    scanPages: typeof scanPdfPages = scanPdfPages,
  ) {
    const result = await createPdfOfficeExportProcessor({
      extract: layoutExtract,
      extractFlow: pages(SENTENCE),
      scanPages,
    }).process({
      tool: "pdf-to-powerpoint",
      options: {},
      inputs: [
        {
          fileId: "f1",
          filename: "report.pdf",
          contentType: "application/pdf",
          bytes: pdf,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    return {
      job: {
        jobId: "job_1",
        tool: "pdf-to-powerpoint",
        capability: "worker",
        progress: 100,
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
        status: "completed",
        artifacts: [
          {
            artifactId: "a1",
            filename: result.artifacts[0]!.filename,
            contentType: result.artifacts[0]!.contentType,
            bytes: result.artifacts[0]!.bytes.byteLength,
            url: "/download/a1",
            expiresAt: "2026-10-11T01:00:00.000Z",
          },
        ],
        results: sanitizeJobResults(result.results)!,
      } as unknown as Job,
      output: result.artifacts[0]!.bytes,
    };
  }

  async function exportPptx() {
    render(<PdfOfficeExportWorkerPanel tool={pptxTool} />);
    const input = await vi.waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      if (!found) throw new Error("no file input yet");
      return found;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /export pptx/i }));
  }

  it("a page whose only picture could not be decoded is named as such, and only the blank page is called empty", async () => {
    stubNetwork(await pptxJobFor((await undecodablePicturePdf()).pdf));
    await exportPptx();
    const notice = await screen.findByText(/Text found on 1 of 3 pages/);
    const box = notice.closest('[role="status"]') as HTMLElement;
    expect(box).toHaveTextContent(
      /1 picture on page 2 is not on its slide: its image data could not be decoded/,
    );
    expect(box).toHaveTextContent(/One page has nothing on it/);
    expect(box).not.toHaveTextContent(/2 pages have nothing on them/);
  });

  it("a picture too large for the worker is named even when every page has text", async () => {
    // The decode budget, lowered for the test so a 480 × 300 photo is over it.
    const lowBudget: typeof scanPdfPages = (bytes, options) =>
      scanPdfPages(bytes, { ...options, pageDecodeBudgetBytes: 100_000 });
    stubNetwork(await pptxJobFor((await imageCaptionPdf()).pdf, lowBudget));
    await exportPptx();
    const sentence = await screen.findByText(
      /1 picture on page 1 is not on its slide/,
    );
    const box = sentence.closest('[role="status"]') as HTMLElement;
    expect(box).toHaveTextContent(/it was too large for the worker to carry/);
    // No page lacks text, so nothing about text or OCR is said.
    expect(box).not.toHaveTextContent(/Text found on/);
    expect(
      within(box).queryByRole("link", { name: "Open OCR PDF" }),
    ).toBeNull();
  });
});
