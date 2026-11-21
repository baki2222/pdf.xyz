// @vitest-environment jsdom
// @native-canvas
/**
 * The Translate panel and the reflowed PDF (2026-11-15, competitor audit #29
 * slice 1), rendered and read as a user reads it.
 *
 *  - The "You get" row names the PDF only for a target the running worker
 *    proved it prints (`translatePdfLanguages`), and keeps today's row
 *    otherwise — the panel's copy is gated on the key, never on the code.
 *  - A job that brought back a PDF offers it FIRST, then the package.
 *  - A job whose PDF could not be drawn offers the package alone, and says so.
 *
 * Nothing is `vi.mock`ed (`src/tests/mock-isolation.test.ts`): the network is
 * the global `fetch`, stubbed by `stubJobNetwork`, and the parse is the real
 * extractor on pdf.js's legacy build.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { extractPdfText } from "@/lib/pdf/text";
import type { JobArtifact } from "@/lib/jobs/types";
import type { JobResults } from "@/lib/jobs/results";
import type { WorkerStatus } from "@/lib/workers/status";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import {
  stubJobNetwork,
  type StubbedJobOutcome,
} from "@/tests/stub-job-network";
import { textPdf } from "@/tests/pdf-text-fixtures";
import { useNodeFontSource as pointFontsAtNode } from "@/tests/unicode-fonts";
import { resetWorkerStatusForTests } from "./use-worker-status";
import {
  TRANSLATE_OUTPUT_WITH_PDF,
  TRANSLATE_OUTPUT_ZIP,
  TRANSLATE_PDF_NOT_DRAWN,
  TranslateWorkerPanel,
} from "./translate-worker-panel";

/**
 * The timeout every wait in this file passes (CI-flake lane 3): its panels'
 * lazy chunks load cold per file in the native-canvas project, where waits have
 * outrun the 1 s default on CI (sign-runner's took 1855 ms in run 44931945692).
 *
 * CI: the slowest test here took 410 ms (run 44321190257, "offers the PDF
 * first, then the package"; 19 passing runs, 11-18 to 11-21). A wait cannot
 * outlast its test, so 3 s is at least 7.3x any wait in it, and it stays below
 * the test's own timeout, so a wait that times out fails with its DOM dump.
 */
const WAIT_MS = 3_000;

const translateTool = getToolBySlug("translate-pdf")!;

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
const realExtract = (bytes: Uint8Array) => extractPdfText(bytes, legacy);

const WINDOW = {
  truncated: false,
  charactersSent: 100,
  charactersTotal: 100,
  totalPages: 1,
  lastCompletePage: 1,
  cutMidPage: false,
};

const artifact = (
  name: string,
  contentType: string,
  url: string,
): JobArtifact => ({
  artifactId: `a_${name}`,
  filename: name,
  contentType,
  bytes: 4,
  url,
  expiresAt: new Date(0).toISOString(),
});

const ZIP = {
  artifact: artifact(
    "statement-translation.zip",
    "application/zip",
    "/api/artifacts/local/zip",
  ),
  bytes: new Uint8Array([80, 75, 3, 4]),
};
const PDF = {
  artifact: artifact(
    "statement-translated.pdf",
    "application/pdf",
    "/api/artifacts/local/pdf",
  ),
  bytes: new Uint8Array([37, 80, 68, 70]),
};

function status(languages: readonly string[]): WorkerStatus {
  return { ...READY, translatePdfLanguages: languages };
}

async function renderPanel(
  worker: WorkerStatus,
  outcome?: () => StubbedJobOutcome,
) {
  stubJobNetwork(worker, outcome);
  render(
    <InToolPage tool={translateTool}>
      <TranslateWorkerPanel tool={translateTool} extractText={realExtract} />
    </InToolPage>,
  );
  return screen.findByRole(
    "button",
    { name: /translate pdf/i },
    { timeout: WAIT_MS },
  );
}

async function runOnce(run: HTMLElement) {
  pointFontsAtNode();
  const bytes = await textPdf([400]);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, {
    target: {
      files: [
        new File([bytes.slice()], "statement.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await waitFor(
    () => expect(run.getAttribute("aria-disabled")).not.toBe("true"),
    { timeout: WAIT_MS },
  );
  fireEvent.click(run);
}

const downloads = () =>
  screen
    .queryAllByRole("button", { name: /^download /i })
    .map((b) => b.textContent?.replace(/^Download\s*/, "").trim());

afterEach(() => {
  resetTelemetry();
  resetWorkerStatusForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the You get row follows the worker's proven languages", () => {
  it("names the PDF for a proven target, and keeps today's row for another", async () => {
    // The default target is English.
    await renderPanel(status(["en", "es"]));
    expect(
      await screen.findByText(
        TRANSLATE_OUTPUT_WITH_PDF,
        {},
        { timeout: WAIT_MS },
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Translate into"), {
      target: { value: "de" },
    });
    expect(
      await screen.findByText(TRANSLATE_OUTPUT_ZIP, {}, { timeout: WAIT_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByText(TRANSLATE_OUTPUT_WITH_PDF)).toBeNull();
  });

  it("an older worker that publishes no key reads as the ZIP alone", async () => {
    const { translatePdfLanguages: _drop, ...old } = status([]);
    void _drop;
    await renderPanel(old as WorkerStatus);
    expect(
      await screen.findByText(TRANSLATE_OUTPUT_ZIP, {}, { timeout: WAIT_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByText(TRANSLATE_OUTPUT_WITH_PDF)).toBeNull();
  });
});

describe("the result card", () => {
  const results = (pdf: NonNullable<JobResults["ai"]>["pdf"]): JobResults => ({
    ai: { truncation: WINDOW, pdf },
  });

  it("offers the PDF first, then the package", async () => {
    const run = await renderPanel(status(["en"]), () => ({
      status: "completed",
      artifact: ZIP,
      more: [PDF],
      results: results({ rendered: true, pages: 1, bytes: 4 }),
    }));
    await runOnce(run);
    await waitFor(() => expect(downloads()).toHaveLength(2), {
      timeout: WAIT_MS,
    });
    expect(downloads()).toEqual([
      "statement-translated.pdf",
      "statement-translation.zip",
    ]);
    expect(screen.queryByText(TRANSLATE_PDF_NOT_DRAWN)).toBeNull();
  });

  it("offers the package alone, and says the PDF could not be drawn", async () => {
    const run = await renderPanel(status(["en"]), () => ({
      status: "completed",
      artifact: ZIP,
      results: results({ rendered: false, reason: "render_failed" }),
    }));
    await runOnce(run);
    await waitFor(() => expect(downloads()).toHaveLength(1), {
      timeout: WAIT_MS,
    });
    expect(downloads()).toEqual(["statement-translation.zip"]);
    expect(screen.getByText(TRANSLATE_PDF_NOT_DRAWN)).toBeInTheDocument();
  });

  it("says nothing about a PDF for a target the worker never offered one for", async () => {
    const run = await renderPanel(status([]), () => ({
      status: "completed",
      artifact: ZIP,
      results: results({ rendered: false, reason: "unproven_language" }),
    }));
    await runOnce(run);
    await waitFor(() => expect(downloads()).toHaveLength(1), {
      timeout: WAIT_MS,
    });
    expect(screen.queryByText(TRANSLATE_PDF_NOT_DRAWN)).toBeNull();
  });
});
