import type { ComponentType } from "react";
import type { Tool } from "@/lib/tools/types";
import { AiExtractWorkerPanel } from "@/components/tools/ai-extract-worker-panel";
import { ChatWithPdfWorkerPanel } from "@/components/tools/chat-with-pdf-worker-panel";
import { HtmlRenderWorkerPanel } from "@/components/tools/html-render-worker-panel";
import { OcrWorkerPanel } from "@/components/tools/ocr-worker-panel";
import { OfficeConversionWorkerPanel } from "@/components/tools/office-conversion-worker-panel";
import { PdfArchiveWorkerPanel } from "@/components/tools/pdf-archive-worker-panel";
import { PdfOfficeExportWorkerPanel } from "@/components/tools/pdf-office-export-worker-panel";
import { PdfSecurityWorkerPanel } from "@/components/tools/pdf-security-worker-panel";
import { PdfStructureWorkerPanel } from "@/components/tools/pdf-structure-worker-panel";
import { RequestSignaturesWorkerPanel } from "@/components/tools/request-signatures-worker-panel";
import { SummarizeWorkerPanel } from "@/components/tools/summarize-worker-panel";
import { TableExtractWorkerPanel } from "@/components/tools/table-extract-worker-panel";
import { TranslateWorkerPanel } from "@/components/tools/translate-worker-panel";

/** One worker panel and the tools it serves. */
export interface WorkerPanelRoute {
  /** The catalogue slugs this panel serves. */
  readonly slugs: readonly string[];
  /** The panel: it checks the worker, takes the file, runs the job. */
  readonly Panel: ComponentType<{ tool: Tool }>;
  /**
   * The crash-telemetry label for the error boundary around it — the panel's
   * module name (`tool-page-registry.test.ts` holds that). Not user data.
   */
  readonly boundary: string;
}

/**
 * Which panel runs each tool that has no path in the browser — the secure
 * worker's tools and the AI ones. Every other tool has an in-browser runner
 * (`@/lib/pdf/registry`).
 *
 * WAS a chain of `tool.slug === "…" ? <XWorkerPanel tool={tool} />` ternaries
 * inside `app/tools/[slug]/page.tsx`, ending in a `WorkerPreview` fallback for
 * anything the chain did not name. The fallback rendered for no tool, so a
 * slug dropped from the chain would have shipped a preview of a live tool
 * without a single test noticing. There is no fallback now: the page throws
 * for a slug that has neither a runner nor a route here, and
 * `tool-page-registry.test.ts` names the slug first.
 *
 * NOT a client module, on purpose: the page indexes this object on the
 * server, and a `"use client"` boundary would hand it a reference it cannot
 * index. Each panel is its own client component, imported here exactly as
 * the page imported them before.
 *
 * The guards that read panel source (`@/tests/worker-panel-dispatch`) parse
 * THIS list — the import table and the `{ slugs, Panel, boundary }` entries —
 * so keep each entry in that literal shape.
 */
export const WORKER_PANEL_ROUTES: readonly WorkerPanelRoute[] = [
  { slugs: ["ocr-pdf"], Panel: OcrWorkerPanel, boundary: "ocr-worker-panel" },
  {
    slugs: ["protect-pdf", "unlock-pdf"],
    Panel: PdfSecurityWorkerPanel,
    boundary: "pdf-security-worker-panel",
  },
  {
    slugs: ["repair-pdf", "optimize-web"],
    Panel: PdfStructureWorkerPanel,
    boundary: "pdf-structure-worker-panel",
  },
  {
    slugs: ["pdf-to-pdfa"],
    Panel: PdfArchiveWorkerPanel,
    boundary: "pdf-archive-worker-panel",
  },
  {
    slugs: ["html-to-pdf", "webpage-to-pdf"],
    Panel: HtmlRenderWorkerPanel,
    boundary: "html-render-worker-panel",
  },
  {
    slugs: ["word-to-pdf", "excel-to-pdf", "powerpoint-to-pdf"],
    Panel: OfficeConversionWorkerPanel,
    boundary: "office-conversion-worker-panel",
  },
  {
    slugs: ["pdf-to-word", "pdf-to-excel", "pdf-to-powerpoint"],
    Panel: PdfOfficeExportWorkerPanel,
    boundary: "pdf-office-export-worker-panel",
  },
  {
    slugs: ["extract-tables"],
    Panel: TableExtractWorkerPanel,
    boundary: "table-extract-worker-panel",
  },
  {
    slugs: ["request-signatures"],
    Panel: RequestSignaturesWorkerPanel,
    boundary: "request-signatures-worker-panel",
  },
  {
    slugs: ["summarize-pdf"],
    Panel: SummarizeWorkerPanel,
    boundary: "summarize-worker-panel",
  },
  {
    slugs: ["translate-pdf"],
    Panel: TranslateWorkerPanel,
    boundary: "translate-worker-panel",
  },
  {
    slugs: ["ai-extract"],
    Panel: AiExtractWorkerPanel,
    boundary: "ai-extract-worker-panel",
  },
  {
    slugs: ["chat-with-pdf"],
    Panel: ChatWithPdfWorkerPanel,
    boundary: "chat-with-pdf-worker-panel",
  },
];

/** Slug → the route that serves it: what the tool page indexes. */
export const WORKER_PANELS: Readonly<Record<string, WorkerPanelRoute>> =
  Object.fromEntries(
    WORKER_PANEL_ROUTES.flatMap((route) =>
      route.slugs.map((slug) => [slug, route] as const),
    ),
  );
