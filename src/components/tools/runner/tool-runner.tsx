"use client";

import dynamic from "next/dynamic";
import type { RunnerKind } from "@/lib/pdf/registry";
import { rasterFormatForSlug } from "@/lib/pdf/raster-format";

/*
 * ONE CHUNK PER RUNNER. These were 27 static imports, and App Router puts
 * every client module a route reaches into that route's one client entry: on
 * main f2b3db8b every tool page loaded a 539 KB route chunk holding all 27
 * runners and all 13 worker panels. As `next/dynamic` loaders each runner is
 * its own chunk, and the page that mounts it preloads it from the server
 * render — SSR stays on (the default), so the server HTML, including the
 * dropzone a pre-hydration pick lands in, is unchanged.
 *
 * The property — a page's first load carries its own runner and no other
 * tool's — is measured on the build by src/deploy/own-panel-first-load.test.ts,
 * not by this comment; a static import of any runner from here (or from
 * anything the route imports) turns it red.
 */
const MergeRunner = dynamic(() =>
  import("./merge-runner").then(({ MergeRunner }) => MergeRunner),
);
const SplitRunner = dynamic(() =>
  import("./split-runner").then(({ SplitRunner }) => SplitRunner),
);
const RotateRunner = dynamic(() =>
  import("./rotate-runner").then(({ RotateRunner }) => RotateRunner),
);
const OrganizeRunner = dynamic(() =>
  import("./organize-runner").then(({ OrganizeRunner }) => OrganizeRunner),
);
const PageSelectRunner = dynamic(() =>
  import("./page-select-runner").then(
    ({ PageSelectRunner }) => PageSelectRunner,
  ),
);
const CompressRunner = dynamic(() =>
  import("./compress-runner").then(({ CompressRunner }) => CompressRunner),
);
const PdfToTextRunner = dynamic(() =>
  import("./pdf-to-text-runner").then(({ PdfToTextRunner }) => PdfToTextRunner),
);
const PdfToMarkdownRunner = dynamic(() =>
  import("./pdf-to-markdown-runner").then(
    ({ PdfToMarkdownRunner }) => PdfToMarkdownRunner,
  ),
);
const TextToPdfRunner = dynamic(() =>
  import("./text-to-pdf-runner").then(({ TextToPdfRunner }) => TextToPdfRunner),
);
const MarkdownToPdfRunner = dynamic(() =>
  import("./markdown-to-pdf-runner").then(
    ({ MarkdownToPdfRunner }) => MarkdownToPdfRunner,
  ),
);
const ImageToPdfRunner = dynamic(() =>
  import("./image-to-pdf-runner").then(
    ({ ImageToPdfRunner }) => ImageToPdfRunner,
  ),
);
const PdfToImageRunner = dynamic(() =>
  import("./pdf-to-image-runner").then(
    ({ PdfToImageRunner }) => PdfToImageRunner,
  ),
);
const PageNumbersRunner = dynamic(() =>
  import("./page-numbers-runner").then(
    ({ PageNumbersRunner }) => PageNumbersRunner,
  ),
);
const WatermarkRunner = dynamic(() =>
  import("./watermark-runner").then(({ WatermarkRunner }) => WatermarkRunner),
);
const HeaderFooterRunner = dynamic(() =>
  import("./header-footer-runner").then(
    ({ HeaderFooterRunner }) => HeaderFooterRunner,
  ),
);
const CropRunner = dynamic(() =>
  import("./crop-runner").then(({ CropRunner }) => CropRunner),
);
const SignRunner = dynamic(() =>
  import("./sign-runner").then(({ SignRunner }) => SignRunner),
);
const FlattenRunner = dynamic(() =>
  import("./flatten-runner").then(({ FlattenRunner }) => FlattenRunner),
);
const OverlayRunner = dynamic(() =>
  import("./overlay-runner").then(({ OverlayRunner }) => OverlayRunner),
);
const GrayscaleRunner = dynamic(() =>
  import("./grayscale-runner").then(({ GrayscaleRunner }) => GrayscaleRunner),
);
const RedactRunner = dynamic(() =>
  import("./redact-runner").then(({ RedactRunner }) => RedactRunner),
);
const FillFormsRunner = dynamic(() =>
  import("./fill-forms-runner").then(({ FillFormsRunner }) => FillFormsRunner),
);
const CreateFormsRunner = dynamic(() =>
  import("./create-forms-runner").then(
    ({ CreateFormsRunner }) => CreateFormsRunner,
  ),
);
const AnnotateRunner = dynamic(() =>
  import("./annotate-runner").then(({ AnnotateRunner }) => AnnotateRunner),
);
const EditRunner = dynamic(() =>
  import("./edit-runner").then(({ EditRunner }) => EditRunner),
);
const ExtractImagesRunner = dynamic(() =>
  import("./extract-images-runner").then(
    ({ ExtractImagesRunner }) => ExtractImagesRunner,
  ),
);
const ComparePdfRunner = dynamic(() =>
  import("./compare-pdf-runner").then(
    ({ ComparePdfRunner }) => ComparePdfRunner,
  ),
);

