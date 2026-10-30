import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { RETENTION_WINDOWS } from "@/lib/retention-windows";
import { toolCount } from "@/lib/tools";

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Homepage FAQ. Single source of truth so the visible <FaqSection> and the
 * FAQPage JSON-LD never drift apart.
 */
export const faqs: FaqItem[] = [
  {
    q: "Are my files uploaded to a server?",
    // Compress is browser-first: its worker step uploads only when chosen,
    // so it is named apart rather than listed with the tools that never
    // upload. And the tools that DO upload are not "a handful" — they are
    // most of the rest — so they are named by kind, not by a quantifier
    // (unbacked-claims.test.ts).
    a: "For most tools, no. Merge, split, rotate, image conversions and more run entirely in your browser, so your files never leave your device. Compress does too unless you choose its secure-server option. The rest — Office conversions, OCR, PDF/A, password protection and the AI tools among them — use auto-deleting servers, and each tool clearly labels where it runs.",
  },
  {
    q: "Do I need to create an account?",
    a: "No. There is nothing to sign up for — open any tool and start working immediately.",
  },
  {
    q: "How much does it cost?",
    a: "Nothing right now — every tool is free, with no account and no card. Paid options will come later for the parts that genuinely cost money to run, like AI and large server-side jobs. The in-browser tools stay free.",
  },
  {
    q: "What file types are supported?",
    a: `pdf.xyz spans ${toolCount} tools covering PDF, Word, Excel, PowerPoint, images (JPG/PNG), HTML, Markdown, and more — both to and from PDF.`,
  },
  {
    q: "Is my content used to train AI models?",
    // Said the way `processing.ts` says it: the model runs at a third-party
    // provider, not on pdf.xyz's servers ("AI tools run on secure
    // infrastructure" placed it on ours).
    a: "No. The AI tools send your PDF's selectable text — not the file — to a third-party AI provider, under terms that prohibit training on it. pdf.xyz trains no models of its own.",
  },
  {
    q: "What happens to files sent to a server?",
    // Derived, not hand-written, for the same reason as /privacy: the FAQ said
    // "permanently deleted within minutes … nothing is retained", which was
    // three separate untruths the privacy page already corrects — the link
    // dying and the bytes dying are different events, and a job record (the
    // file's name, never its contents) is kept for the queue's key TTL.
    a: `They're encrypted in transit and processed on an isolated server. The input is wiped as soon as the job finishes; the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and the stored copy is erased by a daily storage rule after that. A job record — the file's name, never its contents — is kept for about ${RETENTION_WINDOWS.jobRecord}.`,
  },
];
