// @vitest-environment jsdom
// @native-canvas
/**
 * Translate PDF's Pages field (competitor audit #29, slice 6), driven through
 * the REAL panel, the real legacy-pdfjs extractor and the real browser job
 * client over a stubbed network (`@/tests/stub-job-network`).
 *
 * What is pinned, each against the wire (the `POST /api/jobs` body):
 *  - without `translatePageRange` on the status nothing new renders, no
 *    `pages` key is sent and the measure chunk is never fetched;
 *  - with it, "2,4" posts canonical spans and declares the SELECTION's
 *    characters and text pages (whole is not selected on this document); "1-5"
 *    is the whole document, declared as today; a page past the end and a
 *    blank chosen page are refused before upload;
 *  - a detected scan hides the field, and its OCR job carries no `pages`;
 *  - the result names the pages from the worker's record, or shows the
 *    rollback warning INSTEAD when the echo is absent or different; the
 *    sentence and a DeliveryNotice both render for a withheld job;
 *  - the worker's two page refusals, rendered by the panel, never say that
 *    nothing was charged (the route reserved the allowance first);
 *  - the server-rendered panel holds no "Pages (optional)" (the status is
 *    fetched client-side, so the field is never in static copy).
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import type { AiWindowMeta } from "@/lib/jobs/ai-results";
import type { JobResults } from "@/lib/jobs/results";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { extractPdfText, pageTextChunks } from "@/lib/pdf/text";
import { selectExtraction } from "@/lib/pdf/page-selection";
import { typedPageSpans } from "@/lib/pdf/typed-page-spans";
import { resetTelemetry } from "@/lib/telemetry/track";
import { imageOnlyPdf, textPdf } from "@/tests/pdf-text-fixtures";
import {
  stubJobNetwork,
  type JobNetwork,
  type StubbedJobOutcome,
} from "@/tests/stub-job-network";
import { NO_TEXT_IN_CHOSEN_PAGES_MESSAGE } from "@/lib/jobs/chosen-pages-no-text";
import {
  TRANSLATE_PAGES_NOT_RUNNING_MESSAGE,
  TRANSLATE_PAGES_UNCONFIRMED_MESSAGE,
  translatePagesOutOfRangeMessage,
} from "@/lib/jobs/translate-pages";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import { translateTextDeps } from "@/lib/workers/translate-client";
import { resetWorkerStatusForTests } from "./use-worker-status";
import { TranslateWorkerPanel } from "./translate-worker-panel";

const legacy = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pick<
    typeof import("pdfjs-dist"),
    "getDocument"
  >;
const realExtract = (bytes: Uint8Array) => extractPdfText(bytes, legacy);

const tool = getToolBySlug("translate-pdf")!;
const providers = getProviderReadiness("remote-configured");

function status(extra: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    mode: "remote-configured",
    enabled: true,
    localDevOnly: false,
    detail: "A server backend is configured.",
    compress: { lossless: false, deep: false, engines: [] },
    scan: { active: false, detail: "not scanned" },
    ocr: {
      available: true,
      engine: "tesseract",
      languages: ["eng"],
      detail: "OCR runs on our secure server.",
    },
    security: {
      available: true,
      operations: ["protect", "unlock"],
      detail: "qpdf runs on our secure server.",
    },
    providers: {
      ...providers,
      storage: { ...providers.storage, ready: true },
      queue: { ...providers.queue, ready: true },
    },
    daemon: { ...resolveDaemonReadiness({}), drainable: true },
    ai: resolveAiReadiness({
      PDFXYZ_AI_PROVIDER: "openai",
      PDFXYZ_AI_MODEL: "gpt-5.6-luna",
    }),
    pipeline: {
      verdict: "off",
      observed: false,
      drainable: false,
      detail: "no server observed",
    },
    ...extra,
  };
}
const WITHOUT = status();
const OFFERED = status({ translatePageRange: true });

/**
 * Five pages of DIFFERENT lengths, page 3 BLANK, so a selection's count is
 * not the whole document's and a blank chosen page exists.
 */
const PAGE_TEXT = [
  "Alpha opens the report on its first page.",
  "Beta has a much longer second page with many more words on it than the others.",
  "",
  "Delta closes the main part with a medium sentence.",
  "Epsilon ends it.",
];
async function fivePages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of PAGE_TEXT) {
    const page = doc.addPage([612, 792]);
    if (text) page.drawText(text, { x: 40, y: 700, size: 11, font });
  }
  return doc.save();
}

