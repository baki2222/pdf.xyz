// @vitest-environment jsdom
// @native-canvas
/**
 * The Chat with PDF panel, tested for the one thing it could not previously do: hold a
 * conversation.
 *
 * Every layer beneath this component — the job contract, the client driver, the engine,
 * both AI providers — has always accepted prior conversation turns, and each has tests
 * proving it. The panel never produced any, so `contextTurns` was 0 on every request the
 * product ever made, a tool named "Chat with PDF" answered each question as if it were
 * the first, and the engine's `cacheSystem: true` bet (justified there as "the only AI
 * tool that takes prior turns") had nothing to collect on.
 *
 * The load-bearing assertion is therefore on the SECOND request's `context`. To keep it
 * from passing for the wrong reason, the stubbed worker returns a package built by the
 * REAL engine — so the answer the panel shows and carries forward is one that was really
 * recovered from a real package, not a string handed to the component by the test.
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText, type ExtractedPdfText } from "@/lib/pdf/text";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import {
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
} from "@/lib/jobs/chat-with-pdf";
import { JOB_LIMITS } from "@/lib/jobs/types";
import { parseCreateJobRequest } from "@/lib/jobs/validation";
import { runWorkerChatWithPdf as realRunWorkerChatWithPdf } from "@/lib/workers/chat-with-pdf-client";
import type { AiProvider } from "@/lib/workers/ai/provider";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import { resetTelemetry } from "@/lib/telemetry/track";
import { chatAnswerOutputName } from "@/lib/jobs/chat-with-pdf";
import { ChatWithPdfWorkerPanel } from "./chat-with-pdf-worker-panel";
import { PAGE_TEXT_LIMIT } from "./ai-result-limits";
import { pageImageDeps } from "./runner/use-page-image";

// The job driver and the document measurement are handed to the panel as
// props. They used to be swapped in with `vi.mock` on the client module, which
// left the panel cached bound to these stubs for any later test file in the
// same worker; the pick-refusal guard renders every worker panel, so it would
// have been that file. Running the real pdfjs in jsdom on a three-byte file
// would measure nothing, so the measurement is stubbed too — as a prop.
const runWorkerChatWithPdf = vi.fn();
const measureChatDocument = vi.fn();
const resumeChatJob = vi.fn();
const MEASURED = { characters: 2_140, textPages: 3, pageCount: 3 };

const chatTool = getToolBySlug("chat-with-pdf")!;

/** The panel as the page mounts it, with only the two network-bound seams stubbed. */
function Panel() {
  return (
    <InToolPage tool={chatTool}>
      <ChatWithPdfWorkerPanel
        tool={chatTool}
        runChat={runWorkerChatWithPdf}
        measureChat={measureChatDocument}
        resumeChat={resumeChatJob}
      />
    </InToolPage>
  );
}

const providers = getProviderReadiness("remote-configured");

/** A deployment where the whole pipeline AND an AI provider are ready. */
const READY: WorkerStatus = {
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
};

function stubStatus() {
  measureChatDocument.mockResolvedValue({ kind: "counted", count: MEASURED });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => READY }),
  );
}

// --- a real package from the real engine -----------------------------------

function extractor(): (bytes: Uint8Array) => Promise<ExtractedPdfText> {
  const text = "Invoice total: $1,240.00. Due 30 June 2026.";
  return async () => ({
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: true,
  });
}

function provider(answer: string): AiProvider {
  return {
    id: "openai",
    model: "gpt-5.6-luna",
    async complete() {
      return {
        ok: true,
        text: answer,
        model: "gpt-5.6-luna",
        usage: { inputTokens: 40, outputTokens: 9 },
      };
    },
  };
}

/** What the driver resolves to: a genuine engine-built ZIP, wrapped as a job result. */
async function workerSuccess(question: string, answer: string) {
  const run = await runChatWithPdf(
    new Uint8Array([1, 2, 3]),
    { question },
    {
      extract: extractor(),
      provider: provider(answer),
    },
  );
  if (!run.ok) throw new Error(`engine failed: ${run.message}`);
  return {
    ok: true as const,
    job: { id: "job_test" },
    artifact: { filename: "answer.zip", url: "blob:answer" },
    output: run.output,
  };
}

/** The request body the driver was called with on `index`, asserted to exist. */
function requestAt(index: number): {
  question: string;
  context?: { role: string; content: string }[];
} {
  const call = runWorkerChatWithPdf.mock.calls.at(index);
  expect(call).toBeDefined();
  return call![0];
}

/**
 * The answer as a reader sees it: ONE paragraph whose whole text is `answer`.
 * Since 2026-11-15 (audit #30) a `[p.N]` marker is a button inside that
 * paragraph, so its own text nodes no longer spell the answer and a plain
 * `findByText(answer)` finds nothing; the visible text is still verbatim.
 */
function shownAnswer(answer: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === "P" && element.textContent === answer;
}

/** Attach a PDF and submit `question`, waiting for the panel to settle. */
async function ask(question: string) {
  const input = document.querySelector('input[type="file"]');
  if (input) {
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "invoice.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
  }
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: question },
  });
  const submit = screen.getByRole("button", {
    name: /ask the pdf|send follow-up/i,
  });
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
}

