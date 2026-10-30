// @vitest-environment jsdom
// @native-canvas
/**
 * A WORKER'S RESULT, NOT YET DOWNLOADED, IS NOT THROWN AWAY BY A PASTE
 * (2026-10-17). A paste that would replace the open file asks first while
 * a result on the page is not downloaded (`confirmReplaceResult`,
 * `@/lib/intent/unsaved`) — and the result surfaces register their result
 * for that (`useUnkeptResult` in the runner kit). The worker panels' card,
 * `ResultCard`, registered only when it was handed the run's `output`, and
 * none of the worker panels hands it one: a paste over a finished Protect
 * PDF replaced the protected file — a server job, gone — with no question
 * (PR #180 re-review, the CLAUDE.md rule-3 shape: the guard everywhere but
 * the paths that cost a job or AI spend).
 *
 * Held over EVERY worker panel the page routes whose result is a
 * `ResultCard`, DISCOVERED (`@/tests/worker-panel-dispatch`, the page's own
 * registry followed to each panel's module), not named: each driven through
 * the REAL job client over a stubbed network (`stubJobNetwork`) to its
 * card, a file pasted on the page — asked, and a no keeps the card — then
 * the card's own Download clicked, and a paste replaces without a word.
 * A discovered panel with no driver here is FATAL, not skipped.
 */
import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveRegion, resetAnnouncer } from "@/components/a11y/live-region";
import { DropLayer } from "@/components/intent/drop-layer";
import { ToolRunProvider } from "@/components/tools/runner/tool-context";
import { continueTargetsFor } from "@/lib/intent/next-steps";
import {
  activePageTarget,
  resetPageTargetsForTests,
} from "@/lib/intent/page-target";
import { resetUnsavedForTests } from "@/lib/intent/unsaved";
import type { JobArtifact } from "@/lib/jobs/types";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import { tools } from "@/lib/tools";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";
import { resetTelemetry } from "@/lib/telemetry/track";
import { withAppRouter } from "@/tests/app-router";
import { textPdf } from "@/tests/pdf-text-fixtures";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import { stubJobNetwork } from "@/tests/stub-job-network";
import {
  catalogTool,
  panelComponent,
  panelDispatchArms,
  type PanelArm,
} from "@/tests/worker-panel-dispatch";

/** A panel whose finished run is drawn as a `ResultCard`, read from its module. */
const drawsResultCard = (arm: PanelArm) =>
  readFileSync(arm.file, "utf8").includes("<ResultCard");

const ARMS = panelDispatchArms();
const SUBJECTS = ARMS.filter(drawsResultCard);

/**
 * How each panel is driven from a chosen file to its run: what it needs
 * set first, and its run button. Keyed by the panel's component name.
 */
const DRIVERS: Record<
  string,
  { slug?: string; prepare?: () => Promise<void>; run: RegExp }
> = {
  OcrWorkerPanel: { run: /recognize text/i },
  PdfSecurityWorkerPanel: {
    slug: "protect-pdf",
    prepare: async () => {
      fireEvent.change(await screen.findByLabelText("New password"), {
        target: { value: "correct horse" },
      });
    },
    run: /encrypt pdf/i,
  },
  PdfStructureWorkerPanel: {
    slug: "repair-pdf",
    run: /repair on our secure server/i,
  },
  PdfArchiveWorkerPanel: { run: /convert to pdf\/a/i },
  HtmlRenderWorkerPanel: { slug: "html-to-pdf", run: /^render pdf$/i },
  OfficeConversionWorkerPanel: { run: /^convert to pdf$/i },
  PdfOfficeExportWorkerPanel: { slug: "pdf-to-word", run: /export docx/i },
  TableExtractWorkerPanel: { run: /extract tables/i },
  RequestSignaturesWorkerPanel: {
    prepare: async () => {
      fireEvent.change(await screen.findByLabelText("Signer 1 name"), {
        target: { value: "Ada Lovelace" },
      });
      fireEvent.change(screen.getByLabelText("Signer 1 email"), {
        target: { value: "ada@example.com" },
      });
    },
    run: /prepare signature request/i,
  },
  SummarizeWorkerPanel: { run: /summarize pdf/i },
  TranslateWorkerPanel: { run: /translate pdf/i },
  AiExtractWorkerPanel: {
    prepare: async () => {
      fireEvent.change(
        await screen.findByRole("textbox", { name: "Field 1 name" }),
        { target: { value: "Total" } },
      );
    },
    run: /extract data/i,
  },
};

/** The tool a subject is driven as: its driver's, or its first that takes a file. */
function toolOf(arm: PanelArm): Tool {
  const slug =
    DRIVERS[arm.component]?.slug ??
    arm.slugs.find((s) => toolFileCeilingBytes(catalogTool(s)) !== null);
  if (!slug)
    throw new Error(`${arm.component} serves no tool that takes a file`);
  return catalogTool(slug);
}

/**
 * A file of the tool's first format, as a browser names and types it — a
 * PDF with real selectable text (the AI panels read it before they upload).
 */