/** Every fetch of the lazy measure chunk, counted at its seam. */
let measureFetches = 0;
const realMeasure = translateTextDeps.measure;
translateTextDeps.measure = () => {
  measureFetches += 1;
  return realMeasure();
};

const failed = (): StubbedJobOutcome => ({
  status: "failed",
  error: {
    code: "internal_error",
    message: "The job ended for a reason unrelated to pages.",
    retryable: false,
  },
});

async function mount(
  worker: WorkerStatus,
  bytes: Uint8Array,
  outcome: (body: Record<string, unknown>) => StubbedJobOutcome = failed,
): Promise<{ network: JobNetwork; run: HTMLElement }> {
  measureFetches = 0;
  const network = stubJobNetwork(worker, outcome);
  render(
    <InToolPage tool={tool}>
      <TranslateWorkerPanel tool={tool} extractText={realExtract} />
    </InToolPage>,
  );
  const run = await screen.findByRole("button", { name: /translate pdf/i });
  const input = document.querySelector('input[type="file"]');
  expect(input, "the builder's file input").not.toBeNull();
  fireEvent.change(input!, {
    target: {
      files: [
        new File([bytes.slice()], "report.pdf", { type: "application/pdf" }),
      ],
    },
  });
  await screen.findByText("report.pdf");
  await waitFor(() =>
    expect(run.getAttribute("aria-disabled")).not.toBe("true"),
  );
  return { network, run };
}

const pagesField = () => screen.queryByLabelText(/^Pages \(optional\)/);

function typePages(value: string) {
  const field = pagesField();
  expect(field, "the Pages field").not.toBeNull();
  fireEvent.change(field!, { target: { value } });
}

/** The one job body this Run posted; fails naming the alert if none. */
async function posted(network: JobNetwork) {
  await waitFor(
    () => {
      if (network.jobBodies.length > 0) return;
      const alert = screen.queryByRole("alert");
      throw new Error(`no job posted; alert: ${alert?.textContent ?? "none"}`);
    },
    { timeout: 10_000 },
  );
  expect(network.jobBodies).toHaveLength(1);
  return network.jobBodies[0] as {
    options: Record<string, unknown>;
    declaredCharacters?: number;
    declaredTextPages?: number;
  };
}

async function alertText(): Promise<string> {
  const alert = await screen.findByRole("alert", {}, { timeout: 10_000 });
  return alert.textContent ?? "";
}

const ZIP = {
  artifact: {
    artifactId: "a_zip",
    filename: "report-translation.zip",
    contentType: "application/zip",
    bytes: 4,
    url: "/api/artifacts/local/zip",
    expiresAt: new Date(0).toISOString(),
  },
  bytes: new Uint8Array([80, 75, 3, 4]),
};

function completed(
  window: Partial<AiWindowMeta> | null,
  extra: Partial<NonNullable<JobResults["ai"]>> = {},
): () => StubbedJobOutcome {
  return () => ({
    status: "completed",
    artifact: ZIP,
    results: {
      ai: {
        ...(window
          ? {
              truncation: {
                truncated: false,
                charactersSent: 100,
                charactersTotal: 100,
                totalPages: 5,
                lastCompletePage: 5,
                cutMidPage: false,
                ...window,
              } as AiWindowMeta,
            }
          : {}),
        ...extra,
      },
    } as JobResults,
  });
}