afterEach(() => {
  resetTelemetry();
  runWorkerChatWithPdf.mockReset();
  measureChatDocument.mockReset();
  resumeChatJob.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatWithPdfWorkerPanel — follow-up questions", () => {
  it("sends the first question with no context, then carries the real exchange into the second", async () => {
    const first = "What is the total?";
    const second = "And when is it due?";
    const answer = "The total is $1,240.00 [p.1].";

    stubStatus();
    runWorkerChatWithPdf
      .mockImplementationOnce(() => workerSuccess(first, answer))
      .mockImplementationOnce(() =>
        workerSuccess(second, "It is due on 30 June 2026 [p.1]."),
      );

    render(<Panel />);
    await screen.findByRole("textbox");

    await ask(first);
    // The answer really came out of the package — nothing here supplied it as a string.
    expect(await screen.findByText(shownAnswer(answer))).toBeInTheDocument();

    // A first question is a fresh conversation: sending an empty `context` would be a
    // different request than the one the contract expects for a standalone question.
    expect(requestAt(0)).not.toHaveProperty("context");

    await ask(second);
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(2));

    // THE point of the change: the follow-up carries the previous exchange.
    expect(requestAt(1).context).toEqual([
      { role: "user", content: first },
      { role: "assistant", content: answer },
    ]);
  });

  it("states what the next question will carry, so the transcript never overstates it", async () => {
    stubStatus();
    runWorkerChatWithPdf.mockImplementation(() =>
      workerSuccess("Q one", "A one."),
    );

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q one");

    expect(
      await screen.findByText(/sent with the previous exchange as context/i),
    ).toBeInTheDocument();
    // And the fact that makes the re-upload comprehensible rather than surprising.
    // INVERTED 2026-11-06 (audit #41): this pinned "our server keeps nothing
    // between questions", which was false — each answer ZIP (question and
    // answer inside) is stored for the output lifetime. The FAQ was narrowed
    // to "does not link one question to the next" on 2026-09-27; the panel
    // sentence was missed, and this assertion held it in place.
    expect(
      screen.getByText(/our server does not link one question to the next/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/keeps nothing/i)).toBeNull();
  });

  it("keeps an unreadable answer out of context instead of guessing what the model said", async () => {
    stubStatus();
    // A package whose `answer.txt` does not match the question asked — the panel cannot
    // know what was answered, so it must not invent a turn.
    runWorkerChatWithPdf
      .mockImplementationOnce(async () => ({
        ...(await workerSuccess("a different question", "Some answer.")),
      }))
      .mockImplementationOnce(() => workerSuccess("second", "Second answer."));

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("What is the total?");

    expect(
      await screen.findByText(/could not be read here/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Some answer.")).not.toBeInTheDocument();

    await ask("second");
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(2));
    expect(requestAt(1)).not.toHaveProperty("context");
    expect(
      screen.getByText(/1 unreadable answer is excluded/i),
    ).toBeInTheDocument();
  });

  it("drops the conversation when the document is swapped", async () => {
    stubStatus();
    runWorkerChatWithPdf.mockImplementation(() =>
      workerSuccess("Q one", "A one."),
    );

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q one");
    expect(await screen.findByText("A one.")).toBeInTheDocument();

    // Turns about the previous PDF must never be sent as context for a new one.
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() =>
      expect(screen.queryByText("A one.")).not.toBeInTheDocument(),
    );
  });

  it("discards an answer for a document the user already replaced", async () => {
    // The swap test above only covers a settled conversation. This is the dangerous
    // shape: a job runs for seconds to minutes and nothing stops the PDF being replaced
    // while one is in flight, so the answer for document A can land after the user has
    // moved on to document B. Appending it would show A's exchange under B, and send it
    // as context for B's next question — the model asked about one file while shown
    // another.
    stubStatus();
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    runWorkerChatWithPdf.mockImplementation(async () => {
      await inFlight;
      return workerSuccess("Q about A", "A's answer.");
    });

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q about A");
    // The request must actually be IN FLIGHT before the swap — the shape this
    // test is about. Since 2026-09-27 the panel measures the document before
    // it sends anything, so a swap made immediately would land during the
    // measurement, send nothing, and let the assertions below pass for a
    // different reason than the one they were written for.
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(1));

    // Swap the document while the request is still running.
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File([new Uint8Array([9])], "other.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });

    release();
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(1));
    // A's answer belongs to no document on screen, so it must not appear at all.
    await waitFor(() =>
      expect(screen.queryByText("A's answer.")).not.toBeInTheDocument(),
    );

    // ...and must not travel as context for the document that replaced it.
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Q about B" },
    });
    // FOUND, not got: A's job is still settling here — the button reads
    // "Answering…" until it does. The shared job hook (wave-1 L03, merged
    // 2026-09-28) adds awaits between the answer and the end of the run, and
    // under a full parallel run this query landed before them.
    const submit = await screen.findByRole("button", {
      name: /ask the pdf|send follow-up/i,
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(2));
    expect(requestAt(1).context).toBeUndefined();
  });

  it("says out loud when an exchange was shortened to fit the request", async () => {
    // The disclosure existed but nothing asserted it, so it could have silently stopped
    // rendering. A transcript that shows more than was actually sent is the same lie as
    // a capability reported from wiring instead of behaviour.
    stubStatus();
    const long = "y".repeat(6000);
    runWorkerChatWithPdf.mockImplementation(() => workerSuccess("Q one", long));

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q one");
    await screen.findByText(/shortened/i);

    // And what actually goes on the wire really is shortened, not merely described so.
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Q two" },
    });
    const submit = screen.getByRole("button", {
      name: /ask the pdf|send follow-up/i,
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(2));
    const sent = requestAt(1).context ?? [];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((turn) => turn.content.length < long.length)).toBe(true);
  });

  it("never sends more prior turns than the contract allows", async () => {
    stubStatus();
    runWorkerChatWithPdf.mockImplementation((input: { question: string }) =>
      workerSuccess(input.question, `Answer to ${input.question}.`),
    );

    render(<Panel />);
    await screen.findByRole("textbox");

    const rounds = MAX_CONTEXT_TURNS / 2 + 2;
    for (let i = 0; i < rounds; i++) {
      await ask(`Question ${i}`);
      expect(
        await screen.findByText(`Answer to Question ${i}.`),
      ).toBeInTheDocument();
    }
    await ask("one more");
    await waitFor(() =>
      expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(rounds + 1),
    );

    const sent = requestAt(-1).context!;
    expect(sent).toHaveLength(MAX_CONTEXT_TURNS);
    // The recent end survives; the transcript says so rather than implying the model
    // was told everything on screen.
    expect(sent.at(-1)?.content).toBe(`Answer to Question ${rounds - 1}.`);
    expect(
      screen.getByText(/oldest exchanges are left out/i),
    ).toBeInTheDocument();
  });
});

