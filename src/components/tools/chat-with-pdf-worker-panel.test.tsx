// @vitest-environment jsdom
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { WorkerStatus } from "@/lib/workers/status";
import { getProviderReadiness } from "@/lib/workers/providers";
import { resolveDaemonReadiness } from "@/lib/workers/daemon/readiness";
import { resolveAiReadiness } from "@/lib/workers/ai/readiness";
import { MAX_CONTEXT_TURNS } from "@/lib/jobs/chat-with-pdf";
import type { AiProvider } from "@/lib/workers/ai/provider";
import { runChatWithPdf } from "@/lib/workers/chat-with-pdf/engine";
import { resetTelemetry } from "@/lib/telemetry/track";
import { ChatWithPdfWorkerPanel } from "./chat-with-pdf-worker-panel";

// The job driver and the document measurement are handed to the panel as
// props. They used to be swapped in with `vi.mock` on the client module, which
// left the panel cached bound to these stubs for any later test file in the
// same worker; the pick-refusal guard renders every worker panel, so it would
// have been that file. Running the real pdfjs in jsdom on a three-byte file
// would measure nothing, so the measurement is stubbed too — as a prop.
const runWorkerChatWithPdf = vi.fn();
const measureChatDocument = vi.fn();
const MEASURED = { characters: 2_140, textPages: 3 };

const chatTool = getToolBySlug("chat-with-pdf")!;

/** The panel as the page mounts it, with only the two network-bound seams stubbed. */
function Panel() {
  return (
    <ChatWithPdfWorkerPanel
      tool={chatTool}
      runChat={runWorkerChatWithPdf}
      measureChat={measureChatDocument}
    />
  );
}

const providers = getProviderReadiness("remote-configured");

/** A deployment where the whole pipeline AND an AI provider are ready. */
const READY: WorkerStatus = {
  mode: "remote-configured",
  enabled: true,
  localDevOnly: false,
  detail: "A worker backend is configured.",
  compress: { lossless: false, deep: false, engines: [] },
  scan: { active: false, detail: "not scanned" },
  ocr: {
    available: true,
    engine: "tesseract",
    languages: ["eng"],
    detail: "OCR runs on the worker.",
  },
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
  ai: resolveAiReadiness({
    PDFXYZ_AI_PROVIDER: "openai",
    PDFXYZ_AI_MODEL: "gpt-5.6-luna",
  }),
  pipeline: {
    verdict: "off",
    observed: false,
    drainable: false,
    detail: "no worker observed",
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
    expect(await screen.findByText(answer)).toBeInTheDocument();

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
    expect(
      screen.getByText(/worker keeps nothing between questions/i),
    ).toBeInTheDocument();
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
    await screen.findByText("A one [p.1].");
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
    expect(await screen.findByText("A one [p.1].")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    measureChatDocument.mockResolvedValueOnce({
      kind: "counted",
      count: { characters: 99, textPages: 1 },
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
    expect(await screen.findByText("First [p.1].")).toBeInTheDocument();
    expect(screen.getAllByText(AI_ANSWER_CAVEAT)).toHaveLength(1);

    await ask("Q2?");
    expect(await screen.findByText("Second [p.1].")).toBeInTheDocument();
    expect(screen.getAllByText(AI_ANSWER_CAVEAT)).toHaveLength(2);
    expect(AI_ANSWER_CAVEAT).toMatch(/AI-generated/);
  });
});
