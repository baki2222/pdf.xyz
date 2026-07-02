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
    a: "No. You can open any tool and start working immediately. An account is only needed if you want to save workspaces, presets, or use signature requests.",
  },
  {
    q: "How much does it cost?",
    a: "Every core tool is free. Pro unlocks the full AI suite, batch processing, saved workflows, and higher limits. See pricing above for details.",
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