describe("ChatWithPdfWorkerPanel — what each question declares", () => {
  /**
   * Until 2026-09-27 the panel declared nothing, so every question reserved a
   * whole call's worth of the daily allowance — a third of the day for a
   * question about one page, and three questions the whole day's chat. Each
   * question now declares the document's characters, measured ONCE per file —
   * the document does not change between questions. The declaration is read
   * here off the request the DRIVER receives, which is what goes on the wire
   * (`workers/chat-allowance.chain.test.ts` follows it from there through the
   * real route and limiter).
   *
   * Two lanes wrote this block the same day with two measuring helpers; the
   * panel keeps `measureChatDocument`, because only it tells a scan (upload
   * nothing) from a file the browser could not read (send it undeclared).
   */
  it("declares the document it measured on every question, measuring it once per file", async () => {
    stubStatus();
    runWorkerChatWithPdf
      .mockImplementationOnce(() => workerSuccess("Q one", "A one [p.1]."))
      .mockImplementationOnce(() => workerSuccess("Q two", "A two [p.1]."));

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q one");
    await screen.findByText(shownAnswer("A one [p.1]."));
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Q two" },
    });
    const submit = screen.getByRole("button", { name: /send follow-up/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(2));

    for (const index of [0, 1]) {
      expect(
        (requestAt(index) as { documentCharacters?: unknown })
          .documentCharacters,
        `question ${index + 1} went out without the document's count, so it ` +
          "reserves a whole call's worth of the daily allowance",
      ).toBe(MEASURED.characters);
    }
    // Once per FILE: a follow-up re-sends the same document, not a new one.
    expect(
      measureChatDocument,
      "the same document was re-measured for a follow-up question",
    ).toHaveBeenCalledTimes(1);
  });

  it("measures again after the document is swapped", async () => {
    stubStatus();
    runWorkerChatWithPdf.mockImplementation(() =>
      workerSuccess("Q one", "A one [p.1]."),
    );

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q one");
    expect(
      await screen.findByText(shownAnswer("A one [p.1].")),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    measureChatDocument.mockResolvedValueOnce({
      kind: "counted",
      count: { characters: 99, textPages: 1, pageCount: 1 },
    });
    await ask("Q one");
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(2));
    expect(
      (requestAt(1) as { documentCharacters?: unknown }).documentCharacters,
      "a new document was charged at the previous document's size",
    ).toBe(99);
    expect(measureChatDocument).toHaveBeenCalledTimes(2);
  });

  it("goes undeclared, not refused, when the browser cannot read the PDF", async () => {
    stubStatus();
    measureChatDocument.mockResolvedValue({ kind: "uncounted" });
    runWorkerChatWithPdf.mockImplementationOnce(() =>
      workerSuccess("Q", "A [p.1]."),
    );
    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q");
    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(1));
    expect(
      (requestAt(0) as { documentCharacters?: unknown }).documentCharacters,
    ).toBeNull();
  });

  it("uploads nothing, and says why, for a PDF with no selectable text", async () => {
    stubStatus();
    measureChatDocument.mockResolvedValue({ kind: "no-text" });
    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q");
    expect(await screen.findByText(/no selectable text/i)).toBeInTheDocument();
    expect(screen.getByText(/run OCR PDF first/i)).toBeInTheDocument();
    expect(runWorkerChatWithPdf).not.toHaveBeenCalled();
  });
});

