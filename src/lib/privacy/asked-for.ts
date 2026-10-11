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
 * line here is red there — for every type shape the options use, since that
 * walk fails closed (review, 2026-10-10: it used to skip `string | null`,
 * `readonly string[]` and `Array<string>` without a word). Tool names come
 * from the catalogue, never retyped.
 *
 * WHAT THE QUEUE DOES WITH IT IS SAID ONCE, by the page's lead paragraph
 * (`TYPED_INPUT_QUEUE_LIFETIME`, `./job-queue`). Until review each entry
 * ended with the same sentence — five times, word for word, in one list —
 * and the password, the most sensitive input, was the only one given no
 * window. Each entry now says only what differs, after its tools in bold.
 *
 * Copy: walked by `copyFiles()` (`src/lib/privacy`).
 */
import { MAX_REQUEST_SIGNERS } from "@/lib/jobs/request-signatures";
import { getToolBySlug } from "@/lib/tools";
import { AI_PROVIDER } from "./processors";

function nameOf(slug: string): string {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`asked-for: no tool "${slug}" in the catalogue`);
  return tool.name;
}

export interface AskedFor {
  /** The tools, by catalogue name. */
  readonly tools: readonly string[];
  /** The tools as the item's bold lead: "Protect PDF and Unlock PDF". */
  readonly lead: string;
  /** What they ask for, and what becomes of it — the sentence after the lead. */
  readonly text: string;
}

function entry(slugs: readonly string[], text: string): AskedFor {
  const tools = slugs.map(nameOf);
  return { tools, lead: tools.join(" and "), text };
}

export const ASKED_FOR: readonly AskedFor[] = [
  entry(
    ["request-signatures"],
    `asks for the name and email address of each signer — up to ${MAX_REQUEST_SIGNERS} — and, if you add them, a title, a message for the signers and a label for each field. They are written into the package you download (its manifest), so they last as long as the result does. The tool sends no email to anyone.`,
  ),
  entry(
    ["protect-pdf", "unlock-pdf"],
    "ask for a password. What happens to it is set out under “One case worth naming” above.",
  ),
  entry(
    ["webpage-to-pdf"],
    "asks for the web address of the page you want. Our processing server fetches that page itself, so the site sees a request from our server, not from you. The result's file name is made from the address, so the address also appears in that name, which the job record keeps.",
  ),
  entry(
    ["chat-with-pdf"],
    `takes your question and, for a follow-up, the conversation so far. Both are sent to ${AI_PROVIDER.name} with the document's text on every question, and the question is written into the answer you download, so it lasts as long as the result does.`,
  ),
  entry(
    ["ai-extract"],
    `takes the instructions, or the names and descriptions of the fields, that you write. They are sent to ${AI_PROVIDER.name} with the document's text, and written into the result you download, so they last as long as it does.`,
  ),
  entry(
    ["summarize-pdf"],
    `takes an optional focus you type. It is sent to ${AI_PROVIDER.name} with the document's text, and written into the result you download, so it lasts as long as the result does.`,
  ),
  entry(
    ["translate-pdf"],
    `takes optional instructions you type. They are sent to ${AI_PROVIDER.name} with the document's text, and written into the result you download, so they last as long as it does.`,
  ),
];
