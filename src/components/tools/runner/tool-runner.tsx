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
    default:
      return null;
  }
}