const ScanRunner = dynamic(() =>
  import("./scan-runner").then(({ ScanRunner }) => ScanRunner),
);
const MetadataRunner = dynamic(() =>
  import("./metadata-runner").then(({ MetadataRunner }) => MetadataRunner),
);
const ResizeRunner = dynamic(() =>
  import("./resize-runner").then(({ ResizeRunner }) => ResizeRunner),
);
const NUpRunner = dynamic(() =>
  import("./n-up-runner").then(({ NUpRunner }) => NUpRunner),
);
const SplitHalfRunner = dynamic(() =>
  import("./split-half-runner").then(({ SplitHalfRunner }) => SplitHalfRunner),
);

/**
 * Client-side dispatcher: renders the interactive runner for a supported tool.
 * The dynamic tool page decides whether a tool is supported (via the registry)
 * and, if so, mounts this component in place of the placeholder upload panel.
 * Each case renders a `next/dynamic` loader above, so mounting one runner
 * fetches that runner's chunk and no other.
 */
export function ToolRunner({ kind, slug }: { kind: RunnerKind; slug: string }) {
  switch (kind) {
    case "merge":
      return <MergeRunner />;
    case "split":
      return <SplitRunner />;
    case "rotate":
      return <RotateRunner />;
    case "extract-pages":
      return <PageSelectRunner mode="extract" />;
    case "delete-pages":
      return <PageSelectRunner mode="delete" />;
    case "organize":
      return <OrganizeRunner />;
    case "compress":
      return <CompressRunner />;
    case "pdf-to-text":
      return <PdfToTextRunner />;
    case "pdf-to-markdown":
      return <PdfToMarkdownRunner />;
    case "text-to-pdf":
      return <TextToPdfRunner />;
    case "markdown-to-pdf":
      return <MarkdownToPdfRunner />;
    case "image-to-pdf":
      return <ImageToPdfRunner kind={slug === "png-to-pdf" ? "png" : "jpg"} />;
    case "pdf-to-image":
      return <PdfToImageRunner format={rasterFormatForSlug(slug)} />;
    case "page-numbers":
      return <PageNumbersRunner />;
    case "watermark":
      return <WatermarkRunner />;
    case "header-footer":
      return <HeaderFooterRunner />;
    case "crop":
      return <CropRunner />;
    case "sign":
      return <SignRunner />;
    case "flatten":
      return <FlattenRunner />;
    case "overlay":
      return <OverlayRunner />;
    case "grayscale":
      return <GrayscaleRunner />;
    case "redact":
      return <RedactRunner />;
    case "fill-forms":
      return <FillFormsRunner />;
    case "create-forms":
      return <CreateFormsRunner />;
    case "annotate":
      return <AnnotateRunner />;
    case "edit":
      return <EditRunner />;
    case "extract-images":
      return <ExtractImagesRunner />;
    case "compare":
      return <ComparePdfRunner />;
    case "scan":
      return <ScanRunner />;
    case "metadata":
      return <MetadataRunner />;
    case "resize":
      return <ResizeRunner />;
    case "n-up":
      return <NUpRunner />;
    case "split-half":
      return <SplitHalfRunner />;
    default:
      return null;
  }
}
