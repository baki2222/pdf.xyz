/**
 * What this tab found in a file, in the short words a file row shows beside
 * its size.
 *
 * Measured facts only: a PDF still being read says "measuring…", one past
 * the probe limit says it was not checked rather than implying it was, and a
 * lock is named in the words true of its kind (most locked PDFs open in any
 * viewer and only restrict editing, so only one that needs a password is
 * said to have one).
 *
 * ONE definition for every surface that lists staged files — the workspace's
 * rows and the ticket's — so the two cannot describe the same file two ways.
 * It moved here from `workspace-client.tsx` (2026-10-10, WP-05) when the
 * ticket became the second reader. Every number printed is a field of the
 * facts it renders. Kept free of the evidence module: the workspace loads
 * this with its page, and `ticket-summary.ts` is the ticket's alone.
 */
import { imageOnlyRange } from "@/lib/pdf/probe-result";
import type { FileFacts } from "./facts";

export type FactTone = "faint" | "muted" | "warn";

export interface FactWord {
  readonly text: string;
  readonly tone: FactTone;
  /** Still being measured: drawn as a placeholder, never as a finding. */
  readonly pending?: boolean;
}

/** The words for "being measured" — one spelling everywhere. */
export const MEASURING = "measuring…";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What was found in one file, besides its size and pages. */
export function factWords(facts: FileFacts | null): FactWord[] {
  if (!facts) return [];
  if (facts.contradicted) {
    return [
      {
        text: facts.bytes
          ? `really ${facts.bytes === "PDF" ? "a PDF" : facts.bytes}`
          : "not what its name says",
        tone: "warn",
      },
    ];
  }
  const pdf = facts.pdf;
  if (!pdf) return [];
  if (pdf.state === "pending")
    return [{ text: MEASURING, tone: "faint", pending: true }];
  if (pdf.state === "not-checked")
    return [{ text: "not checked", tone: "faint" }];
  const { probe } = pdf;
  if (probe.read === "unreadable")
    return [{ text: "couldn't be read here", tone: "warn" }];
  const words: FactWord[] = [];
  if (probe.lock === "password-required")
    words.push({ text: "needs a password", tone: "warn" });
  else if (probe.lock === "restricted")
    words.push({ text: "editing restricted", tone: "warn" });
  else if (probe.lock === "unknown")
    words.push({ text: "encrypted", tone: "warn" });
  if ((probe.formFields ?? 0) > 0)
    words.push({
      text: plural(probe.formFields!, "form field"),
      tone: "muted",
    });
  if (imageOnlyRange(probe))
    words.push({ text: "no selectable text", tone: "muted" });
  return words;
}

/** A PDF's page count, once the probe has it. */
export function pagesOf(facts: FileFacts | null): number | null {
  return facts?.pdf?.state === "checked" ? facts.pdf.probe.pages : null;
}
