// @vitest-environment jsdom
/**
 * OCR PDF's batch (batch plan P5), through the page's own panel and the
 * real OCR job client, with the worker at the global `fetch`:
 *
 *   - the cap: `BATCH_LIMITS.ocrMaxFiles` files are taken, and every file
 *     past it is listed with the count's own sentence, never dropped;
 *   - one set of recognition settings, frozen on Run, in EVERY job body
 *     (each body today's single job: this tool, ONE input);
 *   - Run held by the single-file panel's own rule (a selected language
 *     with no pack on our server), with its sentence;
 *   - a change to the panel's request after Run reaches no file of that run;
 *   - a JPG or PNG is sent without straighten and turn, as on its own;
 *   - telemetry: one outcome per file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { ScanText } from "lucide-react";
import { BATCH_LIMITS, overCountReason } from "@/lib/batch/limits";
import { WORKER_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  OCR_LANGUAGE_CODES,
  type OcrLanguage,
  type OcrOptions,
} from "@/lib/jobs/ocr";
import { getToolBySlug } from "@/lib/tools";
import type { WorkerStatus } from "@/lib/workers/status";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { resetUnsavedForTests } from "@/lib/intent/unsaved";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import { OcrWorkerPanel } from "../../ocr-worker-panel";
import { WorkerPanelShell } from "../../worker-panel-shell";
import { OcrBatch } from "./ocr-batch";

const tool = getToolBySlug("ocr-pdf")!;
const { verb, noun } = WORKER_BATCH_TOOLS["ocr-pdf"];
const runName = (n: number) => `${verb} ${n} ${noun[n === 1 ? 0 : 1]}`;

function statusWith(languages: readonly OcrLanguage[]): WorkerStatus {
  return {
    ...READY_WORKER_STATUS,
    ocr: { ...READY_WORKER_STATUS.ocr, languages: [...languages] },
  };
}

const pdf = (name: string) =>
  new File(["%PDF-1.7\n%%EOF\n"], `${name}.pdf`, { type: "application/pdf" });
const png = (name: string) =>
  new File([new Uint8Array([137, 80, 78, 71])], `${name}.png`, {
    type: "image/png",
  });

interface Net {
  /** Every `POST /api/jobs` body, in order. */
  bodies: Record<string, unknown>[];
  /** Every request, in the order the page made it. */
  log: string[];
  /** Releases the held PUT of file `n` (1-based), when one is held. */
  release: () => void;
}

/**
 * The worker at the wire. Job `n` completes with `outputs` artifacts, or
 * fails when `n` is in `fail`; the PUT of file `holdPut` waits for release.
 */
function worker(
  status: WorkerStatus,
  script: { fail?: number[]; holdPut?: number; outputs?: number } = {},
): Net {
  const bodies: Record<string, unknown>[] = [];
  const log: string[] = [];
  let reservations = 0;
  let puts = 0;
  let jobs = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  const json = (value: unknown, code = 200) =>
    new Response(JSON.stringify(value), {
      status: code,
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
        reservations += 1;
        log.push(`reserve ${reservations}`);
        return json({
          sessionId: `s${reservations}`,
          slots: [
            {
              fileId: `f${reservations}`,
              filename: "in",
              url: `/__put/${reservations}`,
              method: "PUT",
              headers: {},
            },
          ],
          expiresAt: now,
          retention: {},
        });
      }
      if (url.startsWith("/__put/")) {
        puts += 1;
        log.push(`put ${puts}`);
        if (puts === script.holdPut) await held;
        return json({});
      }
      if (url === "/api/jobs" && method === "POST") {
        jobs += 1;
        const body = JSON.parse(
          new TextDecoder().decode(init!.body as ArrayBuffer),
        ) as Record<string, unknown>;
        bodies.push(body);
        log.push(`create ${jobs}`);
        const n = jobs;
        if (script.fail?.includes(n))
          return json({
            jobId: `job_${n}`,
            status: "failed",
            error: {
              code: "internal_error",
              message: `job ${n} failed`,
              retryable: false,
            },
          });
        const count = script.outputs ?? 1;
        return json({
          jobId: `job_${n}`,
          status: "completed",
          artifacts: Array.from({ length: count }, (_, i) => ({
            artifactId: `a${n}_${i}`,
            filename: i === 0 ? `out-${n}-ocr.pdf` : `out-${n}.txt`,
            contentType: i === 0 ? "application/pdf" : "text/plain",
            bytes: 8,
            url: `/__art/${n}/${i}`,
            expiresAt: now,
          })),
        });
      }
      if (url.startsWith("/__art/")) {
        log.push(`download ${url.slice(7)}`);
        return new Response("%PDF-out");
      }
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return { bodies, log, release: () => release() };
}

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
beforeEach(() => {
  events = [];
  configureTelemetry((e) => events.push(e));
  leave = enterToolPage({ toolSlug: "ocr-pdf", capability: "secure-worker" });
});
afterEach(() => {
  cleanup();
  leave();
  resetTelemetry();
  resetAnnouncer();
  resetUnsavedForTests();
  vi.unstubAllGlobals();
});

const outcomes = () =>
  events
    .map((e) => e.name)
    .filter((n) => n === "tool_completed" || n === "tool_failed");

async function drop(files: File[]) {
  const view = render(<OcrWorkerPanel tool={tool} />);
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, { target: { files } });
  return view;
}