describe("ChatWithPdfWorkerPanel — the window the answer came from", () => {
  /**
   * The load-bearing case: the model answered with a confident denial and said
   * NOTHING about its window. That is not a hypothetical — it is the shape of
   * the original defect, and it is the shape a model still produces when it
   * declines the prompt instruction. So the panel's notice must come from the
   * job record's counts, never from the model's words.
   */
  it("states the page bound even when the answer does not mention it", async () => {
    const question = "When is it due?";
    const denial = "The document does not state a due date.";

    stubStatus();
    runWorkerChatWithPdf.mockImplementationOnce(async () => {
      const success = await workerSuccess(question, denial);
      return {
        ...success,
        job: {
          ...success.job,
          results: {
            ai: {
              truncation: {
                truncated: true,
                charactersSent: 500_000,
                charactersTotal: 1_600_000,
                totalPages: 400,
                lastCompletePage: 131,
                cutMidPage: true,
              },
            },
          },
        },
      };
    });

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask(question);

    // The answer is shown verbatim — the denial is not edited or suppressed.
    expect(await screen.findByText(denial)).toBeInTheDocument();

    // And beside it, the fact that makes the denial readable: a named page.
    const notice = await screen.findByText(/pages 1–131 of 400/);
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toMatch(/cut mid-page/);
    expect(
      screen.getByText(/may only mean it is not in the pages that were read/),
    ).toBeInTheDocument();
  });

  it("shows no notice when the whole document was read", async () => {
    const question = "What is the total?";
    stubStatus();
    runWorkerChatWithPdf.mockImplementationOnce(async () => {
      const success = await workerSuccess(question, "The total is $1,240.00.");
      return {
        ...success,
        job: {
          ...success.job,
          results: {
            ai: {
              truncation: {
                truncated: false,
                charactersSent: 42,
                charactersTotal: 42,
                totalPages: 1,
                lastCompletePage: 1,
                cutMidPage: false,
              },
            },
          },
        },
      };
    });

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask(question);

    expect(await screen.findByText(/The total is/)).toBeInTheDocument();
    // A caveat on a complete reading would be its own false claim.
    expect(screen.queryByText(/could be read/)).not.toBeInTheDocument();
  });
});

describe("ChatWithPdfWorkerPanel — every answer carries its caveat", () => {
  /**
   * The chat bubble is the one surface every user reads, and the panel above
   * it used to say the model "never invents an answer". The only safeguard is
   * a prompt instruction, so each rendered answer carries a plain caveat —
   * not conditional on citations, which an ungrounded answer does not have.
   */
  it("renders the caveat under each answer, one per answer", async () => {
    const { AI_ANSWER_CAVEAT } = await import("./chat-with-pdf-worker-panel");
    stubStatus();
    runWorkerChatWithPdf
      .mockImplementationOnce(() => workerSuccess("Q1?", "First [p.1]."))
      .mockImplementationOnce(() => workerSuccess("Q2?", "Second [p.1]."));

    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q1?");
    expect(
      await screen.findByText(shownAnswer("First [p.1].")),
    ).toBeInTheDocument();
    expect(screen.getAllByText(AI_ANSWER_CAVEAT)).toHaveLength(1);

    await ask("Q2?");
    expect(
      await screen.findByText(shownAnswer("Second [p.1].")),
    ).toBeInTheDocument();
    expect(screen.getAllByText(AI_ANSWER_CAVEAT)).toHaveLength(2);
    expect(AI_ANSWER_CAVEAT).toMatch(/AI-generated/);
  });
});

