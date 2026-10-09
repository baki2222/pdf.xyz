"use client";

/**
 * The tool page's worker panels, one chunk each.
 *
 * `app/tools/[slug]/page.tsx` imported these 13 panels statically. A server
 * component's client imports all land in the route's one client entry, so on
 * main f2b3db8b every tool page — Rotate included — loaded every worker panel
 * (with the 27 runners, a 539 KB route chunk). Re-exported here as
 * `next/dynamic` loaders under the SAME names, so the page changes only its
 * import lines: each panel is its own chunk, preloaded by the one page that
 * renders it. SSR stays on (the default), so the server HTML is unchanged.
 *
 * The property is measured on the build by
 * src/deploy/own-panel-first-load.test.ts, not by this comment.
 */
import dynamic from "next/dynamic";

export const OcrWorkerPanel = dynamic(() =>
  import("./ocr-worker-panel").then(({ OcrWorkerPanel }) => OcrWorkerPanel),
);
export const PdfSecurityWorkerPanel = dynamic(() =>
  import("./pdf-security-worker-panel").then(
    ({ PdfSecurityWorkerPanel }) => PdfSecurityWorkerPanel,
  ),
);
export const PdfStructureWorkerPanel = dynamic(() =>
  import("./pdf-structure-worker-panel").then(
    ({ PdfStructureWorkerPanel }) => PdfStructureWorkerPanel,
  ),
);
export const PdfArchiveWorkerPanel = dynamic(() =>
  import("./pdf-archive-worker-panel").then(
    ({ PdfArchiveWorkerPanel }) => PdfArchiveWorkerPanel,
  ),
);
export const HtmlRenderWorkerPanel = dynamic(() =>
  import("./html-render-worker-panel").then(
    ({ HtmlRenderWorkerPanel }) => HtmlRenderWorkerPanel,
  ),
);
export const OfficeConversionWorkerPanel = dynamic(() =>
  import("./office-conversion-worker-panel").then(
    ({ OfficeConversionWorkerPanel }) => OfficeConversionWorkerPanel,
  ),
);
export const PdfOfficeExportWorkerPanel = dynamic(() =>
  import("./pdf-office-export-worker-panel").then(
    ({ PdfOfficeExportWorkerPanel }) => PdfOfficeExportWorkerPanel,
  ),
);
export const TableExtractWorkerPanel = dynamic(() =>
  import("./table-extract-worker-panel").then(
    ({ TableExtractWorkerPanel }) => TableExtractWorkerPanel,
  ),
);
export const RequestSignaturesWorkerPanel = dynamic(() =>
  import("./request-signatures-worker-panel").then(
    ({ RequestSignaturesWorkerPanel }) => RequestSignaturesWorkerPanel,
  ),
);
export const SummarizeWorkerPanel = dynamic(() =>
  import("./summarize-worker-panel").then(
    ({ SummarizeWorkerPanel }) => SummarizeWorkerPanel,
  ),
);
export const TranslateWorkerPanel = dynamic(() =>
  import("./translate-worker-panel").then(
    ({ TranslateWorkerPanel }) => TranslateWorkerPanel,
  ),
);
export const AiExtractWorkerPanel = dynamic(() =>
  import("./ai-extract-worker-panel").then(
    ({ AiExtractWorkerPanel }) => AiExtractWorkerPanel,
  ),
);
export const ChatWithPdfWorkerPanel = dynamic(() =>
  import("./chat-with-pdf-worker-panel").then(
    ({ ChatWithPdfWorkerPanel }) => ChatWithPdfWorkerPanel,
  ),
);
