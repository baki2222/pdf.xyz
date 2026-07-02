import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { toolCount } from "@/lib/tools";

const faqs = [
  {
    q: "Are my files uploaded to a server?",
    a: `For most tools, no. Merge, split, compress, rotate, image conversions and more run entirely in your browser, so your files never leave your device. A handful of heavy or AI-powered tools use encrypted, auto-deleting workers — and each tool clearly labels where it runs.`,
  },
  {
    q: "Do I need to create an account?",
    a: "No. You can open any tool and start working immediately. An account is only needed if you want to save workspaces, presets, or use signature requests.",
  },
  {
    q: "How much does it cost?",
    a: `Every core tool is free. Pro unlocks the full AI suite, batch processing, saved workflows, and higher limits. See pricing above for details.`,
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

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-24 py-20 sm:py-28">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="FAQ"
          title="Questions, answered"
          description="Everything you might want to know before dropping in your first file."
        />

        <div className="mx-auto grid w-full max-w-4xl gap-3 md:grid-cols-2">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group rounded-2xl border border-white/10 bg-surface-2 p-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-white">
                {faq.q}
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/15 text-slate-400 transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