async function readyRun(n: number): Promise<HTMLElement> {
  const run = await screen.findByRole("button", { name: runName(n) });
  await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
  return run;
}

const done = (ok: number, failed: number) =>
  screen.findByText(
    `Batch complete. ${ok} done, ${failed} failed.`,
    undefined,
    {
      timeout: 5000,
    },
  );

describe("OCR PDF's batch, through its page's own panel", () => {
  it("takes the OCR cap and lists every file past it with the count's sentence", async () => {
    worker(statusWith(["eng"]));
    const files = Array.from({ length: BATCH_LIMITS.ocrMaxFiles + 2 }, (_, i) =>
      pdf(`scan-${i + 1}`),
    );
    const view = await drop(files);
    await readyRun(BATCH_LIMITS.ocrMaxFiles);
    const text = view.container.textContent ?? "";
    // The cap's own sentence, and the names of the two files past it.
    expect(text).toContain(overCountReason(BATCH_LIMITS.ocrMaxFiles));
    expect(text).toContain(`scan-${BATCH_LIMITS.ocrMaxFiles + 1}.pdf`);
    expect(text).toContain(`scan-${BATCH_LIMITS.ocrMaxFiles + 2}.pdf`);
    expect(text).toContain("2 files not added");
    // Control: the worker cap is larger, and is not what this batch says.
    expect(text).not.toContain(overCountReason(BATCH_LIMITS.workerMaxFiles));
  });

  it("five scans are taken whole: no file is listed as not added", async () => {
    worker(statusWith(["eng"]));
    const files = Array.from({ length: BATCH_LIMITS.ocrMaxFiles }, (_, i) =>
      pdf(`scan-${i + 1}`),
    );
    const view = await drop(files);
    await readyRun(BATCH_LIMITS.ocrMaxFiles);
    expect(view.container.textContent).not.toMatch(/not added/);
  });

  it("every job body carries the same frozen settings, one input each, strictly in turn", async () => {
    const net = worker(statusWith(["eng", "spa"]));
    await drop([pdf("a"), pdf("b"), pdf("c")]);
    // The single-file panel's own settings, set once above the list.
    fireEvent.click(await screen.findByRole("button", { name: "Spanish" }));
    fireEvent.click(
      screen.getByRole("radio", { name: "Searchable PDF + text" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Redo existing OCR/ }),
    );
    // The batch names the languages every file is read in, before Run.
    expect(
      document.querySelector("[data-ocr-batch-language]")?.textContent,
    ).toContain("English and Spanish");
    fireEvent.click(await readyRun(3));
    await done(3, 0);
    expect(net.bodies).toHaveLength(3);
    const expected: OcrOptions = {
      languages: ["eng", "spa"],
      outputMode: "both",
      redoOcr: true,
      deskew: false,
      rotatePages: false,
    };
    for (const body of net.bodies) {
      expect(body.tool).toBe("ocr-pdf");
      expect(body.inputs).toHaveLength(1);
      expect(body.options).toEqual(expected);
    }
    // One in flight: file k+1 is reserved only after file k's downloads.
    for (const k of [1, 2])
      expect(net.log.indexOf(`reserve ${k + 1}`)).toBeGreaterThan(
        net.log.indexOf(`download ${k}/0`),
      );
  });

  it("a PNG in the batch is sent without straighten and turn; the PDFs keep them", async () => {
    const net = worker(statusWith(["eng"]));
    await drop([pdf("a"), png("photo"), pdf("c")]);
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Straighten crooked pages" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Turn pages upright/ }),
    );
    fireEvent.click(await readyRun(3));
    await done(3, 0);
    const options = net.bodies.map(
      (b) => b.options as { deskew: boolean; rotatePages: boolean },
    );
    expect(options.map((o) => [o.deskew, o.rotatePages])).toEqual([
      [true, true],
      [false, false],
      [true, true],
    ]);
  });

  it("Run waits on the panel's own language rule, and says why", async () => {
    // Available, but with no pack at all: the single-file Run is held too.
    worker(statusWith([]));
    const view = await drop([pdf("a"), pdf("b")]);
    const run = await screen.findByRole("button", { name: runName(2) });
    await waitFor(() =>
      expect(view.container.textContent).toContain(
        "This server reports no recognition pack for the selected language",
      ),
    );
    expect(run).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(run);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(/Batch complete/)).toBeNull();
  });

  it("control: with a pack for the language, the same batch runs", async () => {
    const net = worker(statusWith(["eng"]));
    await drop([pdf("a"), pdf("b")]);
    fireEvent.click(await readyRun(2));
    await done(2, 0);
    expect(net.bodies).toHaveLength(2);
  });

  it("telemetry: one outcome per file, a failed job's included", async () => {
    worker(statusWith(["eng"]), { fail: [2] });
    await drop([pdf("a"), pdf("b"), pdf("c")]);
    fireEvent.click(await readyRun(3));
    await done(2, 1);
    expect(outcomes()).toEqual([
      "tool_completed",
      "tool_failed",
      "tool_completed",
    ]);
  });

  it("PDF + text: both of a job's files are its row's, downloaded as the row's ZIP", async () => {
    worker(statusWith(["eng"]), { outputs: 2 });
    const view = await drop([pdf("a"), pdf("b")]);
    fireEvent.click(
      await screen.findByRole("radio", { name: "Searchable PDF + text" }),
    );
    fireEvent.click(await readyRun(2));
    await done(2, 0);
    expect(
      screen.getByRole("button", { name: "Download a.zip" }),
    ).toBeInTheDocument();
    expect(view.container.textContent).toContain("out-1.txt");
    expect(
      screen.getByRole("button", { name: "Download all (2)" }),
    ).toBeInTheDocument();
  });
});

