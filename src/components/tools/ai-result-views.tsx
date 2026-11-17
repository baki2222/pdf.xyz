"use client";

import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { downloadBlob } from "@/lib/pdf/browser";
import { citedPagesIn } from "@/lib/jobs/chat-citations";
import { AI_EXTRACT_NULL_CSV_LEGEND } from "@/lib/jobs/ai-extract-null-meaning";
import {
  AI_EXTRACT_CSV_SHAPE,
  extractionCsv,
  extractionCsvName,
  readExtraction,
  type ExtractionRead,
} from "@/lib/workers/ai-extract-package";
import { toTsv } from "@/lib/workers/ooxml/csv";
import { buildWorkbook } from "@/lib/workers/ooxml/workbook-write";
import { CopyTextButton } from "./copy-text-button";
import { AI_RESULT_CHUNK } from "./ai-result-chunk";
import { MarkdownText } from "./ai-markdown";
import {
  PAGE_CELL_LIMIT,
  PAGE_COLUMN_LIMIT,
  PAGE_ROW_LIMIT,
  PAGE_TEXT_LIMIT,
} from "./ai-result-limits";

/*
 * The AI results ON THE PAGE (competitor audit #4 and #16): AI Data
 * Extraction's table with Copy as table, Copy JSON and Download XLSX; Chat
 * with PDF's Copy answer, Copy conversation and Markdown download; and the
 * capped box PDF to Text, Summarize PDF and Chat with PDF show long text in;
 * and the summary and the chat answers drawn as formatted Markdown
 * (`./ai-markdown`, and `./chat-answer` for an answer's page buttons).
 *
 * ONE lazy chunk, fetched with the result and never with the page: each
 * caller reaches it through `import("./ai-result-views")` as its run starts
 * or its result is read, and `src/deploy/lazy-chunks.test.ts` holds it off
 * every page's first load by {@link AI_RESULT_CHUNK}. Everything here is
 * built from bytes already in the browser: nothing is sent anywhere.
 */

const count = (n: number) => n.toLocaleString("en-US");

function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/**
 * The first `limit` UTF-16 units of `text`, never ending inside a surrogate
 * pair (half an emoji would draw as a replacement box).
 */
export function cutForPage(
  text: string,
  limit = PAGE_TEXT_LIMIT,
): { shown: string; cut: boolean } {
  if (text.length <= limit) return { shown: text, cut: false };
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return { shown: text.slice(0, end), cut: true };
}

/**
 * Said under a box that shows only part of its text. Characters are Unicode
 * code points, the unit PDF to Text's result line counts in.
 */
export function textCutNote(shown: string, whole: string): string {
  return `Only the first ${count(codePoints(shown))} of ${count(codePoints(whole))} characters are shown here. Copying or downloading gives you all of it.`;
}

/** What a copy button says when the browser refuses, for a text the box cut. */
export const COPY_FAILED_CUT =
  "Your browser did not allow copying, and the box above shows only part of the text. Download it instead.";

/**
 * A long text in a box, with at most {@link PAGE_TEXT_LIMIT} characters of it
 * in the DOM and a plain note when the rest is left out. What a caller copies
 * or downloads is always the WHOLE text; only the box is cut.
 */
export function LongText({
  text,
  className,
  label,
  headingBase,
}: {
  text: string;
  className: string;
  /** Names the box as a focusable region (Summary); none for a plain box. */
  label?: string;
  /**
   * Draw the text as formatted Markdown, its shallowest heading at this
   * level; absent, the text is drawn as it is.
   */
  headingBase?: number;
}) {
  const { shown, cut } = cutForPage(text);
  const box = {
    "data-chunk": AI_RESULT_CHUNK,
    "data-long-text": cut ? "cut" : "whole",
    className,
    children:
      headingBase === undefined ? (
        shown
      ) : (
        <MarkdownText text={shown} headingBase={headingBase} />
      ),
  };
  return (
    <>
      {label ? (
        // Focusable so a keyboard can scroll a long text.
        <section aria-label={label} tabIndex={0} {...box} />
      ) : (
        <div {...box} />
      )}
      <TextCutNote text={text} />
    </>
  );
}