async function fileFor(tool: Tool, stem: string): Promise<File> {
  const format = tool.accept[0]!.toUpperCase();
  const ext = EXTENSIONS_BY_FORMAT[format]?.[0] ?? format.toLowerCase();
  const type = MIME_BY_FORMAT[format]?.[0] ?? "";
  const bytes =
    format === "PDF"
      ? await textPdf([1_200])
      : new TextEncoder().encode(format === "HTML" ? "<p>hello</p>" : "PK");
  return new File([bytes as BlobPart], `${stem}.${ext}`, { type });
}

/** Paste `files` with focus on the page, as Ctrl+V does outside a field. */
function paste(files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files } });
  act(() => {
    document.body.dispatchEvent(event);
  });
}

const artifact: JobArtifact = {
  artifactId: "a_stub",
  filename: "out.pdf",
  contentType: "application/pdf",
  bytes: 8,
  url: "/api/jobs/j_stub/artifacts/a_stub",
  expiresAt: new Date(0).toISOString(),
};

const URL_STATICS = ["createObjectURL", "revokeObjectURL"] as const;
const ORIGINAL = URL_STATICS.map(
  (key) => [key, Object.getOwnPropertyDescriptor(URL, key)] as const,
);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  resetPageTargetsForTests();
  resetUnsavedForTests();
  resetAnnouncer();
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [key, descriptor] of ORIGINAL) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});

describe("health: the corpus is every routed panel whose result is a card", () => {
  it("12 or more, every one with a driver — and the reader tells a panel with no card from one with", () => {
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(12);
    expect(
      SUBJECTS.filter((arm) => !DRIVERS[arm.component]).map((a) => a.component),
      "discovered panels with no driver here — write one",
    ).toEqual([]);
    // Both answers occur: a routed panel whose result is not a card (a
    // chat) is read as such, so the filter is not passing everything.
    expect(ARMS.length).toBeGreaterThan(SUBJECTS.length);
  });
});

describe.each(SUBJECTS.map((arm) => ({ arm, name: arm.component })))(
  "$name",
  { timeout: 60_000 },
  ({ arm }) => {
    it("a paste over its finished result asks first, a no keeps it — and once downloaded, a paste replaces it without a question", async () => {
      const tool = toolOf(arm);
      const driver = DRIVERS[arm.component]!;
      stubJobNetwork(READY, () => ({
        status: "completed",
        artifact: {
          artifact,
          bytes: new TextEncoder().encode("%PDF-1.7"),
        },
      }));
      const Panel = await panelComponent(arm);
      const { container } = render(
        withAppRouter(
          <>
            <h1>{tool.name}</h1>
            <div data-tool-panel data-tool-name={tool.name}>
              <ToolRunProvider
                tool={{
                  slug: tool.slug,
                  name: tool.name,
                  category: tool.category,
                }}
                plan={continueTargetsFor(tool, tools)}
              >
                <Panel tool={tool} />
              </ToolRunProvider>
            </div>
            <DropLayer />
            <LiveRegion />
          </>,
        ),
      );
      const input = await waitFor(
        () => {
          const found =
            container.querySelector<HTMLInputElement>('input[type="file"]');
          if (!found) throw new Error(`${tool.slug} shows no file picker`);
          return found;
        },
        { timeout: 10_000 },
      );
      const first = await fileFor(tool, "alpha");
      fireEvent.change(input, { target: { files: [first] } });
      expect(
        await screen.findByText(first.name, undefined, { timeout: 10_000 }),
      ).toBeInTheDocument();
      await driver.prepare?.();
      const run = await screen.findByRole("button", { name: driver.run });
      await waitFor(
        () => expect(run).not.toHaveAttribute("aria-disabled", "true"),
        { timeout: 15_000 },
      );
      fireEvent.click(run);

      // Its result: the card its Download is drawn in.
      const download = await waitFor(
        () => {
          const found = container.querySelector<HTMLElement>("[data-download]");
          if (!found) throw new Error(`${tool.slug} drew no result`);
          return found;
        },
        { timeout: 20_000 },
      );
      const card = download.closest<HTMLElement>('[role="group"]');
      expect(card?.getAttribute("aria-label"), "no result card").toBeTruthy();
      // The chip is the page's target: a paste replaces the chosen file.
      await waitFor(() => expect(activePageTarget()?.verb).toBe("replace"), {
        timeout: 10_000,
      });

      // ASKED: the result is not downloaded yet.
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const second = await fileFor(tool, "pasted");
      paste([second]);
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), {
        timeout: 10_000,
      });
      expect(confirm.mock.calls[0]![0]).toMatch(/not downloaded yet/i);
      expect(confirm.mock.calls[0]![0]).toContain(second.name);
      // A no keeps the result, and the file it was made from.
      await new Promise((r) => setTimeout(r, 300));
      expect(card!.isConnected, "the result was replaced").toBe(true);
      expect(screen.queryByText(second.name)).toBeNull();

      // CONTROL: downloaded, it is kept — a paste replaces it, unasked.
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: () => "blob:worker-result-paste",
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: () => {},
      });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => {},
      );
      fireEvent.click(download);
      confirm.mockClear();
      paste([second]);
      expect(
        await screen.findByText(second.name, undefined, { timeout: 10_000 }),
      ).toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
    });
  },
);