describe("ChatWithPdfWorkerPanel — how a longer file's pages are chosen", () => {
  /**
   * Brief step 6 (audit #30, slice 3): the line describing page selection is
   * a claim about ONE worker image's algorithm, so only an OBSERVED
   * `chatRetrieval: true` may turn it on. `status.chatRetrieval` is already
   * the observed predicate (status.ts folds `workerObserved` in), so the
   * panel's job is to treat anything but `true` as silence. The ready-note
   * (the day's allowance) is the health check: it proves the slot rendered
   * its ready state, so an absent line is the gate, not a slot that never
   * opened.
   */
  async function renderWith(status: WorkerStatus | null) {
    measureChatDocument.mockResolvedValue({
      kind: "counted",
      count: MEASURED,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          status === null
            ? { ok: false, status: 503, json: async () => ({}) }
            : { ok: true, json: async () => status },
        ),
    );
    const { aiDailyAllowanceNote } =
      await import("@/lib/workers/ai-tool-availability");
    const { chatRetrievalPanelLine, CHAT_RETRIEVAL_ANCHOR_SHARE } =
      await import("@/lib/pdf/chat-retrieval-anchor");
    render(<Panel />);
    return {
      line: chatRetrievalPanelLine(CHAT_RETRIEVAL_ANCHOR_SHARE),
      ready: aiDailyAllowanceNote(chatTool.slug),
    };
  }

  it("says it when the observed worker proves chatRetrieval", async () => {
    const { line, ready } = await renderWith({ ...READY, chatRetrieval: true });
    expect(await screen.findByText(ready)).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
    // The line brings its own reserve, inline (no new utility class: the
    // shared stylesheet is at its ceiling), and only with the line.
    const slot = document.querySelector('[data-slot="worker-status"]')!;
    expect(slot.getAttribute("class")).toBe(MAIN_SLOT_CLASS);
    expect(slot.getAttribute("style") ?? "").toMatch(/min-height:/);
  });

  /**
   * The slot exactly as main rendered it (2026-11-16, origin/main): while
   * the line is off, the page-selection line costs no reader any height.
   */
  const MAIN_SLOT_CLASS =
    "grid grid-cols-1 content-start min-h-[28.5rem] sm:min-h-[20rem] lg:min-h-[22.5rem]";

  for (const [name, status] of [
    ["the key is absent (an older image)", READY],
    ["the key is false", { ...READY, chatRetrieval: false }],
  ] as const) {
    it(`keeps main's slot, byte for byte, when ${name}`, async () => {
      const { ready } = await renderWith(status);
      expect(await screen.findByText(ready)).toBeInTheDocument();
      const slot = document.querySelector('[data-slot="worker-status"]')!;
      expect(slot.getAttribute("data-state")).toBe("run");
      expect(slot.getAttribute("class")).toBe(MAIN_SLOT_CLASS);
      expect(slot.hasAttribute("style")).toBe(false);
    });
  }

  for (const [name, status] of [
    ["the key is absent (an older image)", READY],
    ["the key is false", { ...READY, chatRetrieval: false }],
  ] as const) {
    it(`says nothing when ${name}`, async () => {
      const { line, ready } = await renderWith(status);
      expect(await screen.findByText(ready)).toBeInTheDocument();
      expect(screen.queryByText(line)).toBeNull();
      expect(document.body.textContent).not.toMatch(/less common words/);
    });
  }

  it("says nothing when the status cannot be read", async () => {
    const { line } = await renderWith(null);
    await screen.findByRole("textbox");
    // Give the failed status fetch time to settle before reading absence.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(line)).toBeNull();
    expect(document.body.textContent).not.toMatch(/less common words/);
  });

  it("the line follows the measured anchor share, both arms", async () => {
    // A sentence typed for one outcome of the sweep would be a constant with
    // no relationships (rule 3); this pins both outcomes and which one ships.
    const { chatRetrievalPanelLine, CHAT_RETRIEVAL_ANCHOR_SHARE } =
      await import("@/lib/pdf/chat-retrieval-anchor");
    const anchored = chatRetrievalPanelLine(1 / 2);
    const pure = chatRetrievalPanelLine(0);
    expect(anchored).toBe(
      "For a longer file, each question is sent the opening pages plus any pages that share enough of its less common words.",
    );
    expect(pure).toBe(
      "For a longer file, each question is sent the pages that share enough of its less common words, or the opening pages when none do.",
    );
    expect(chatRetrievalPanelLine(1 / 8)).toBe(anchored);
    expect(chatRetrievalPanelLine(CHAT_RETRIEVAL_ANCHOR_SHARE)).toBe(
      CHAT_RETRIEVAL_ANCHOR_SHARE > 0 ? anchored : pure,
    );
    // The selector reads the same number the panel does.
    const retrieval = await import("@/lib/pdf/page-retrieval");
    expect(retrieval.CHAT_RETRIEVAL_ANCHOR_SHARE).toBe(
      CHAT_RETRIEVAL_ANCHOR_SHARE,
    );
  });
});

