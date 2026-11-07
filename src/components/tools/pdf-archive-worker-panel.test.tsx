// @vitest-environment jsdom
/**
 * What a PDF/A user sees when the worker says the file needs a password.
 *
 * Before: every Ghostscript failure — an open-password PDF included — ended in
 * "The PDF/A engine could not process this file" after three identical
 * attempts, with nothing pointing at the tool that fixes it. Now the worker
 * returns its own code, and this panel turns that code into a link. The test
 * drives the real panel: status fetch → file pick → Convert → the rendered
 * outcome. Only the network is stubbed: the REAL job client runs over a
 * stubbed global `fetch` (`@/tests/stub-job-network`).
 *
 * It used to `vi.mock` the client. At the merge with L06, whose
 * worker-panel-ceiling-refusal.test.tsx imports this same panel, that made
 * the panel module stay cached bound to the stub for the other file under
 * `isolate: false` — what src/tests/mock-isolation.test.ts fails on.
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
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import { PDF_ARCHIVE_PASSWORD_REQUIRED_CODE } from "@/lib/workers/pdf-archive/contract";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { PdfArchiveWorkerPanel } from "./pdf-archive-worker-panel";
import { signedPdf } from "@/tests/signed-pdf";
import { PdfASignatureWarning } from "./pdfa-signature-warning";
import pdfaContent from "@/lib/tools/content/pdf-to-pdfa";
import { countDigitalSignatures } from "@/lib/pdf/digital-signatures";
import {
  PDFA_LEVEL_LABEL,
  PDFA_LEVEL_OPTION,
} from "@/lib/workers/pdf-archive/levels";

const tool = getToolBySlug("pdf-to-pdfa")!;

const READY = {
  mode: "remote-configured",
  enabled: false,
  localDevOnly: false,
  detail: "remote",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  scan: { active: false, detail: "not scanned" },
  security: { available: false, operations: [], detail: "qpdf" },
  providers: {
    storage: { ready: true },
    queue: { ready: true },
    processor: { ready: true },
  },
  daemon: { drainable: true, detail: "ready" },
  ai: { ready: false },
  pipeline: { verdict: "off", observed: false, drainable: false, detail: "" },
} as unknown as WorkerStatus;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Convert one PDF; the worker's job ends failed with `error`. */
async function convertAndGetOutcome(error: { code: string; message: string }) {
  const network = stubJobNetwork(READY, (body) => {
    expect(body.tool).toBe("pdf-to-pdfa");
    return { status: "failed", error: { ...error, retryable: false } };
  });
  render(<PdfArchiveWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File(["%PDF-1.7"], "statement.pdf", { type: "application/pdf" }),
      ],
    },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: /convert to pdf\/a/i }),
  );
  await waitFor(() => expect(network.jobBodies).toHaveLength(1));
  expect(network.uploads()).toBe(1);
  return screen.findByRole("alert");
}

describe("PdfArchiveWorkerPanel failure outcomes", () => {
  it("links an open-password failure to Unlock PDF — a real tool page", async () => {
    const alert = await convertAndGetOutcome({
      code: PDF_ARCHIVE_PASSWORD_REQUIRED_CODE,
      message: "This PDF needs a password to open.",
    });
    expect(alert).toHaveTextContent("This PDF needs a password to open.");
    const link = screen.getByRole("link", { name: "Unlock PDF" });
    const href = link.getAttribute("href")!;
    // The link's target is a page that exists, derived from the catalog.
    const slug = /^\/tools\/([^/]+)$/.exec(href)?.[1];
    expect(slug).toBeDefined();
    expect(getToolBySlug(slug!)?.name).toMatch(/unlock/i);
  });

  it("NEGATIVE CONTROL: any other failure shows the message and no unlock link", async () => {
    const alert = await convertAndGetOutcome({
      code: "internal_error",
      message: "The PDF/A engine could not process this file.",
    });
    expect(alert).toHaveTextContent("could not process this file");
    expect(screen.queryByRole("link", { name: "Unlock PDF" })).toBeNull();
  });

  it("does not describe the output as certified PDF/A", async () => {
    stubJobNetwork(READY);
    render(<PdfArchiveWorkerPanel tool={tool} />);
    expect(await screen.findByText(/not validated/i)).toBeInTheDocument();
  });

  // Audit #41 (2026-11-06): the description said "anything Ghostscript has
  // to remove is listed with your download". It is not: -dQUIET suppresses
  // the font-substitution line (and it names a path, so it would be withheld
  // anyway), and the notes are capped. The page body says the notes hold
  // only what Ghostscript reports; the panel now says the same.
  it("promises only what Ghostscript reports, not everything it removes", async () => {
    stubJobNetwork(READY);
    const { container } = render(<PdfArchiveWorkerPanel tool={tool} />);
    await screen.findByText(/not validated/i);
    const text = container.textContent ?? "";
    expect(text).toMatch(/PDF\/A conversion uses Ghostscript/);
    expect(text).not.toMatch(/anything Ghostscript has to remove is listed/i);
    expect(text).toMatch(/what Ghostscript reports/i);
    expect(text).toMatch(/substitut/i);
  });
});

