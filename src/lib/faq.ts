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
    a: "For most tools, no. Merge, split, compress, rotate, image conversions and more run entirely in your browser, so your files never leave your device. A handful of heavy or AI-powered tools use encrypted, auto-deleting workers — and each tool clearly labels where it runs.",
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
    a: "Never. AI tools run on secure infrastructure and your document content is never used to train any model.",
  },
  {
    q: "What happens to files sent to a worker?",
    a: "They are encrypted in transit, processed on an isolated worker, and permanently deleted within minutes of your job completing. Nothing is retained.",
  },
];