afterEach(() => {
  resetTelemetry();
  resetWorkerStatusForTests();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Translate panel: the Pages field exists only on the worker's proof", () => {
  it("status without translatePageRange: no field, no pages key, no measure chunk", async () => {
    const bytes = await fivePages();
    const { network, run } = await mount(WITHOUT, bytes);
    expect(pagesField()).toBeNull();
    fireEvent.click(run);
    const body = await posted(network);
    expect(Object.keys(body.options)).not.toContain("pages");
    const whole = await realExtract(bytes);
    expect(body.declaredCharacters).toBe(whole.characterCount);
    expect(body.declaredTextPages).toBe(pageTextChunks(whole.pages).length);
    expect(measureFetches, "the measure chunk was fetched").toBe(0);
  }, 20_000);

  it("with the key, an EMPTY field is today's run and fetches nothing new", async () => {
    const bytes = await fivePages();
    const { network, run } = await mount(OFFERED, bytes);
    expect(pagesField()).not.toBeNull();
    fireEvent.click(run);
    const body = await posted(network);
    expect(Object.keys(body.options)).not.toContain("pages");
    expect(body.declaredCharacters).toBe(
      (await realExtract(bytes)).characterCount,
    );
    expect(measureFetches).toBe(0);
  }, 20_000);

  it("the field is a real labelled text input with its helper", async () => {
    await mount(OFFERED, await fivePages());
    const field = pagesField() as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    expect(field.type).toBe("text");
    expect(field.maxLength).toBe(200);
    expect(field.placeholder).toBe("e.g. 1-3, 8");
    const help = document.getElementById(
      field.getAttribute("aria-describedby") ?? "",
    );
    expect(help?.textContent).toBe("Leave empty for the whole document.");
  }, 20_000);

  it("the server-rendered panel holds no Pages field (the status is client-side)", () => {
    const html = renderToString(
      <InToolPage tool={tool}>
        <TranslateWorkerPanel tool={tool} extractText={realExtract} />
      </InToolPage>,
    );
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("Instructions (optional)");
    expect(html).not.toContain("Pages (optional)");
  });
});

describe("Translate panel: chosen pages reach the wire, declared as chosen", () => {
  it('"2,4" posts canonical spans and the SELECTION\'s characters and text pages', async () => {
    const bytes = await fivePages();
    const { network, run } = await mount(OFFERED, bytes);
    typePages("2,4");
    fireEvent.click(run);
    const body = await posted(network);
    expect(body.options.pages).toEqual([
      [2, 2],
      [4, 4],
    ]);
    const whole = await realExtract(bytes);
    const chosen = selectExtraction(whole, [
      [2, 2],
      [4, 4],
    ]);
    // Health: the fixture makes the two declarations differ.
    expect(chosen.characterCount).toBeLessThan(whole.characterCount);
    expect(pageTextChunks(chosen.pages).length).toBe(2);
    expect(pageTextChunks(whole.pages).length).toBe(4);
    expect(body.declaredCharacters).toBe(chosen.characterCount);
    expect(body.declaredTextPages).toBe(2);
    expect(measureFetches).toBe(1);
  }, 20_000);

  it('"1-5" names every page: the whole document, declared as today', async () => {
    const bytes = await fivePages();
    const { network, run } = await mount(OFFERED, bytes);
    typePages("1-5");
    fireEvent.click(run);
    const body = await posted(network);
    expect(Object.keys(body.options)).not.toContain("pages");
    const whole = await realExtract(bytes);
    expect(body.declaredCharacters).toBe(whole.characterCount);
    expect(body.declaredTextPages).toBe(pageTextChunks(whole.pages).length);
  }, 20_000);

  it('"6" on a five-page PDF is refused before upload, in the grammar\'s words', async () => {
    const { network, run } = await mount(OFFERED, await fivePages());
    typePages("6");
    fireEvent.click(run);
    const text = await alertText();
    const grammar = typedPageSpans("6", 5);
    expect(grammar.ok).toBe(false);
    if (grammar.ok) return;
    expect(text).toContain(`${grammar.message} Nothing was uploaded.`);
    expect(network.uploads()).toBe(0);
    expect(network.jobBodies).toEqual([]);
  }, 20_000);

  it("a blank chosen page is refused before upload with the chosen-pages sentence", async () => {
    const { network, run } = await mount(OFFERED, await fivePages());
    typePages("3");
    fireEvent.click(run);
    const text = await alertText();
    expect(text).toContain(
      `${NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["translate-pdf"]} Nothing was uploaded.`,
    );
    expect(network.uploads()).toBe(0);
    expect(network.jobBodies).toEqual([]);
  }, 20_000);

  it("chosen pages that are each too long for one pass get the chosen-pages sentence", async () => {
    const over = TRANSLATE_MAX_INPUT_CHARS + 2_000;
    const { network, run } = await mount(
      OFFERED,
      await textPdf([400, over, 400, over, 400]),
    );
    typePages("2,4");
    fireEvent.click(run);
    const text = await alertText();
    expect(text).toMatch(/^Every page you chose that has text holds more/);
    expect(network.uploads()).toBe(0);
  }, 30_000);
});