describe("ChatWithPdfWorkerPanel — what the job declares", () => {
  it("sends the extracted character count with its job, not nothing", async () => {
    // Review of 2026-09-28: the only panel-level assertion checked that the
    // key was PRESENT, and a present key holding `undefined` passed it — an
    // undeclared chat-with-pdf job reserves a third of the day. A REAL
    // pdf-lib PDF, counted by the real extractor, dropped into the panel; the
    // driver must receive that count. (The driver is this file's stub; the
    // MEASUREMENT is the panel's own default — `measureChatDocument` over the
    // real `extractPdfText` — and the client → wire → route half is
    // `per-call-declared.chain.test.ts`.)
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    for (let l = 0; l < 8; l += 1) {
      page.drawText(`Invoice 2026-0412, line ${l + 1}: total 1200.`, {
        x: 20,
        y: 760 - l * 18,
        size: 10,
        font,
      });
    }
    const bytes = await doc.save();
    const counted = (await extractPdfText(bytes)).characterCount;
    // Health: a real count, so equality below means THIS document's count.
    expect(counted).toBeGreaterThan(100);

    stubStatus();
    runWorkerChatWithPdf.mockResolvedValue({ ok: false, message: "stop" });
    // No `measureChat`: the panel measures the dropped file itself.
    render(
      <InToolPage tool={chatTool}>
        <InToolPage tool={chatTool}>
          <ChatWithPdfWorkerPanel
            tool={chatTool}
            runChat={runWorkerChatWithPdf}
          />
        </InToolPage>
      </InToolPage>,
    );
    await screen.findByRole("textbox");
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [
          new File([bytes.slice()], "invoice.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "What is the total?" },
    });
    const submit = screen.getByRole("button", { name: /ask the pdf/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => expect(runWorkerChatWithPdf).toHaveBeenCalledTimes(1));
    // Only the DOCUMENT is declared; the route measures the question itself.
    expect(runWorkerChatWithPdf.mock.calls[0]![0].documentCharacters).toBe(
      counted,
    );
  });
});

/**
 * Audit #19, at the point of consumption. The conversation module sizes the context
 * around the question (`buildChatContext(exchanges, question)`), and its own tests
 * prove that — but the PANEL is where the question and the context meet, and a panel
 * that went back to `buildChatContext(carryable)` passed every one of them (review of
 * 2026-11-06: reverted, 73/73 green). So here the follow-up goes through the panel AND
 * the real client driver, and the assertion is on the `POST /api/jobs` body as it
 * leaves, judged by the route's own `parseCreateJobRequest`.
 */
describe("ChatWithPdfWorkerPanel — a long follow-up still fits the job request", () => {
  /** The first exchange: long and Bengali, so the context alone nearly fills 8 KB. */
  const FIRST_QUESTION = "নোটিশ ".repeat(300).trim();
  const FIRST_ANSWER = "উত্তর ".repeat(1000).trim();

  /** The real driver over a wire that records the job-create body and answers with
   * the route's own verdict on it. */
  function wire(bodies: Record<string, unknown>[]) {
    const reply = (
      status: number,
      json: unknown,
      bytes = new ArrayBuffer(0),
    ) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      arrayBuffer: async () => bytes,
    });
    return async (input: string, init?: { body?: ArrayBuffer }) => {
      if (input === "/api/uploads")
        return reply(200, {
          uploadId: "up",
          slots: [
            { fileId: "f_1234567890", url: "/put", method: "PUT", headers: {} },
          ],
        });
      if (input === "/put") return reply(200, {});
      if (input === "/api/jobs") {
        const raw = new TextDecoder().decode(init?.body);
        const body = JSON.parse(raw) as Record<string, unknown>;
        bodies.push(body);
        const parsed = parseCreateJobRequest(body);
        if (!parsed.ok)
          return reply(parsed.error.status, { error: parsed.error });
        // Accepted: end the run here; the body is what is under test.
        return reply(503, { error: { code: "unavailable", message: "stop" } });
      }
      throw new Error(`unexpected request ${input}`);
    };
  }

  it.each([
    ["700 Bengali characters (the audit's repro)", "ক".repeat(700)],
    ["the box's maximum, in Bengali", "ক".repeat(MAX_QUESTION_CHARS)],
  ])(
    "a follow-up of %s is accepted, with context",
    async (_label, followUp) => {
      stubStatus();
      const bodies: Record<string, unknown>[] = [];
      runWorkerChatWithPdf
        .mockImplementationOnce(() =>
          workerSuccess(FIRST_QUESTION, FIRST_ANSWER),
        )
        .mockImplementationOnce((input, controls) =>
          realRunWorkerChatWithPdf(input, {
            ...controls,
            fetchImpl: wire(bodies),
            sleep: async () => {},
          }),
        );

      render(<Panel />);
      await screen.findByRole("textbox");
      await ask(FIRST_QUESTION);
      await screen.findByText(/উত্তর/);

      fireEvent.change(await screen.findByRole("textbox"), {
        target: { value: followUp },
      });
      const submit = screen.getByRole("button", {
        name: /ask the pdf|send follow-up/i,
      });
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);
      await waitFor(() => expect(bodies).toHaveLength(1));

      const body = bodies[0]!;
      // Health: this is the follow-up, carrying the long exchange.
      const options = body.options as {
        question: string;
        context?: { role: string; content: string }[];
      };
      expect(options.question).toBe(followUp);
      expect(options.context?.length ?? 0).toBeGreaterThan(0);
      expect(
        new TextEncoder().encode(JSON.stringify(options)).byteLength,
      ).toBeLessThanOrEqual(JOB_LIMITS.maxOptionsBytes);
      const parsed = parseCreateJobRequest(body);
      expect(parsed.ok, JSON.stringify(parsed.ok ? {} : parsed.error)).toBe(
        true,
      );
    },
  );
});

// --- clickable citations (audit #30, chat-with-pdf#3, 2026-11-15) ----------

