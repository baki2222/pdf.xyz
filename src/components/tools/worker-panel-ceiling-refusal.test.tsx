// @vitest-environment jsdom
/**
 * A file a worker tool cannot take is refused at the pick, in the panel, in
 * the page's own words, and before anything uploads.
 *
 * HISTORY. This file began with two panels. The Office and HTML panels called
 * `fileOverCeilingMessage` from their Dropzone's `onFiles`. The function had a
 * unit test and the two call sites had none: with both replaced by `null` the
 * whole suite stayed green, and the user would have read "...exceeds the
 * 52428800-byte per-file limit." after a round trip instead of the MB figure
 * the page states.
 *
 * The other eleven worker panels had no pick check at all, and neither panel
 * above checked the TYPE. A drop is not filtered by `accept`, so a .docx
 * dropped on Summarize, or a 120 MB scan on OCR, was read into memory,
 * uploaded, and refused by the server with "A file's declared type does not
 * match its filename extension." or a raw byte count. Every panel now passes
 * `refuse={(file) => pickRefusal(tool, file)}` to its Dropzone, which applies
 * the server's type rule and the page's ceiling before `onFiles` runs.
 *
 * THE SUBJECTS ARE DISCOVERED, not typed. Which panels exist is read from the
 * tool page (`<XWorkerPanel tool={tool} />`), and the slugs each one serves
 * from the branch that mounts it. A panel the page mounts without a row in
 * PANELS below fails the coverage check. Every routed tool that takes a file
 * must show a picker, refuse the wrong kind of file, refuse above its ceiling,
 * and stage a file at exactly the ceiling.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getToolBySlug, tools } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "@/lib/tools/page-copy";
import {
  fileOverCeilingMessage,
  toolFileCeilingBytes,
  toolFileCeilingMb,
} from "@/lib/tools/file-ceilings";
import type { WorkerStatus } from "@/lib/workers/status";
import { canRunAiExtract } from "@/lib/workers/ai-extract-client";
import { canRunChatWithPdf } from "@/lib/workers/chat-with-pdf-client";
import { canRunHtmlRender } from "@/lib/workers/html-render-client";
import { canRunOfficeConversion } from "@/lib/workers/office-conversion-client";
import { canRunPdfArchive } from "@/lib/workers/pdf-archive-client";
import { canRunPdfOfficeExport } from "@/lib/workers/pdf-office-export-client";
import { canRunPdfSecurity } from "@/lib/workers/pdf-security-client";
import { canRunPdfStructure } from "@/lib/workers/pdf-structure-client";
import { canRunRequestSignatures } from "@/lib/workers/request-signatures-client";
import { canRunSummarize } from "@/lib/workers/summarize-client";
import { canRunTableExtract } from "@/lib/workers/table-extract-client";
import { canRunTranslate } from "@/lib/workers/translate-client";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import { AiExtractWorkerPanel } from "./ai-extract-worker-panel";
import { ChatWithPdfWorkerPanel } from "./chat-with-pdf-worker-panel";
import { HtmlRenderWorkerPanel } from "./html-render-worker-panel";
import { OcrWorkerPanel } from "./ocr-worker-panel";
import { OfficeConversionWorkerPanel } from "./office-conversion-worker-panel";
import { PdfArchiveWorkerPanel } from "./pdf-archive-worker-panel";
import { PdfOfficeExportWorkerPanel } from "./pdf-office-export-worker-panel";
import { PdfSecurityWorkerPanel } from "./pdf-security-worker-panel";
import { PdfStructureWorkerPanel } from "./pdf-structure-worker-panel";
import { RequestSignaturesWorkerPanel } from "./request-signatures-worker-panel";
import { SummarizeWorkerPanel } from "./summarize-worker-panel";
import { TableExtractWorkerPanel } from "./table-extract-worker-panel";
import { TranslateWorkerPanel } from "./translate-worker-panel";

const PAGE = readFileSync(
  resolve(process.cwd(), "src/app/tools/[slug]/page.tsx"),
  "utf8",
);

/** Every worker panel the tool page mounts. */
function mountedPanels(): string[] {
  return [...PAGE.matchAll(/<(\w+WorkerPanel) tool=\{tool\} \/>/g)]
    .map((m) => m[1]!)
    .sort();
}