/*
 * Audit pdf-to-pdfa#6 (2026-11-08): Ghostscript rewrites the whole file, so
 * a digital signature in it does not survive as a valid signature. The panel
 * uploaded a signed contract without a word. It now counts signatures in the
 * browser (`countDigitalSignatures`, the scan Optimize for Web uses) before
 * anything is uploaded, names them, and holds Run until the reader confirms.
 */
describe("PdfArchiveWorkerPanel: a signed PDF is named before any upload", () => {
  async function pick(bytes: Uint8Array) {
    const network = stubJobNetwork(READY);
    render(<PdfArchiveWorkerPanel tool={tool} />);
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([bytes.slice()], "contract.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    const run = await screen.findByRole("button", {
      name: /convert to pdf\/a/i,
    });
    return { network, run };
  }

  it("names the signatures and holds Run until the box is ticked", async () => {
    const signed = await signedPdf({ signatures: 2 });
    expect(countDigitalSignatures(signed)).toBe(2);
    const { network, run } = await pick(signed);
    const warning = await screen.findByRole("group", {
      name: "This PDF has 2 digital signatures",
    });
    expect(warning).toHaveTextContent(
      "Converting to PDF/A rewrites the whole file, so they will not survive as valid signatures",
    );
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAttribute("aria-describedby", warning.id);
    fireEvent.click(run);
    expect(network.uploads()).toBe(0);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Convert anyway — I understand the digital signatures will not survive",
      }),
    );
    expect(run).not.toHaveAttribute("aria-disabled");
    fireEvent.click(run);
    await waitFor(() => expect(network.uploads()).toBe(1));
  });

  it("CONTROL: an unsigned PDF shows no warning and runs at once", async () => {
    const unsigned = await signedPdf({ signatures: 0 });
    expect(countDigitalSignatures(unsigned)).toBe(0);
    const { network, run } = await pick(unsigned);
    fireEvent.click(run);
    await waitFor(() => expect(network.uploads()).toBe(1));
    expect(
      screen.queryByRole("group", { name: /digital signature/ }),
    ).toBeNull();
  });
});

describe("pdf-to-pdfa: the page describes the signature gate the panel runs", () => {
  it("the box the page names is the one the warning renders", async () => {
    render(
      <PdfASignatureWarning
        id="w"
        count={1}
        confirmed={false}
        onConfirm={() => {}}
      />,
    );
    const label = screen.getByRole("checkbox").closest("label")!.textContent!;
    const begins = /begins "([^"]+)"/.exec(
      pdfaContent.steps.map((s) => s.body).join(" "),
    )?.[1];
    expect(begins).toBeDefined();
    expect(label.startsWith(begins!)).toBe(true);
  });
});

/*
 * Audit pdf-to-pdfa#1, review 2026-11-08: the chain tests start at the
 * option bag, so a panel that dropped `level` from the request (a user
 * picking PDF/A-1b and getting PDF/A-2b under the 1b label) passed every
 * one of them. This starts at the select the user changes and ends at the
 * job the worker receives.
 */
describe("PdfArchiveWorkerPanel: the PDF/A level reaches the job", () => {
  async function convertWith(levelName?: string) {
    const network = stubJobNetwork(READY);
    render(<PdfArchiveWorkerPanel tool={tool} />);
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const unsigned = await signedPdf({ signatures: 0 });
    fireEvent.change(input, {
      target: {
        files: [
          new File([unsigned.slice()], "report.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    const run = await screen.findByRole("button", {
      name: /convert to pdf\/a/i,
    });
    if (levelName) {
      const select = screen.getByRole("combobox", { name: PDFA_LEVEL_LABEL });
      const option = within(select).getByRole("option", { name: levelName });
      fireEvent.change(select, {
        target: { value: (option as HTMLOptionElement).value },
      });
      expect(select).toHaveDisplayValue(levelName);
    }
    fireEvent.click(run);
    await waitFor(() => expect(network.jobBodies).toHaveLength(1));
    return network.jobBodies[0]!.options;
  }

  it("PDF/A-1b chosen in the picker is the level the job asks for", async () => {
    expect(await convertWith("PDF/A-1b")).toEqual({
      [PDFA_LEVEL_OPTION]: "1b",
    });
  });

  it("PDF/A-3b likewise", async () => {
    expect(await convertWith("PDF/A-3b")).toEqual({
      [PDFA_LEVEL_OPTION]: "3b",
    });
  });

  it("CONTROL: left on the default, the job carries the empty bag it always did", async () => {
    expect(await convertWith()).toEqual({});
  });
});