describe("ChatWithPdfWorkerPanel — a citation shows its page", () => {
  /**
   * The renderer is swapped through `pageImageDeps`, the hook's own seam (a
   * `vi.mock` of `@/lib/pdf/render` would leave the hook, the dialog and this
   * panel cached against the stub for the next file). It records the bytes it
   * was handed and the 0-based index each page was asked for.
   */
  const created: Uint8Array[] = [];
  const asked: number[] = [];
  let drawable = true;
  const realRenderer = pageImageDeps.renderer;

  beforeEach(() => {
    created.length = 0;
    asked.length = 0;
    drawable = true;
    pageImageDeps.renderer = async () =>
      ({
        createThumbnailRenderer: async (bytes: Uint8Array) => {
          created.push(bytes);
          return {
            numPages: 3,
            renderPage: async (index: number) => {
              asked.push(index);
              return drawable
                ? {
                    index,
                    url: `blob:page-${index}`,
                    width: 1440,
                    height: 2036,
                  }
                : null;
            },
            destroy: async () => {},
          };
        },
      }) as unknown as typeof import("@/lib/pdf/render");
  });
  afterEach(() => {
    pageImageDeps.renderer = realRenderer;
  });

  /** A real engine package for a 3-page document, answering `answer`. */
  async function threePageAnswer(question: string, answer: string) {
    const texts = ["Page one text.", "Page two text.", "Page three text."];
    const run = await runChatWithPdf(
      new Uint8Array([1, 2, 3]),
      { question },
      {
        extract: async () => ({
          pageCount: 3,
          pages: texts.map((text, i) => ({
            pageNumber: i + 1,
            text,
            characterCount: text.length,
          })),
          text: texts.join("\n\n"),
          characterCount: 46,
          hasText: true,
        }),
        provider: provider(answer),
      },
    );
    if (!run.ok) throw new Error(`engine failed: ${run.message}`);
    return {
      ok: true as const,
      job: { id: "job_cite" },
      artifact: { filename: "answer.zip", url: "blob:answer" },
      output: run.output,
    };
  }

  async function answered(answer: string) {
    runWorkerChatWithPdf.mockImplementation(() => threePageAnswer("Q", answer));
    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q");
    await screen.findByText(shownAnswer(answer));
  }

  it("pressing [p.2] opens page 2 of 3, drawn from the bytes the question was sent with", async () => {
    stubStatus();
    await answered("Rent is due [p.2]; see also [p.9].");

    // Out of range for this 3-page file: text, not a button.
    expect(screen.queryByRole("button", { name: /page 9/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show page 2 of your PDF" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Page 2 of 3" }),
    ).toBeInTheDocument();
    const image = await screen.findByRole("img", { name: "Page 2" });
    expect(image.getAttribute("src")).toBe("blob:page-1");
    // The 1-based citation reached the renderer as its 0-based index.
    expect(asked).toEqual([1]);
    // THE SAME array the question was sent with: nothing re-read, nothing new.
    expect(created).toHaveLength(1);
    expect(created[0]).toBe(runWorkerChatWithPdf.mock.calls[0]![0].bytes);
    // A citation only shows the page; selecting is Delete Pages' business.
    expect(screen.queryByRole("button", { name: /select page/i })).toBeNull();

    // The panel re-renders as the visitor types; the page must not be redrawn
    // for it (a fresh array per render would re-run the preview every time).
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "And the deposit?" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(1);

    // Positive control: a different page IS drawn afresh.
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(
      await screen.findByRole("heading", { name: "Page 3 of 3" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(asked).toEqual([1, 2]));
  });

  it("says so when the page cannot be drawn, rather than a blank box", async () => {
    stubStatus();
    drawable = false;
    await answered("Rent is due [p.2].");
    fireEvent.click(
      screen.getByRole("button", { name: "Show page 2 of your PDF" }),
    );
    expect(
      await screen.findByText("This page could not be drawn here."),
    ).toBeInTheDocument();
  });

  it("swapping the file takes the buttons and the open page with it", async () => {
    stubStatus();
    await answered("Rent is due [p.2].");
    fireEvent.click(
      screen.getByRole("button", { name: "Show page 2 of your PDF" }),
    );
    await screen.findByRole("heading", { name: "Page 2 of 3" });
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /of 3$/ })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /show page/i })).toBeNull();
  });

  it("a document the browser could not count keeps its citations as text", async () => {
    stubStatus();
    measureChatDocument.mockResolvedValue({ kind: "uncounted" });
    await answered("Rent is due [p.2].");
    expect(screen.queryByRole("button", { name: /show page/i })).toBeNull();
    expect(created).toHaveLength(0);
  });

  /**
   * A question left running ("Keep waiting") about file A. The job hook
   * starts the resume on the press; the panel's job is to know which file
   * the answer is about when it lands (review finding, 2026-11-15: the
   * resume path never checked the file token, so A's answer joined B's
   * transcript, travelled to B as context, and its [p.2] became a button
   * that drew page 2 of B).
   */
  async function leftRunning(question: string) {
    runWorkerChatWithPdf.mockImplementationOnce(
      async (
        _input: unknown,
        controls: { onJobCreated: (id: string) => void },
      ) => {
        controls.onJobCreated("job_left");
        return {
          ok: false as const,
          message: "Still working.",
          jobId: "job_left",
          stillRunning: true,
        };
      },
    );
    render(<Panel />);
    await screen.findByRole("textbox");
    await ask(question);
    return screen.findByRole("button", { name: /keep waiting/i });
  }

  it("a Keep-waiting answer that lands after a file swap joins nothing and opens nothing", async () => {
    stubStatus();
    const keep = await leftRunning("Question about A");
    const stale = await threePageAnswer(
      "Question about A",
      "On file A this is on [p.2].",
    );
    let land!: (value: unknown) => void;
    resumeChatJob.mockImplementation(
      () => new Promise((resolve) => (land = resolve)),
    );
    fireEvent.click(keep);
    await waitFor(() => expect(resumeChatJob).toHaveBeenCalledTimes(1));

    // While the resume is pending: Remove A, pick B.
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    const input = await waitFor(() => {
      const found = document.querySelector('input[type="file"]');
      expect(found).not.toBeNull();
      return found!;
    });
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([9, 9, 9])], "b.pdf", {
            type: "application/pdf",
          }),
        ],
      },
    });
    land(stale);

    // B is asked and counted, which is what made A's markers buttons.
    runWorkerChatWithPdf.mockImplementation(() =>
      threePageAnswer("Q about B", "B answer, no cites."),
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Q about B" },
    });
    const submit = await screen.findByRole("button", {
      name: /ask the pdf|send follow-up/i,
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await screen.findByText(shownAnswer("B answer, no cites."));

    // A's answer is about no file on screen: not shown, not sent, no button.
    expect(
      screen.queryByText(shownAnswer("On file A this is on [p.2].")),
    ).toBeNull();
    expect(runWorkerChatWithPdf.mock.calls.at(-1)![0].context).toBeUndefined();
    expect(screen.queryByRole("button", { name: /show page/i })).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("a resumed answer keeps its citations as text, even about the file on screen", async () => {
    stubStatus();
    const keep = await leftRunning("Q");
    resumeChatJob.mockImplementation(() =>
      threePageAnswer("Q", "Rent is due [p.2]."),
    );
    fireEvent.click(keep);
    await screen.findByText(shownAnswer("Rent is due [p.2]."));
    // The file is still here and was counted before the question was sent,
    // so the document IS held: the marker is text because the answer was
    // resumed, not because there is nothing to open.
    runWorkerChatWithPdf.mockImplementation(() =>
      threePageAnswer("Q2", "And the deposit [p.3]."),
    );
    await ask("Q2");
    await screen.findByText(shownAnswer("And the deposit [p.3]."));
    // Positive control: the live answer's marker IS a button.
    expect(
      screen.getByRole("button", { name: "Show page 3 of your PDF" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show page 2/i })).toBeNull();
    // The resumed exchange, about this same file, still travels as context.
    expect(runWorkerChatWithPdf.mock.calls.at(-1)![0].context).toEqual([
      { role: "user", content: "Q" },
      { role: "assistant", content: "Rent is due [p.2]." },
    ]);
  });
});

