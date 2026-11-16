// @vitest-environment node
/**
 * Translate's OWN extractor, through the native runner that ships.
 *
 * `translateDeps(env).extract` is built from the production parts — the
 * `-layout` extractor and the flow extractor over `runPdfText` — with only
 * `pdftotext`'s `exec` swapped (at its existing seam) for one that records
 * the argv and returns verbatim poppler stdout from `@/tests/poppler-samples`.
 * So what is asked is the composed chain: which runs are made, in which
 * order, and what a failed second run leaves behind.
 *
 *  - a text PDF: `-layout`, then `-bbox-layout`, and the pages carry flow;
 *  - no text: `-layout` only — a scan costs no second run;
 *  - the flow run throws (64 MB maxBuffer): `-layout` text, source
 *    `bbox_failed`, and the job still succeeds end to end through
 *    `runTranslate`, with its usage carried.
 *
 * MUTATION (2026-11-16, on a scratch copy of `./reading-order.ts`): deleting
 * the `try`/`catch` around the flow run turned the maxBuffer case red.
 */
import { describe, expect, it } from "vitest";
import type { PdfTextExec } from "../pdf-text/native";
import { TWO_COLUMN_BBOX, TWO_COLUMN_LAYOUT } from "@/tests/poppler-samples";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { runTranslate } from "./engine";
import { translateDeps, translateFlowConfig } from "./native";
import { resolveNativePdfTextConfig } from "../pdf-text/native-config";
import { TRANSLATE_FLOW_TIMEOUT_MS } from "@/lib/jobs/translate-reading-order";

const INPUT = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

type Call = { mode: string; timeout: number; maxBuffer: number };

/** An exec that records each run and answers by mode. */
function recordingExec(answers: {
  layout: () => Promise<string>;
  bbox: () => Promise<string>;
}): { exec: PdfTextExec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: PdfTextExec = (_command, args, options) => {
    const mode = args.includes("-bbox-layout")
      ? "-bbox-layout"
      : args.includes("-layout")
        ? "-layout"
        : `other:${args.join(" ")}`;
    calls.push({
      mode,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
    });
    if (mode === "-layout") return answers.layout();
    if (mode === "-bbox-layout") return answers.bbox();
    return Promise.reject(new Error(`unexpected pdftotext run: ${mode}`));
  };
  return { exec, calls };
}

function maxBufferError(): Error {
  return Object.assign(new Error("stdout maxBuffer length exceeded"), {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
  });
}

function recordingProvider(): AiProvider & { calls: AiCompletionRequest[] } {
  const calls: AiCompletionRequest[] = [];
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    calls,
    async complete(request) {
      calls.push(request);
      return {
        ok: true,
        text: "traduction",
        model: "claude-sonnet-5",
        usage: { inputTokens: 321, outputTokens: 45 },
      };
    },
  };
}

function extractWith(exec: PdfTextExec) {
  const extract = translateDeps(
    {},
    {},
    { resolveOnPath: () => false },
    { resolveOnPath: () => true, exec },
  ).extract;
  if (!extract) throw new Error("health: no extractor was wired");
  return extract;
}

describe("translateDeps(env).extract — Translate's own composite", () => {
  it("a text PDF: `-layout` first, then `-bbox-layout`, and the pages carry flow", async () => {
    const { exec, calls } = recordingExec({
      layout: async () => TWO_COLUMN_LAYOUT,
      bbox: async () => TWO_COLUMN_BBOX,
    });
    const extracted = await extractWith(exec)(INPUT);
    expect(calls.map((c) => c.mode)).toEqual(["-layout", "-bbox-layout"]);
    expect(extracted.readingOrder).toEqual({ source: "flow" });
    expect(extracted.pages.some((p) => typeof p.send === "string")).toBe(true);
    // `text` stays the -layout reading (D11).
    expect(extracted.text).toContain(
      extracted.pages[0]!.text.trim().slice(0, 20),
    );
  });

  it("the flow run is bounded by TRANSLATE_FLOW_TIMEOUT_MS; the -layout run keeps its own deadline", async () => {
    const { exec, calls } = recordingExec({
      layout: async () => TWO_COLUMN_LAYOUT,
      bbox: async () => TWO_COLUMN_BBOX,
    });
    await extractWith(exec)(INPUT);
    const config = resolveNativePdfTextConfig({});
    expect(calls[0]!.timeout).toBe(config.timeoutMs);
    expect(calls[1]!.timeout).toBe(translateFlowConfig(config).timeoutMs);
    expect(calls[1]!.timeout).toBeLessThanOrEqual(TRANSLATE_FLOW_TIMEOUT_MS);
  });

  it("no text: only `-layout` runs, and the source says the second run was not made", async () => {
    const { exec, calls } = recordingExec({
      layout: async () => "\f\f",
      bbox: async () => {
        throw new Error("bbox must not run on a document with no text");
      },
    });
    const extracted = await extractWith(exec)(INPUT);
    expect(calls.map((c) => c.mode)).toEqual(["-layout"]);
    expect(extracted.readingOrder).toEqual({ source: "not_run" });
    expect(extracted.hasText).toBe(false);
  });

  it("the flow run throws (maxBuffer): -layout text, source bbox_failed, and the job succeeds with its usage", async () => {
    const { exec, calls } = recordingExec({
      layout: async () => TWO_COLUMN_LAYOUT,
      bbox: async () => {
        throw maxBufferError();
      },
    });
    const extract = extractWith(exec);
    const extracted = await extract(INPUT);
    expect(calls.map((c) => c.mode)).toEqual(["-layout", "-bbox-layout"]);
    expect(extracted.readingOrder).toEqual({ source: "bbox_failed" });
    expect(extracted.pages.every((p) => p.send === undefined)).toBe(true);

    calls.length = 0;
    const provider = recordingProvider();
    const run = await runTranslate(
      INPUT,
      { targetLanguage: "fr", sourceLanguage: "auto" },
      { extract, provider, now: () => "2026-11-16T00:00:00.000Z" },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(provider.calls).toHaveLength(1);
    // What was sent is the -layout text, exactly as before reading order.
    const sent = provider.calls[0]!.messages[0]!.content;
    for (const page of extracted.pages.filter((p) => p.text.trim())) {
      expect(sent).toContain(page.text.trim().split("\n")[0]!.trim());
    }
    expect(run.meta.usage).toMatchObject({
      inputTokens: 321,
      outputTokens: 45,
      calls: 1,
    });
    expect(run.meta.readingOrder.source).toBe("bbox_failed");
    expect(run.meta.readingOrder.flowPages).toBe(0);
    expect(run.meta.readingOrder.layoutPages).toBeGreaterThan(0);
  });

  it("an extractor is wired only when pdftotext is present", () => {
    const deps = translateDeps(
      {},
      {},
      { resolveOnPath: () => false },
      { resolveOnPath: () => false },
    );
    expect(deps.extract).toBeUndefined();
  });
});
