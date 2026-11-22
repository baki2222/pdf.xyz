// @vitest-environment jsdom
// @native-canvas
/**
 * The "Largest file" row on a worker panel states the SAME ceiling the page
 * copy states and the pick check refuses above (audit optimize-web#7).
 *
 * The Repair PDF / Optimize for Web panel read `JOB_LIMITS.maxFileBytes`, the
 * worker's global cap, while the page copy and the pick refusal read the
 * tool's own ceiling (`toolFileCeiling`, handed to the panel as
 * `ToolRun.pick.ceilingBytes`). Both are 100 MB today, so a test that only
 * compared the row with today's figure could not fail on the defect: the two
 * numbers agree by coincidence. So each panel is rendered twice — with the
 * page's real facts (the row must say the real ceiling) and with the facts'
 * ceiling moved to a figure no constant holds (the row must follow it). The
 * second is the one the defect turns red.
 *
 * THE SUBJECTS ARE DISCOVERED from the registry the tool page dispatches on
 * (`panelDispatchArms`). Panels that still print the global cap are listed in
 * {@link STILL_GLOBAL}, and that list is held in both directions: a member
 * that starts following the page's ceiling must leave it.
 */
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import { toolRunInfoFor } from "@/lib/tools/tool-run-info";
import { formatBytes } from "@/lib/utils";
import { resetTelemetry } from "@/lib/telemetry/track";
import { READY_WORKER_STATUS as READY } from "@/tests/ready-worker-status";
import { panelDispatchArms } from "@/tests/worker-panel-dispatch";
import { withAppRouter } from "@/tests/app-router";
import { ToolRunProvider } from "./runner/tool-context";
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

const PANELS: Record<string, ComponentType<{ tool: Tool }>> = {
  AiExtractWorkerPanel,
  ChatWithPdfWorkerPanel,
  HtmlRenderWorkerPanel,
  OcrWorkerPanel,
  OfficeConversionWorkerPanel,
  PdfArchiveWorkerPanel,
  PdfOfficeExportWorkerPanel,
  PdfSecurityWorkerPanel,
  PdfStructureWorkerPanel,
  RequestSignaturesWorkerPanel,
  SummarizeWorkerPanel,
  TableExtractWorkerPanel,
  TranslateWorkerPanel,
};

/**
 * Panels whose row still prints the worker's global cap. Outside the
 * optimize-web#7 lane; each still agrees with the page today only because
 * its tools' ceiling IS the global cap. Held both ways below.
 */
const STILL_GLOBAL = new Set([
  "AiExtractWorkerPanel",
  "ChatWithPdfWorkerPanel",
  "PdfArchiveWorkerPanel",
  "PdfOfficeExportWorkerPanel",
  "RequestSignaturesWorkerPanel",
  "SummarizeWorkerPanel",
  "TableExtractWorkerPanel",
  "TranslateWorkerPanel",
]);

/** Panels that show no "Largest file" row at all. Held both ways below. */
const NO_ROW = new Set(["OcrWorkerPanel"]);

/** A ceiling no constant in the product holds: 37 MiB. */
const MOVED = 37 * 1024 * 1024;

const ARMS = panelDispatchArms();

const SUBJECTS = ARMS.flatMap((arm) =>
  arm.slugs
    .map((slug) => getToolBySlug(slug))
    .filter((tool): tool is Tool => !!tool)
    .filter((tool) => toolFileCeilingBytes(tool) !== null)
    .map((tool) => ({ name: arm.component, tool, slug: tool.slug })),
);

function stubNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/worker/status")) {
        return { ok: true, json: async () => READY } as Response;
      }
      throw new TypeError("Failed to fetch");
    }),
  );
}

/** The text of the "Largest file" row, or null when the panel has none. */
function largestFileRow(
  Panel: ComponentType<{ tool: Tool }>,
  tool: Tool,
  ceilingBytes?: number,
): string | null {
  stubNetwork();
  const info = toolRunInfoFor(tool);
  const run =
    ceilingBytes === undefined || !info.pick
      ? info
      : { ...info, pick: { ...info.pick, ceilingBytes } };
  const { container, unmount } = render(
    withAppRouter(
      <ToolRunProvider tool={run} plan={{ targets: [] }}>
        <Panel tool={tool} />
      </ToolRunProvider>,
    ),
  );
  const label = [...container.querySelectorAll("span")].find(
    (el) => el.textContent?.trim() === "Largest file",
  );
  const value = label?.closest("div")?.lastElementChild?.textContent ?? null;
  unmount();
  return value;
}

afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("health checks", () => {
  it("every panel the page mounts has a row here, and the corpus is plausible", () => {
    const mounted = [...new Set(ARMS.map((a) => a.component))].sort();
    expect(mounted.length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(PANELS).sort()).toEqual(mounted);
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(19);
    // The two tools the finding names are in the corpus.
    const slugs = SUBJECTS.map((s) => s.slug);
    expect(slugs).toContain("optimize-web");
    expect(slugs).toContain("repair-pdf");
    for (const name of [...STILL_GLOBAL, ...NO_ROW])
      expect(mounted).toContain(name);
  });

  it("positive control: a tool whose ceiling is below the global cap shows its own figure", () => {
    const word = getToolBySlug("word-to-pdf")!;
    const ceiling = toolFileCeilingBytes(word)!;
    expect(ceiling).toBeLessThan(100 * 1024 * 1024);
    expect(largestFileRow(OfficeConversionWorkerPanel, word)).toBe(
      `${formatBytes(ceiling)}/file`,
    );
  });
});

describe.each(SUBJECTS)("$name for $slug", ({ name, tool }) => {
  const Panel = PANELS[name]!;

  it("states the page's ceiling for this tool", () => {
    const row = largestFileRow(Panel, tool);
    // A row that vanished states no figure, which is not a pass.
    expect(row === null, `${name}: has no Largest file row`).toBe(
      NO_ROW.has(name),
    );
    if (row === null) return;
    expect(row).toContain(`${formatBytes(toolFileCeilingBytes(tool)!)}/file`);
  });

  it("follows the page's ceiling when it moves (the defect's witness)", () => {
    const row = largestFileRow(Panel, tool, MOVED);
    expect(row === null).toBe(NO_ROW.has(name));
    if (row === null) return;
    const follows = row.includes(`${formatBytes(MOVED)}/file`);
    expect(follows, `${name} for ${tool.slug}: row reads "${row}"`).toBe(
      !STILL_GLOBAL.has(name),
    );
  });
});
