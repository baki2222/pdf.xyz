/**
 * The ticket's one line about all its files together: "2 PDFs · 15 pages ·
 * 2.0 MB". Its counts are rendered by the evidence module, so the ticket and
 * a suggestion row spell "2 PDFs" and "15 pages" the same way.
 */
import { formatBytes } from "@/lib/utils";
import { renderEvidence } from "./evidence";
import type { FileFacts } from "./facts";
import { MEASURING, pagesOf, type FactWord } from "./fact-words";

/**
 * The ticket's line about all its files: "2 PDFs · 15 pages · 2.0 MB".
 *
 * The count names the kind when every file is one kind; the pages are said
 * only when every file is a PDF and every one was counted — a total over
 * some of them would read as a total over all.
 *
 * GROWS ONLY AT ITS END, so nothing on the line moves as facts land (a word
 * that slides sideways is a layout shift inside the desk, which
 * `e2e/layout-stability.spec.ts` holds at zero): before any file is read the
 * line is one "measuring…"; while a PDF is being read it is the count and
 * "measuring…"; once all are read, the pages take that place and the size
 * follows.
 */
export function ticketSummary(
  files: readonly { readonly size: number; readonly facts: FileFacts | null }[],
): FactWord[] {
  if (files.length === 0) return [];
  const pendingWord: FactWord = {
    text: MEASURING,
    tone: "faint",
    pending: true,
  };
  if (files.some((f) => !f.facts)) return [pendingWord];
  const formats = new Set(files.map((f) => f.facts?.format ?? null));
  const only = formats.size === 1 ? [...formats][0]! : null;
  const n = files.length;
  const words: FactWord[] = [];
  if (only === "PDF")
    words.push({
      text: renderEvidence({
        kind: "count",
        count: n,
        noun: "pdf",
        format: "PDF",
      }),
      tone: "muted",
    });
  else if (only === "JPG" || only === "PNG")
    words.push({
      text: renderEvidence({
        kind: "count",
        count: n,
        noun: "image",
        format: null,
      }),
      tone: "muted",
    });
  else
    words.push({
      text: renderEvidence({
        kind: "count",
        count: n,
        noun: "file",
        format: only,
      }),
      tone: "muted",
    });

  if (only === "PDF") {
    const pending = files.some(
      (f) => !f.facts || f.facts.pdf?.state === "pending",
    );
    const pages = files.map((f) => pagesOf(f.facts));
    if (pending) return [...words, pendingWord];
    if (pages.every((p): p is number => p !== null))
      words.push({
        text: renderEvidence({
          kind: "pages",
          pages: pages.reduce((a, b) => a + b, 0),
        }),
        tone: "muted",
      });
  }
  words.push({
    text: formatBytes(files.reduce((sum, f) => sum + f.size, 0)),
    tone: "muted",
  });
  return words;
}