/**
 * Summarize PDF's Summary box: the model's Markdown drawn formatted, capped
 * like every long text. It sits in the result card under an h3, so the
 * summary's shallowest heading is an h4 (e2e/ai-results.spec.ts reads the
 * served page's outline). Copy summary and both downloads stay the source.
 */
export function SummaryBox({ text }: { text: string }) {
  return (
    <LongText
      label="Summary"
      text={text}
      headingBase={4}
      className="border-line text-fg bg-canvas rounded-panel focus-visible:ring-ok/50 max-h-96 overflow-auto border p-4 text-sm leading-6 whitespace-pre-wrap outline-none focus-visible:ring-2"
    />
  );
}

/** A chat answer, formatted, with its page buttons: lazy, like the rest. */
export { ChatAnswer } from "./chat-answer";

/**
 * The note under a box that shows only part of `text`, or nothing when it
 * shows all of it. Chat with PDF draws its answer itself (its `[p.N]`
 * buttons) from {@link cutForPage}'s `shown`, and this note under it.
 */
export function TextCutNote({ text }: { text: string }) {
  const { shown, cut } = cutForPage(text);
  return cut ? (
    <p
      data-chunk={AI_RESULT_CHUNK}
      className="text-muted text-xs leading-relaxed"
    >
      {textCutNote(shown, text)}
    </p>
  ) : null;
}

/** A chat answer's "Copy answer": the whole answer, whatever the box shows. */
export function CopyAnswer({ answer }: { answer: string }) {
  return (
    <div data-chunk={AI_RESULT_CHUNK}>
      <CopyTextButton
        text={answer}
        label="Copy answer"
        size="md"
        className="w-full sm:w-auto"
        {...(cutForPage(answer).cut ? { failed: COPY_FAILED_CUT } : {})}
      />
    </div>
  );
}

// ── AI Data Extraction ──────────────────────────────────────────────────

/** `invoice-extraction.zip` becomes `invoice-extraction.xlsx`. */
export function extractionXlsxName(zipName: string): string {
  return extractionCsvName(zipName).replace(/\.csv$/, ".xlsx");
}

/** The tab name of the workbook's one sheet. */
export const EXTRACTION_SHEET_NAME = "Extraction";

/** The workbook "Download XLSX" saves: the same rows as the CSV, one sheet. */
export function extractionXlsx(rows: string[][]): Promise<Uint8Array> {
  return buildWorkbook([{ name: EXTRACTION_SHEET_NAME, rows }]);
}

/** extraction.json as "Copy JSON" copies it: the whole file, indented. */
export function extractionJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** The package read, for the panel: re-exported so one `import()` brings both. */
export { readExtraction };
export type { ExtractionRead };

/**
 * The part of the rows the table draws, before any cell is shortened. ONE
 * definition, read by both {@link ExtractionTable} (what it draws) and
 * {@link tableCutNote} (what it says it left out), so the note cannot speak
 * of a cell the table never drew. One record (every field schema) is drawn as
 * Field | Value, so its fields are the body's rows.
 */
function drawnTable(rows: string[][]): {
  single: boolean;
  head: string[];
  body: string[][];
} {
  const header = rows[0]!;
  if (rows.length === 2)
    return {
      single: true,
      head: ["Field", "Value"],
      body: header
        .slice(0, PAGE_ROW_LIMIT)
        .map((field, i) => [field, rows[1]![i] ?? ""]),
    };
  return {
    single: false,
    head: header.slice(0, PAGE_COLUMN_LIMIT),
    body: rows
      .slice(1, PAGE_ROW_LIMIT + 1)
      .map((row) => row.slice(0, PAGE_COLUMN_LIMIT)),
  };
}

