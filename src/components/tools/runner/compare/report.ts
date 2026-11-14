import { fileWithoutText, type PdfCompareResult } from "@/lib/pdf/compare-pdf";
import { CONTEXT, hunkHeader } from "@/lib/pdf/compare/hunks";
import type { CompareOptions } from "@/lib/pdf/compare/lines";
import type { WordToken } from "@/lib/pdf/compare/words";

/**
 * The downloadable report: the header (both files, page counts, sizes, what
 * was compared and what was set aside), then only the changes — each hunk
 * headed with the page it sits on in each file, `@@ Page 2 -> page 3 @@`,
 * with up to {@link CONTEXT} unchanged lines around it.
 *
 * Lines keep the old prefixes, verbatim text: two spaces for context, `- ` for
 * a line only in the first PDF, `+ ` for one only in the second. A paired
 * line whose words were marked gets one more line, `~ `, with the removed
 * words as `[-…-]` and the added ones as `{+…+}`, so a tool that reads the
 * `+`/`-` lines is not handed rewritten text.
 *
 * Until 2026-11-14 the report printed EVERY line of both documents under
 * `Diff:`; it is in this walked copy root now, out of `compare-pdf.ts`.
 */

/** "ignore case, ignore page headers and numbers", or null for none. */
export function optionsPhrase(options: CompareOptions): string | null {
  const parts = [
    options.ignoreCase ? "ignore case" : null,
    options.ignoreFurniture ? "ignore page headers and numbers" : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** A word-marked pair as one line: same text, `[-removed-]`, `{+added+}`. */
export function markedLine(tokens: readonly WordToken[]): string {
  return tokens
    .map((t) =>
      t.k === "same"
        ? t.text
        : t.k === "removed"
          ? `[-${t.text}-]`
          : `{+${t.text}+}`,
    )
    .join("");
}

function pageList(pages: readonly number[]): string {
  return pages.length > 0 ? pages.join(", ") : "none";
}

export function buildReport(result: Omit<PdfCompareResult, "report">): string {
  const scanned = fileWithoutText(result);
  const compared = result.hasComparableText;
  const options = optionsPhrase(result.options);
  const lines = [
    `PDF comparison: ${result.leftName} vs ${result.rightName}`,
    "",
    `Scope: selectable text, page count, and file size only. This is not OCR and not a pixel-perfect visual diff. Only changes are listed, with ${CONTEXT} lines of context and the page they sit on in each file.`,
    "",
    `Pages: ${result.leftPageCount} vs ${result.rightPageCount} (${result.pageDelta >= 0 ? "+" : ""}${result.pageDelta})`,
    `Bytes: ${result.leftSize} vs ${result.rightSize} (${result.sizeDelta >= 0 ? "+" : ""}${result.sizeDelta})`,
    `Comparable text: ${
      compared
        ? "yes"
        : scanned
          ? `no (${scanned} has no selectable text)`
          : "no (neither PDF has selectable text)"
    }`,
    // Without text on both sides there is no evidence either way, so neither
    // "yes" nor "no" is a claim this report can make. Under an option, "yes"
    // is only true of what was compared, so it says so.
    `Selectable text identical: ${
      compared
        ? result.identicalText
          ? options
            ? `yes (with ${options})`
            : "yes"
          : "no"
        : "not compared"
    }`,
    compared
      ? `Changed lines: ${result.summary.changedLines} (${result.summary.addedLines} added, ${result.summary.removedLines} removed)`
      : "Changed lines: not compared",
    !options
      ? "Options: none"
      : result.options.ignoreFurniture
        ? `Options: ${options} (${result.dropped.left} lines dropped from the first PDF, ${result.dropped.right} from the second)`
        : `Options: ${options}`,
  ];
  const { left, right } = result.pagesWithoutText;
  if (compared && (left.length > 0 || right.length > 0)) {
    lines.push(
      `Pages without selectable text: first PDF ${pageList(left)}; second PDF ${pageList(right)}`,
    );
  }
  if (result.wordFallbacks > 0) {
    lines.push(
      `Word marks skipped for ${result.wordFallbacks} long ${result.wordFallbacks === 1 ? "line" : "lines"}`,
    );
  }
  lines.push("", "Changes:");

  if (scanned) {
    lines.push(
      `${scanned} has no selectable text, so there is nothing to compare the other file's text against. It is probably a scanned or image-only PDF: run OCR PDF on it first, then compare again.`,
    );
  } else if (!compared) {
    lines.push(
      "No selectable text was found in either PDF. Use OCR first for scanned/image-only PDFs.",
    );
  } else if (result.hunks.length === 0 || result.identicalText) {
    lines.push("No selectable-text differences found.");
  } else {
    const leftText = new Map<number, string>();
    const rightText = new Map<number, string>();
    for (const line of result.diff) {
      if (line.left !== undefined) leftText.set(line.left, line.text);
      if (line.right !== undefined) rightText.set(line.right, line.text);
    }
    result.hunks.forEach((hunk, n) => {
      if (n > 0) lines.push("");
      lines.push(`@@ ${hunkHeader(hunk, "->")} @@`);
      const marks = new Map(
        hunk.pairs.flatMap((p) => (p.tokens ? [[p.right, p.tokens]] : [])) as [
          number,
          WordToken[],
        ][],
      );
      for (const op of hunk.ops) {
        if (op.k === "same") lines.push(`  ${leftText.get(op.a)}`);
        else if (op.k === "removed") lines.push(`- ${leftText.get(op.a)}`);
        else {
          lines.push(`+ ${rightText.get(op.b)}`);
          const tokens = marks.get(op.b);
          if (tokens) lines.push(`~ ${markedLine(tokens)}`);
        }
      }
    });
  }
  return lines.join("\n");
}
