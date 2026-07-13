"use client";

import type { RunnerKind } from "@/lib/pdf/registry";
import { rasterFormatForSlug } from "@/lib/pdf/pdf-to-image";
import { MergeRunner } from "./merge-runner";
import { SplitRunner } from "./split-runner";
import { RotateRunner } from "./rotate-runner";
import { OrganizeRunner } from "./organize-runner";
import { PageSelectRunner } from "./page-select-runner";
import { CompressRunner } from "./compress-runner";
import { PdfToTextRunner } from "./pdf-to-text-runner";
import { TextToPdfRunner } from "./text-to-pdf-runner";
import { ImageToPdfRunner } from "./image-to-pdf-runner";
import { PdfToImageRunner } from "./pdf-to-image-runner";
import { PageNumbersRunner } from "./page-numbers-runner";
import { WatermarkRunner } from "./watermark-runner";
import { HeaderFooterRunner } from "./header-footer-runner";
import { CropRunner } from "./crop-runner";
import { SignRunner } from "./sign-runner";
import { FlattenRunner } from "./flatten-runner";
import { OverlayRunner } from "./overlay-runner";
import { GrayscaleRunner } from "./grayscale-runner";
import { FillFormsRunner } from "./fill-forms-runner";

/**
 * Client-side dispatcher: renders the interactive runner for a supported tool.
 * The dynamic tool page decides whether a tool is supported (via the registry)
 * and, if so, mounts this component in place of the placeholder upload panel.
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
    case "text-to-pdf":
      return <TextToPdfRunner />;
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
    case "fill-forms":
      return <FillFormsRunner />;
    default:
      return null;
  }
}