/**
 * The freeze itself, below the panel: a harness holds the request the panel
 * would, with a control OUTSIDE the batch that changes it — standing in for
 * anything that moves the panel's request while a batch runs.
 */
function Harness({ files }: { files: File[] }) {
  const [languages, setLanguages] = useState<OcrLanguage[]>(["eng"]);
  const request: OcrOptions = {
    languages,
    outputMode: "searchable-pdf",
    redoOcr: false,
    deskew: false,
    rotatePages: false,
  };
  return (
    <WorkerPanelShell
      tool={tool}
      engine={{ label: "Text recognition", icon: ScanText }}
      description="test"
      canRun={(s) => s.ocr.available}
      specRows={[]}
    >
      <label>
        Harness language
        <select
          value={languages[0]}
          onChange={(e) => setLanguages([e.target.value as OcrLanguage])}
        >
          {OCR_LANGUAGE_CODES.slice(0, 3).map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <OcrBatch
        tool={tool}
        files={files}
        onReset={() => {}}
        request={request}
        settings={<p>settings</p>}
        runBlocked={null}
        contentTypeOf={(f) => f.type}
      />
    </WorkerPanelShell>
  );
}

describe("OCR PDF's batch freezes its settings on Run", () => {
  it("a language changed while file 1 uploads reaches no later job body", async () => {
    const net = worker(statusWith(["eng", "spa", "fra"]), { holdPut: 1 });
    render(<Harness files={[pdf("a"), pdf("b"), pdf("c")]} />);
    fireEvent.click(await readyRun(3));
    await waitFor(() => expect(net.log).toContain("put 1"));
    // Mid-batch: the request the panel holds moves to Spanish.
    fireEvent.change(screen.getByLabelText("Harness language"), {
      target: { value: "spa" },
    });
    net.release();
    await done(3, 0);
    expect(net.bodies.map((b) => (b.options as OcrOptions).languages)).toEqual([
      ["eng"],
      ["eng"],
      ["eng"],
    ]);
  });

  it("control: a change BEFORE Run is what every file is sent with", async () => {
    const net = worker(statusWith(["eng", "spa", "fra"]));
    render(<Harness files={[pdf("a"), pdf("b")]} />);
    const run = await readyRun(2);
    fireEvent.change(screen.getByLabelText("Harness language"), {
      target: { value: "spa" },
    });
    fireEvent.click(run);
    await done(2, 0);
    expect(net.bodies.map((b) => (b.options as OcrOptions).languages)).toEqual([
      ["spa"],
      ["spa"],
    ]);
  });
});