describe("Translate panel: a detected scan gets no page choice", () => {
  it("hides the field, and the OCR job carries no pages", async () => {
    const { network, run } = await mount(
      { ...OFFERED, translateOcr: true },
      await imageOnlyPdf(2),
    );
    await screen.findByRole(
      "region",
      { name: /recognise the scan/i },
      { timeout: 5_000 },
    );
    expect(pagesField()).toBeNull();
    fireEvent.click(run);
    const body = await posted(network);
    expect(body.options.ocr).toBe(true);
    expect(Object.keys(body.options)).not.toContain("pages");
    expect(measureFetches).toBe(0);
  }, 20_000);
});

describe("Translate panel: the result names the chosen pages, or warns", () => {
  const CHOSEN: [number, number][] = [
    [2, 2],
    [4, 4],
  ];

  async function runChosen(outcome: () => StubbedJobOutcome) {
    const { run } = await mount(OFFERED, await fivePages(), outcome);
    typePages("2,4");
    fireEvent.click(run);
    return screen.findByRole(
      "button",
      { name: /download report-translation\.zip/i },
      { timeout: 10_000 },
    );
  }

  it("an echo equal to the request: the sentence, no warning", async () => {
    await runChosen(completed({ pagesSent: CHOSEN }));
    expect(
      await screen.findByText(
        "You chose pages 2 and 4 of 5. No other page was sent to the AI model.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(TRANSLATE_PAGES_UNCONFIRMED_MESSAGE)).toBeNull();
  }, 20_000);

  it.each([
    ["absent (an image without the key)", {}],
    ["different (a filter that did nothing)", { pagesSent: [[1, 5]] }],
    ["a superset", { pagesSent: [[2, 4]] }],
  ] as const)(
    "an echo %s: the warning INSTEAD of the sentence",
    async (_name, window) => {
      await runChosen(completed(window as Partial<AiWindowMeta>));
      expect(
        await screen.findByText(TRANSLATE_PAGES_UNCONFIRMED_MESSAGE),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^You chose /)).toBeNull();
    },
    20_000,
  );

  it("a withheld tail: the sentence AND the DeliveryNotice both render", async () => {
    await runChosen(
      completed(
        { pagesSent: CHOSEN },
        {
          delivery: {
            deliveredPages: 1,
            withheldPages: 1,
            boundBy: "characters",
          },
        },
      ),
    );
    expect(
      await screen.findByText(
        "You chose pages 2 and 4 of 5. No other page was sent to the AI model.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Translated 1 of 2 pages\./)).toBeInTheDocument();
  }, 20_000);

  it("a whole-document run shows no selection sentence and no warning", async () => {
    const { run } = await mount(OFFERED, await fivePages(), completed({}));
    fireEvent.click(run);
    await screen.findByRole(
      "button",
      { name: /download report-translation\.zip/i },
      { timeout: 10_000 },
    );
    expect(screen.queryByText(/^You chose /)).toBeNull();
    expect(screen.queryByText(TRANSLATE_PAGES_UNCONFIRMED_MESSAGE)).toBeNull();
  }, 20_000);
});

describe("Translate panel: the worker's page refusals never say nothing was charged", () => {
  const CHARGE_DENIAL =
    /nothing (was )?charged|not (been )?charged|did not count|free of charge/i;

  it("positive control: the route's own refusal DOES say it", () => {
    expect(TRANSLATE_PAGES_NOT_RUNNING_MESSAGE).toMatch(CHARGE_DENIAL);
  });

  it.each([
    ["pages_out_of_range", translatePagesOutOfRangeMessage(5, [6, 6])],
    ["chosen-pages no_text", NO_TEXT_IN_CHOSEN_PAGES_MESSAGE["translate-pdf"]],
  ])(
    "%s, rendered by the panel",
    async (_name, message) => {
      const { run } = await mount(OFFERED, await fivePages(), () => ({
        status: "failed",
        error: { code: "unprocessable_entity", message, retryable: false },
      }));
      typePages("2,4");
      fireEvent.click(run);
      const alert = await screen.findByRole("alert", {}, { timeout: 10_000 });
      const text = alert.textContent ?? "";
      expect(text).toContain(message);
      expect(text).not.toMatch(CHARGE_DENIAL);
      expect(within(alert).queryByText(CHARGE_DENIAL)).toBeNull();
    },
    20_000,
  );
});