/**
 * The slugs the page's ternary routes to `<name tool={tool} />`: the
 * `tool.slug === "..."` conditions between the previous `) :` and the `? (`
 * that opens this branch.
 */
function routedSlugs(name: string): string[] {
  const tag = `<${name} tool={tool} />`;
  const at = PAGE.indexOf(tag);
  expect(at, `${tag} is not mounted by the tool page`).toBeGreaterThan(0);
  expect(PAGE.indexOf(tag, at + 1), `${tag} is mounted twice`).toBe(-1);
  const before = PAGE.slice(0, at);
  const condition = before.slice(
    before.lastIndexOf(") :"),
    before.lastIndexOf("? ("),
  );
  return [...condition.matchAll(/tool\.slug === "([^"]+)"/g)].map((m) => m[1]!);
}

const PANELS: Record<
  string,
  {
    Panel: ComponentType<{ tool: Tool }>;
    canRun: (status: WorkerStatus) => boolean;
  }
> = {
  AiExtractWorkerPanel: {
    Panel: AiExtractWorkerPanel,
    canRun: canRunAiExtract,
  },
  ChatWithPdfWorkerPanel: {
    Panel: ChatWithPdfWorkerPanel,
    canRun: canRunChatWithPdf,
  },
  HtmlRenderWorkerPanel: {
    Panel: HtmlRenderWorkerPanel,
    canRun: canRunHtmlRender,
  },
  OcrWorkerPanel: {
    Panel: OcrWorkerPanel,
    canRun: (status) => status.ocr.available,
  },
  OfficeConversionWorkerPanel: {
    Panel: OfficeConversionWorkerPanel,
    canRun: canRunOfficeConversion,
  },
  PdfArchiveWorkerPanel: {
    Panel: PdfArchiveWorkerPanel,
    canRun: canRunPdfArchive,
  },
  PdfOfficeExportWorkerPanel: {
    Panel: PdfOfficeExportWorkerPanel,
    canRun: canRunPdfOfficeExport,
  },
  PdfSecurityWorkerPanel: {
    Panel: PdfSecurityWorkerPanel,
    canRun: canRunPdfSecurity,
  },
  PdfStructureWorkerPanel: {
    Panel: PdfStructureWorkerPanel,
    canRun: canRunPdfStructure,
  },
  RequestSignaturesWorkerPanel: {
    Panel: RequestSignaturesWorkerPanel,
    canRun: canRunRequestSignatures,
  },
  SummarizeWorkerPanel: {
    Panel: SummarizeWorkerPanel,
    canRun: canRunSummarize,
  },
  TableExtractWorkerPanel: {
    Panel: TableExtractWorkerPanel,
    canRun: canRunTableExtract,
  },
  TranslateWorkerPanel: {
    Panel: TranslateWorkerPanel,
    canRun: canRunTranslate,
  },
};

/** Every routed tool that takes a file, per mounted panel. */
const SUBJECTS = mountedPanels().map((name) => ({
  name,
  ...PANELS[name]!,
  tools: routedSlugs(name)
    .map((slug) => {
      const tool = getToolBySlug(slug);
      expect(
        tool,
        `routed slug "${slug}" is not in the catalogue`,
      ).toBeDefined();
      return tool!;
    })
    .filter((tool) => toolFileCeilingBytes(tool) !== null),
}));

function stubNetwork() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/worker/status")) {
      return { ok: true, json: async () => READY } as Response;
    }
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Tools whose run button also waits on something other than the file.
 *
 * `unlock-pdf` joined at the merge of wave1/l06-copy-other (2026-09-28). This
 * lane had let Unlock run with a blank password, so a file was all it needed;
 * the integrated product keeps the other lane's rule (a50c54c) that Unlock
 * removes protection only with a password the file accepts, and its form
 * waits for one like Protect's does.
 */
