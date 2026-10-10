/**
 * What a tool asks you for besides the file, and what happens to it — the
 * list /privacy §2 renders under "What some tools ask you for".
 *
 * Until 2026-10-10 §4 said "We do not ask for a name, an email address, or a
 * password to use the tools", beside Request Signatures (up to ten signers'
 * names and email addresses, written into the package you download) and
 * Protect and Unlock (a password). Webpage to PDF's address — which our
 * server then fetches, so the site you name sees us, not you — was nowhere.
 *
 * The SUBJECTS are derived by `privacy-truth.test.tsx`: every free-text field
 * of every job-options interface a `parse…Options` function returns, by AST,
 * and every URL-input tool in the catalogue. A field added to a form without a
 * line here is red there. Tool names come from the catalogue, never retyped.
 *
 * Copy: walked by `copyFiles()` (`src/lib/privacy`).
 */
import { MAX_REQUEST_SIGNERS } from "@/lib/jobs/request-signatures";
import { getToolBySlug } from "@/lib/tools";
import { RETENTION_WINDOWS } from "@/lib/retention-windows";
import { AI_PROVIDER } from "./processors";

function nameOf(slug: string): string {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`asked-for: no tool "${slug}" in the catalogue`);
  return tool.name;
}

/** How long what you typed waits in our job queue. */
const inTheQueue = (pronoun: "it" | "them") =>
  `Our job queue keeps ${pronoun} only until the job ends — or, if no worker ever runs the job, until the queue's retention lapses after ${RETENTION_WINDOWS.jobRecord}.`;

export interface AskedFor {
  /** The tools, by catalogue name. */
  readonly tools: readonly string[];
  /** What they ask for, and what becomes of it. */
  readonly text: string;
}

export const ASKED_FOR: readonly AskedFor[] = [
  {
    tools: [nameOf("request-signatures")],
    text: `${nameOf("request-signatures")} asks for the name and email address of each signer — up to ${MAX_REQUEST_SIGNERS} — and, if you add them, a title, a message for the signers and a label for each field. They are written into the package you download (its manifest), so they last as long as the result does. ${inTheQueue("them")} The tool sends no email to anyone.`,
  },
  {
    tools: [nameOf("protect-pdf"), nameOf("unlock-pdf")],
    text: `${nameOf("protect-pdf")} and ${nameOf("unlock-pdf")} ask for a password. What happens to it is set out under “One case worth naming” above.`,
  },
  {
    tools: [nameOf("webpage-to-pdf")],
    text: `${nameOf("webpage-to-pdf")} asks for the web address of the page you want. Our processing server fetches that page itself, so the site sees a request from our server, not from you. ${inTheQueue("it")} The result's file name is made from the address, so the address also appears in that name, which the job record keeps.`,
  },
  {
    tools: [nameOf("chat-with-pdf")],
    text: `${nameOf("chat-with-pdf")} takes your question and, for a follow-up, the conversation so far. Both are sent to ${AI_PROVIDER.name} with the document's text on every question, and the question is written into the answer you download, so it lasts as long as the result does. ${inTheQueue("them")}`,
  },
  {
    tools: [nameOf("ai-extract")],
    text: `${nameOf("ai-extract")} takes the instructions, or the names and descriptions of the fields, that you write. They are sent to ${AI_PROVIDER.name} with the document's text, and written into the result you download, so they last as long as it does. ${inTheQueue("them")}`,
  },
  {
    tools: [nameOf("summarize-pdf")],
    text: `${nameOf("summarize-pdf")} takes an optional focus you type. It is sent to ${AI_PROVIDER.name} with the document's text, and written into the result you download, so it lasts as long as the result does. ${inTheQueue("it")}`,
  },
  {
    tools: [nameOf("translate-pdf")],
    text: `${nameOf("translate-pdf")} takes optional instructions you type. They are sent to ${AI_PROVIDER.name} with the document's text, and written into the result you download, so they last as long as it does. ${inTheQueue("them")}`,
  },
];