/**
 * Competitor audit #16 (2026-11-17): every answer can be copied, and the whole
 * conversation copied or saved as Markdown, from the transcript the page
 * holds, with no request. The answers come out of REAL engine packages, the
 * clipboard is read where it is written, and the .md is the Blob saved.
 */
describe("ChatWithPdfWorkerPanel: copy and save the conversation", () => {
  const ZIP = chatAnswerOutputName("invoice.pdf");
  /** A line feed, built from its code point (house rule). */
  const NL = String.fromCharCode(10);

  async function answerAs(question: string, answer: string) {
    return {
      ...(await workerSuccess(question, answer)),
      artifact: { filename: ZIP, url: "blob:answer" },
    };
  }

  function clipboard() {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  it("Copy answer, Copy conversation and the .md carry every exchange, and send nothing", async () => {
    const first = "What is the total?";
    const second = "When is it due?";
    const a1 = "The total is $1,240.00 [p.1].";
    const a2 = "It is due on 30 June 2026 [p.1].";
    stubStatus();
    const writeText = clipboard();
    runWorkerChatWithPdf
      .mockImplementationOnce(() => answerAs(first, a1))
      .mockImplementationOnce(() => answerAs(second, a2));
    render(<Panel />);
    await screen.findByRole("textbox");
    await ask(first);
    await screen.findByText(shownAnswer(a1));
    await ask(second);
    await screen.findByText(shownAnswer(a2));

    const copies = await screen.findAllByRole("button", {
      name: "Copy answer",
    });
    expect(copies).toHaveLength(2);
    const fetches = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(copies[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(a2));

    fireEvent.click(screen.getByRole("button", { name: "Copy conversation" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]![0]).toBe(
      [
        `Q: ${first}`,
        "",
        `A: ${a1}`,
        "Cited pages: [p.1]",
        "",
        `Q: ${second}`,
        "",
        `A: ${a2}`,
        "Cited pages: [p.1]",
      ].join(NL),
    );

    let saved: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved = blob as Blob;
      return "blob:md";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Download conversation (.md)" }),
    );
    await waitFor(() => expect(names).toEqual(["invoice-conversation.md"]));
    expect(await saved!.text()).toBe(
      [
        "# Chat with PDF: invoice",
        "## Question 1",
        first,
        "**Answer**",
        a1,
        "Cited pages: [p.1]",
        "## Question 2",
        second,
        "**Answer**",
        a2,
        "Cited pages: [p.1]",
      ].join(NL + NL) + NL,
    );
    // Built from the page: none of the three presses made a request.
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetches);
  });

  it("a very long answer is capped on the page and copied whole", async () => {
    const tail = "END-OF-THE-ANSWER";
    const long = `${"word ".repeat(PAGE_TEXT_LIMIT / 4)}${tail}`;
    // Health check: the answer is past the cap, and so is its tail.
    expect(long.indexOf(tail)).toBeGreaterThan(PAGE_TEXT_LIMIT);
    stubStatus();
    const writeText = clipboard();
    runWorkerChatWithPdf.mockImplementationOnce(() => answerAs("Q", long));
    render(<Panel />);
    await screen.findByRole("textbox");
    await ask("Q");
    const note = await screen.findByText(
      /^Only the first 50,000 of [\d,]+ characters are shown here\./,
    );
    const shown = screen.getByText(shownAnswer(long.slice(0, PAGE_TEXT_LIMIT)));
    expect(shown.textContent).not.toContain(tail);
    expect(note).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(long));
  });
});