const NEEDS_MORE_THAN_A_FILE = new Set([
  "ai-extract",
  "chat-with-pdf",
  "protect-pdf",
  "request-signatures",
  "unlock-pdf",
]);

const blocked = (el: Element) => el.getAttribute("aria-disabled") === "true";

/** A file named for the tool's first catalogue format, reporting `size` bytes. */
function fileOfSize(tool: Tool, size: number, name = "upload"): File {
  const file = new File(
    [new Uint8Array([1, 2, 3])],
    `${name}.${tool.accept[0]!.toLowerCase()}`,
  );
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/**
 * A realistic wrong file for this tool: a Word document for a tool that takes
 * PDFs, a PDF for one that does not.
 */
function wrongFileFor(tool: Tool): File {
  return tool.accept.includes("PDF")
    ? new File([new Uint8Array([0x50, 0x4b, 3, 4])], "letter.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    : new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", {
        type: "application/pdf",
      });
}

async function renderReady(Panel: ComponentType<{ tool: Tool }>, tool: Tool) {
  const fetchMock = stubNetwork();
  const { container } = render(<Panel tool={tool} />);
  const input = await waitFor(() => {
    const found =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(found, `${tool.slug} shows no file picker`).not.toBeNull();
    return found!;
  });
  // The RUN button: `WorkerRunButton` always carries `aria-busy`. Not "the
  // first aria-disabled button" — since the wave-1 L03 merge (2026-09-28) the
  // OCR panel's language chips for packs the worker lacks are aria-disabled
  // too, and come first, so that query picked a chip and read its state.
  const run = container.querySelector(
    'button[aria-busy][aria-disabled="true"]',
  );
  expect(
    run,
    `${tool.slug}: no blocked run button before a pick`,
  ).not.toBeNull();
  return { fetchMock, input, run: run! };
}

/** Requests other than the status probe: an upload, a job, anything. */
function sent(fetchMock: ReturnType<typeof stubNetwork>) {
  return fetchMock.mock.calls.filter(
    ([url]) => !String(url).includes("/api/worker/status"),
  );
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("health checks: the discovered corpus is the one the page routes", () => {
  it("every panel the page mounts has a row here, and no row is stale", () => {
    const mounted = mountedPanels();
    console.info(`worker panels: ${mounted.join(", ")}`);
    expect(mounted.length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(PANELS).sort()).toEqual(mounted);
  });

  it("each panel is routed at least one tool that takes a file, and the stub is ready", () => {
    for (const { name, tools: routed, canRun } of SUBJECTS) {
      expect(
        routed.length,
        `${name}: no file-taking tool routed`,
      ).toBeGreaterThan(0);
      expect(canRun(READY), `${name}: READY does not show its builder`).toBe(
        true,
      );
    }
    const total = SUBJECTS.reduce((n, s) => n + s.tools.length, 0);
    expect(total).toBeGreaterThanOrEqual(19);
  });
});

describe.each(
  SUBJECTS.flatMap(({ name, Panel, tools: routed }) =>
    routed.map((tool) => ({ name, Panel, tool, slug: tool.slug })),
  ),
)("$name for $slug", ({ Panel, tool }) => {
  it("refuses a file one byte over the ceiling, in the page's MB figure, before any upload", async () => {
    const ceiling = toolFileCeilingBytes(tool)!;
    const { fetchMock, input, run } = await renderReady(Panel, tool);

    const big = fileOfSize(tool, ceiling + 1);
    fireEvent.change(input, { target: { files: [big] } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(fileOverCeilingMessage(tool, ceiling + 1)!);
    expect(alert).toHaveTextContent(`${toolFileCeilingMb(tool)} MB`);
    expect(alert).not.toHaveTextContent(/byte/);
    // Nothing staged, nothing sent.
    expect(screen.queryByText(big.name)).not.toBeInTheDocument();
    expect(blocked(run)).toBe(true);
    expect(sent(fetchMock)).toEqual([]);
  });

  it("refuses a DROPPED file of the wrong kind, names what it takes, and sends nothing", async () => {
    const { fetchMock, input, run } = await renderReady(Panel, tool);
    const wrong = wrongFileFor(tool);
    const zone = input.closest("label");
    expect(
      zone,
      `${tool.slug}: the picker is not inside its drop zone`,
    ).not.toBeNull();
    // A drop, because a drop is what `accept` does not filter.
    fireEvent.drop(zone!, { dataTransfer: { files: [wrong] } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`"${wrong.name}"`);
    expect(alert).toHaveTextContent(tool.name);
    expect(alert).not.toHaveTextContent(/declared/i);
    // A Word file on a PDF tool is pointed at the tool that converts it,
    // found here by what the catalogue says it does, not by name.
    if (tool.accept.includes("PDF")) {
      const converter = tools.find(
        (t) =>
          t.accept.includes("DOCX") &&
          t.outputs.includes("PDF") &&
          !t.accept.includes("PDF"),
      );
      expect(converter).toBeDefined();
      expect(alert).toHaveTextContent(converter!.name);
    }
    expect(screen.queryByText(wrong.name)).not.toBeInTheDocument();
    expect(blocked(run)).toBe(true);
    expect(sent(fetchMock)).toEqual([]);
  });

  it("control: a file exactly at the ceiling is staged with no refusal", async () => {
    const ceiling = toolFileCeilingBytes(tool)!;
    const { input, run } = await renderReady(Panel, tool);
    const file = fileOfSize(tool, ceiling);

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(file.name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Where the file is all the run needs, the button unblocks. Five panels
    // also need a prompt, a question, a password or a signer, so for them the
    // staged file name above is the evidence — and the set is held to that:
    // a tool that stops needing more must leave it.
    expect(blocked(run)).toBe(NEEDS_MORE_THAN_A_FILE.has(tool.slug));
  });
});

/*
 * The refusal above is the property; the page's own description of it is the
 * claim. Two Office to PDF pages said a file over the ceiling "still uploads"
 * and is refused by the converter afterwards — true before `refuse` moved the
 * check to the pick, false after, and nothing read the copy. Every page a
 * panel above serves is held to the refusal this file proves, with the
 * shipped sentences as the corpus in both directions.
 */
describe("no page these panels serve says an over-ceiling file still uploads", () => {
  const SHIPPED = [
    "Up to N MB. A bigger deck still uploads, but the LibreOffice step then refuses it and the job ends with a size error, without a retry.",
    "The LibreOffice converter takes a file of up to N MB unless the worker is configured otherwise; a bigger one is still uploaded, then turned away with a size error before any conversion starts, so nothing half-rendered comes back.",
  ];
  const STILL_UPLOADS = /\bstill (?:be )?upload(?:s|ed)\b/i;

  /** Every string a tool's page serves. */
  const served = (tool: Tool) => [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];

  it("the pattern catches every shipped sentence, and not the fixed one", () => {
    for (const s of SHIPPED) expect(STILL_UPLOADS.test(s), s).toBe(true);
    expect(
      STILL_UPLOADS.test(
        "A bigger deck is turned away as soon as you pick it, before anything is uploaded.",
      ),
    ).toBe(false);
  });

  it("no served field on a refusing panel's page says it", () => {
    const subjects = SUBJECTS.flatMap((s) => s.tools);
    // Health: the same discovered corpus the refusal tests run on.
    expect(subjects.length).toBeGreaterThanOrEqual(19);
    const fields = subjects.flatMap((tool) =>
      served(tool).map((text) => ({ slug: tool.slug, text })),
    );
    expect(fields.length).toBeGreaterThan(subjects.length * 10);
    expect(
      fields
        .filter(({ text }) => STILL_UPLOADS.test(text))
        .map(({ slug, text }) => `${slug}: ${text}`),
    ).toEqual([]);
  });
});
