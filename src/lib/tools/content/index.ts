/**
 * Every tool page's search-facing content, keyed by catalogue slug.
 *
 * STATIC imports, one per file, on purpose: the page is statically generated,
 * so the bundler must see every module, and a guard can DERIVE the set of
 * content files from this index (the thing the page actually consumes) rather
 * than from a directory listing that could hold a file nobody imports.
 * `content.test.ts` compares this map with the catalogue in both directions.
 */
import type { ToolContent } from "./types";
import aiExtract from "./ai-extract";
import annotatePdf from "./annotate-pdf";
import chatWithPdf from "./chat-with-pdf";
import comparePdf from "./compare-pdf";
import compressPdf from "./compress-pdf";
import createForms from "./create-forms";
import cropPdf from "./crop-pdf";
import editPdf from "./edit-pdf";
import editPdfMetadata from "./edit-pdf-metadata";
import excelToPdf from "./excel-to-pdf";
import extractImages from "./extract-images";
import extractPages from "./extract-pages";
import extractTables from "./extract-tables";
import fillForms from "./fill-forms";
import flattenPdf from "./flatten-pdf";
import grayscalePdf from "./grayscale-pdf";
import headerFooter from "./header-footer";
import htmlToPdf from "./html-to-pdf";
import jpgToPdf from "./jpg-to-pdf";
import markdownToPdf from "./markdown-to-pdf";
import mergePdf from "./merge-pdf";
import nUpPdf from "./n-up-pdf";
import ocrPdf from "./ocr-pdf";
import optimizeWeb from "./optimize-web";
import organizePages from "./organize-pages";
import overlayPdf from "./overlay-pdf";
import pageNumbers from "./page-numbers";
import pdfToExcel from "./pdf-to-excel";
import pdfToJpg from "./pdf-to-jpg";
import pdfToMarkdown from "./pdf-to-markdown";
import pdfToPdfa from "./pdf-to-pdfa";
import pdfToPng from "./pdf-to-png";
import pdfToPowerpoint from "./pdf-to-powerpoint";
import pdfToText from "./pdf-to-text";
import pdfToWord from "./pdf-to-word";
import pngToPdf from "./png-to-pdf";
import powerpointToPdf from "./powerpoint-to-pdf";
import protectPdf from "./protect-pdf";
import redactPdf from "./redact-pdf";
import removePages from "./remove-pages";
import repairPdf from "./repair-pdf";
import requestSignatures from "./request-signatures";
import resizePdf from "./resize-pdf";
import rotatePdf from "./rotate-pdf";
import scanToPdf from "./scan-to-pdf";
import signPdf from "./sign-pdf";
import splitPagesInHalf from "./split-pdf-pages-in-half";
import splitPdf from "./split-pdf";
import summarizePdf from "./summarize-pdf";
import textToPdf from "./text-to-pdf";
import translatePdf from "./translate-pdf";
import unlockPdf from "./unlock-pdf";
import watermarkPdf from "./watermark-pdf";
import webpageToPdf from "./webpage-to-pdf";
import wordToPdf from "./word-to-pdf";

export type { ToolContent };

/** slug → content. Built from the modules above; never typed by hand. */
export const toolContent: Readonly<Record<string, ToolContent>> =
  Object.fromEntries(
    [
      aiExtract,
      annotatePdf,
      chatWithPdf,
      comparePdf,
      compressPdf,
      createForms,
      cropPdf,
      editPdf,
      editPdfMetadata,
      excelToPdf,
      extractImages,
      extractPages,
      extractTables,
      fillForms,
      flattenPdf,
      grayscalePdf,
      headerFooter,
      htmlToPdf,
      jpgToPdf,
      markdownToPdf,
      mergePdf,
      nUpPdf,
      ocrPdf,
      optimizeWeb,
      organizePages,
      overlayPdf,
      pageNumbers,
      pdfToExcel,
      pdfToJpg,
      pdfToMarkdown,
      pdfToPdfa,
      pdfToPng,
      pdfToPowerpoint,
      pdfToText,
      pdfToWord,
      pngToPdf,
      powerpointToPdf,
      protectPdf,
      redactPdf,
      removePages,
      repairPdf,
      requestSignatures,
      resizePdf,
      rotatePdf,
      scanToPdf,
      signPdf,
      splitPagesInHalf,
      splitPdf,
      summarizePdf,
      textToPdf,
      translatePdf,
      unlockPdf,
      watermarkPdf,
      webpageToPdf,
      wordToPdf,
    ].map((entry) => [entry.slug, entry]),
  );

/** The authored content for one tool, or undefined for a slug with none. */
export function getToolContent(slug: string): ToolContent | undefined {
  return Object.hasOwn(toolContent, slug) ? toolContent[slug] : undefined;
}
