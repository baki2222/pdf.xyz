"use client";

/**
 * The 13 worker panels as `next/dynamic` loaders, one chunk each — what the
 * registry (`./worker-panels.tsx`) binds as each route's `Panel`.
 *
 * WHY A SEPARATE CLIENT MODULE, and not `dynamic()` calls in the registry:
 * App Router builds a route's client entry from every `"use client"` module
 * its server graph reaches — `import()` edges included — and loads each one
 * eagerly (`next-flight-client-entry-loader`, `webpackMode: "eager"`, Next
 * 16.3). A loader written in the SERVER registry would therefore put all 13
 * panels back into every tool page's first load. Here the boundary is this
 * file, and the `import()`s inside it are ordinary client code splits. The
 * registry cannot be this file either: the page indexes it on the server, and
 * a client module hands the server a reference it cannot index.
 *
 * WAS, before 2026-10-09: the page imported these 13 panels statically, and
 * every tool page — Rotate included — loaded every one of them (with the 27
 * runners, a 539 KB route chunk on main f2b3db8b). SSR stays on (the default),
 * so each panel is still in its page's server HTML.
 *
 * The property is measured on the build by
 * src/deploy/own-panel-first-load.test.ts, not by this comment; the shared
 * reader (`@/tests/tool-panel-modules`) follows each loader below to the
 * module it loads, so keep them in the `() => import("…").then(({ X }) => X)`
 * shape it reads (anything else is a FATAL error there, not a smaller set).
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