/** One line saying what the table leaves out, or `null` when it is whole. */
export function tableCutNote(rows: string[][]): string | null {
  const { single, head, body } = drawnTable(rows);
  const lines = single ? rows[0]!.length : rows.length - 1;
  const columns = single ? 1 : rows[0]!.length;
  const unit = single ? "fields" : "rows";
  const parts: string[] = [];
  if (lines > PAGE_ROW_LIMIT)
    parts.push(`the first ${count(PAGE_ROW_LIMIT)} of ${count(lines)} ${unit}`);
  if (columns > PAGE_COLUMN_LIMIT)
    parts.push(
      `${parts.length ? "" : "the first "}${count(PAGE_COLUMN_LIMIT)} of ${count(columns)} columns`,
    );
  // Only a cell the table DRAWS can be shortened on the page; the same
  // predicate {@link cell} cuts by. One record's head is the fixed labels.
  const drawn = single ? body : [head, ...body];
  const long = drawn.some((row) =>
    row.some((c) => cutForPage(c, PAGE_CELL_LIMIT).cut),
  );
  if (parts.length === 0 && !long) return null;
  const shown = parts.length
    ? `Showing ${parts.join(" and ")}${long ? ", with long values shortened" : ""}.`
    : "Long values are shortened here.";
  return `${shown} Copying or downloading gives you all of it.`;
}

function cell(text: string): string {
  const { shown, cut } = cutForPage(text, PAGE_CELL_LIMIT);
  return cut ? `${shown}${String.fromCharCode(0x2026)}` : shown;
}

const TH = "text-muted px-4 py-2 text-left text-xs font-medium";
const TD = "text-fg px-4 py-2 text-left font-normal";

/**
 * The extracted rows as a table. React renders every value as TEXT, never as
 * HTML: a value of `<img onerror=…>` is drawn as those characters
 * (ai-result-views.test.tsx). One record (every field schema) reads as
 * Field | Value; a list of records as one row each under the keys.
 */
