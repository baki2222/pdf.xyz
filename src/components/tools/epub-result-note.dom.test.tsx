// @vitest-environment jsdom
/**
 * The EPUB note reaches the PAGE, in both places a finished book is shown
 * (wave 3 review of audit epub-to-pdf#3/#4, CLAUDE.md rule 5).
 *
 * `epub-result-note.test.tsx` holds the chain up to the component. It could
 * not see the component unwired: deleting the panel's
 * `{mode === "epub" && <EpubResultNote ... />}` left every EPUB test green
 * (review mutant panel-unwired), and a batch of books never showed the note
 * at all, while the FAQ said "the note beside the download says how many".
 *
 * Here the REAL panel is driven through the REAL job client over a stubbed
 * network (`stubJobNetwork`, not `vi.mock`: `isolate: false`) to a completed
 * job whose `results.epub` says one font was left out, and the page is read:
 *   - one book: the result card carries the sentence;
 *   - two books: each finished row of the batch carries it;
 *   - control: the same jobs with nothing to say show no sentence, so the
 *     sentence above is the job's, not the page's.
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
import { getToolBySlug } from "@/lib/tools";
import type { JobResults } from "@/lib/jobs/results";
import type { WorkerStatus } from "@/lib/workers/status";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
import { stubJobNetwork } from "@/tests/stub-job-network";
import { epub3Book } from "@/tests/epub-fixtures";
import { HtmlRenderWorkerPanel } from "./html-render-worker-panel";
import { epubResultSentence } from "./epub-result-note";

const READY = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "remote",
  compress: { lossless: false, deep: false, engines: [] },
  ocr: { available: false, engine: null, languages: [], detail: "off" },
  scan: { active: false, detail: "not scanned" },
  security: { available: true, operations: [], detail: "qpdf" },
  providers: {
    storage: { ready: true },
    queue: { ready: true },
    processor: { ready: true },
  },
  daemon: { drainable: true, detail: "ready" },
  ai: { ready: false },
  pipeline: { verdict: "off", observed: false, drainable: false, detail: "" },
} as unknown as WorkerStatus;

const tool = getToolBySlug("epub-to-pdf")!;

/**
 * The waits here: the panel's lazy chunks and Run's readiness (3 s, as
 * `worker-batches.dom.test.tsx` measured for the same panels on CI), and a
 * batch's end (5 s, that file's `BATCH_END_MS`). The test's own limit sits
 * above both.
 */
const WAIT_MS = 3_000;
const BATCH_END_MS = 5_000;
const TEST_MS = 20_000;

const LEFT_OUT: JobResults = {
  epub: {
    chapters: 3,
    extraSections: 0,
    extraSectionsLeftOut: 0,
    fontsRestored: 0,
    fontsLeftOut: 1,
  },
};
const NOTHING: JobResults = {
  epub: {
    chapters: 3,
    extraSections: 0,
    extraSectionsLeftOut: 0,
    fontsRestored: 1,
    fontsLeftOut: 0,
  },
};
const SENTENCE = epubResultSentence({ results: LEFT_OUT } as never)!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function network(results: JobResults) {
  let n = 0;
  return stubJobNetwork(READY, () => {
    n += 1;
    return {
      status: "completed",
      artifact: {
        artifact: {
          artifactId: `art_${n}`,
          filename: `book-${n}.pdf`,
          contentType: "application/pdf",
          bytes: 8,
          url: `/__art/${n}`,
          expiresAt: new Date(0).toISOString(),
        },
        bytes: new TextEncoder().encode("%PDF-out"),
      },
      results,
    };
  });
}

async function drop(count: number) {
  const bytes = await epub3Book();
  const view = render(
    <InToolPage tool={tool}>
      <HtmlRenderWorkerPanel tool={tool} />
    </InToolPage>,
  );
  const input = await waitFor(
    () => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).not.toBeNull();
      return el!;
    },
    { timeout: WAIT_MS },
  );
  const files = Array.from(
    { length: count },
    (_, i) =>
      new File([bytes as BlobPart], `book-${i + 1}.epub`, {
        type: "application/epub+zip",
      }),
  );
  fireEvent.change(input, { target: { files } });
  return view;
}

async function runOne(results: JobResults) {
  const net = network(results);
  const view = await drop(1);
  const run = await screen.findByRole(
    "button",
    { name: "Convert to PDF" },
    { timeout: WAIT_MS },
  );
  await waitFor(() => expect(run).not.toBeDisabled(), { timeout: WAIT_MS });
  await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"), {
    timeout: WAIT_MS,
  });
  fireEvent.click(run);
  await screen.findAllByText("Your PDF is ready.", {}, { timeout: WAIT_MS });
  expect(net.jobBodies).toHaveLength(1);
  return view;
}

async function runTwo(results: JobResults) {
  const net = network(results);
  const view = await drop(2);
  const { verb, noun } = WORKER_BATCH_TOOLS["epub-to-pdf"];
  const run = await screen.findByRole(
    "button",
    { name: `${verb} 2 ${noun[1]}` },
    { timeout: WAIT_MS },
  );
  await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"), {
    timeout: WAIT_MS,
  });
  fireEvent.click(run);
  await screen.findByText(
    "Batch complete. 2 done, 0 failed.",
    {},
    { timeout: BATCH_END_MS },
  );
  expect(net.jobBodies).toHaveLength(2);
  return view;
}

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe("the EPUB note on the page", () => {
  it("health: the sentence the jobs should produce is a real sentence", () => {
    expect(SENTENCE).toContain("could not be restored");
    expect(epubResultSentence({ results: NOTHING } as never)).toBeNull();
  });

  it(
    "one book: the result card says the job's font count",
    async () => {
      const view = await runOne(LEFT_OUT);
      expect(occurrences(view.container.textContent ?? "", SENTENCE)).toBe(1);
    },
    TEST_MS,
  );

  it(
    "control: one book with nothing to say shows no sentence",
    async () => {
      const view = await runOne(NOTHING);
      expect(view.container.textContent).not.toContain("could not be restored");
    },
    TEST_MS,
  );

  it(
    "two books: each finished row says its job's font count",
    async () => {
      const view = await runTwo(LEFT_OUT);
      expect(occurrences(view.container.textContent ?? "", SENTENCE)).toBe(2);
    },
    TEST_MS,
  );

  it(
    "control: a batch with nothing to say shows no sentence",
    async () => {
      const view = await runTwo(NOTHING);
      expect(view.container.textContent).not.toContain("could not be restored");
    },
    TEST_MS,
  );
});