export function ExtractionTable({ rows }: { rows: string[][] }) {
  const { single, head, body } = drawnTable(rows);
  const note = tableCutNote(rows);
  return (
    <>
      <div
        data-chunk={AI_RESULT_CHUNK}
        role="region"
        aria-label="Extracted data"
        // Focusable so a keyboard can scroll a wide or long table.
        tabIndex={0}
        className="border-line bg-wash rounded-panel max-h-96 overflow-auto border text-sm"
      >
        <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
          <caption
            className="text-muted text-xs"
            style={{ textAlign: "left", padding: "0.5rem 1rem 0" }}
          >
            {single
              ? "The fields the AI extracted"
              : `The records the AI extracted, one per row`}
          </caption>
          <thead>
            <tr>
              {head.map((key, i) => (
                <th key={i} scope="col" className={TH}>
                  {single ? key : cell(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-line border-t">
                {row.map((value, c) =>
                  single && c === 0 ? (
                    <th key={c} scope="row" className={TD}>
                      {cell(value)}
                    </th>
                  ) : (
                    <td key={c} className={TD}>
                      {cell(value)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="text-muted text-xs leading-relaxed">{note}</p>}
    </>
  );
}

const FILE_BUTTON = buttonVariants({
  variant: "secondary",
  className: "w-full sm:w-auto",
});

/**
 * The CSV legend, said once the CSV exists, above the actions. The words are
 * the package module's and the null-meaning module's, as before.
 */
export function ExtractionCsvNote() {
  return (
    <p className="text-muted text-xs leading-relaxed">
      The CSV is built by the page from extraction.json: {AI_EXTRACT_CSV_SHAPE}.{" "}
      {AI_EXTRACT_NULL_CSV_LEGEND}
    </p>
  );
}

/**
 * The buttons beside the ZIP, as flex items of the caller's row: Download CSV
 * and Download XLSX (when the data is a table), Copy as table (tab-separated,
 * for pasting into a spreadsheet) and Copy JSON (always, when extraction.json
 * was read). Every one carries ALL the rows, whatever the table draws.
 */
export function ExtractionActions({
  read,
  filename,
}: {
  read: ExtractionRead;
  filename: string;
}) {
  const { rows } = read;
  const csv = extractionCsv(read.data);
  return (
    <>
      {/* "Download CSV", not the file name: buttonVariants never wraps,
          so a long name would spill out of a phone-width card. */}
      {csv !== null && (
        <button
          type="button"
          data-download=""
          data-chunk={AI_RESULT_CHUNK}
          onClick={() =>
            downloadBlob(
              new Blob([csv], { type: "text/csv;charset=utf-8" }),
              extractionCsvName(filename),
            )
          }
          className={FILE_BUTTON}
        >
          <Download className="size-4" aria-hidden />
          Download CSV
        </button>
      )}
      {rows !== null && (
        <button
          type="button"
          data-download=""
          onClick={async () =>
            downloadBlob(
              new Blob([(await extractionXlsx(rows)) as BlobPart], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              }),
              extractionXlsxName(filename),
            )
          }
          className={FILE_BUTTON}
        >
          <Download className="size-4" aria-hidden />
          Download XLSX
        </button>
      )}
      {rows !== null && (
        <CopyTextButton
          text={toTsv(rows)}
          label="Copy as table"
          size="md"
          className="w-full sm:w-auto"
          failed="Your browser did not allow copying. Download CSV or XLSX for the same table."
        />
      )}
      <CopyTextButton
        text={extractionJson(read.data)}
        label="Copy JSON"
        size="md"
        className="w-full sm:w-auto"
        failed="Your browser did not allow copying. extraction.json in the ZIP holds the same data."
      />
    </>
  );
}

// ── Chat with PDF ───────────────────────────────────────────────────────

/** One exchange as the conversation copy and download carry it. */
export interface ConversationEntry {
  question: string;
  /** `null` when the package's answer could not be read. */
  answer: string | null;
  /** The answer package's file name, where an unreadable answer still is. */
  filename: string;
  /**
   * The counted page count of the PDF the answer is about, or `null` when the
   * page cannot prove which file that is: then no "Cited pages" line is
   * written (the answer's own `[p.N]` markers stay in its text either way).
   */
  pageCount: number | null;
}

function citedLine(entry: ConversationEntry): string | null {
  if (entry.answer === null || entry.pageCount === null) return null;
  const pages = citedPagesIn(entry.answer, entry.pageCount);
  return pages.length > 0
    ? `Cited pages: ${pages.map((p) => `[p.${p}]`).join(", ")}`
    : null;
}

function answerText(entry: ConversationEntry): string {
  return (
    entry.answer ??
    `This answer could not be read here. It is in ${entry.filename}.`
  );
}

/** The conversation as plain text, for "Copy conversation". */
export function conversationText(
  entries: readonly ConversationEntry[],
): string {
  return entries
    .map((entry) => {
      const cited = citedLine(entry);
      return [
        `Q: ${entry.question}`,
        "",
        `A: ${answerText(entry)}`,
        ...(cited ? [cited] : []),
      ].join("\n");
    })
    .join("\n\n");
}

/** The answer package's stem: `invoice-answer.zip` is `invoice`. */
function conversationStem(entries: readonly ConversationEntry[]): string {
  const zip = entries[0]?.filename ?? "";
  return zip.replace(/\.zip$/i, "").replace(/-answer$/i, "") || "chat";
}

/** `invoice-answer.zip` (the first answer's package) becomes `invoice-conversation.md`. */
export function conversationFileName(
  entries: readonly ConversationEntry[],
): string {
  return `${conversationStem(entries)}-conversation.md`;
}

/** The conversation as Markdown, for "Download conversation (.md)". */
export function conversationMarkdown(
  entries: readonly ConversationEntry[],
): string {
  const parts = [`# Chat with PDF: ${conversationStem(entries)}`];
  entries.forEach((entry, i) => {
    const cited = citedLine(entry);
    parts.push(
      `## Question ${i + 1}`,
      entry.question,
      "**Answer**",
      answerText(entry),
      ...(cited ? [cited] : []),
    );
  });
  return `${parts.join("\n\n")}\n`;
}

/**
 * Copy conversation and Download conversation (.md), built from the
 * transcript in the page: no request is made.
 */
export function ConversationActions({
  entries,
}: {
  entries: readonly ConversationEntry[];
}) {
  return (
    <div
      data-chunk={AI_RESULT_CHUNK}
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start"
    >
      <CopyTextButton
        text={conversationText(entries)}
        label="Copy conversation"
        size="md"
        className="w-full sm:w-auto"
        failed="Your browser did not allow copying. Download the conversation instead."
      />
      <button
        type="button"
        data-download=""
        onClick={() =>
          downloadBlob(
            new Blob([conversationMarkdown(entries)], {
              type: "text/markdown;charset=utf-8",
            }),
            conversationFileName(entries),
          )
        }
        className={FILE_BUTTON}
      >
        <Download className="size-4" aria-hidden />
        Download conversation (.md)
      </button>
    </div>
  );
}
