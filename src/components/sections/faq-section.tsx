import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { faqs } from "@/lib/faq";

/**
 * A numbered, ruled register beside the heading — the same index voice as
 * the workflow steps and the catalogue, so the accordion stops being the
 * one generic block on the page. The numerals are decoration (aria-hidden);
 * the questions and answers carry the words, unchanged.
 */
export function FaqSection() {
  return (
    <section
      id="faq"
      className="border-line scroll-mt-24 border-b py-20 sm:py-24"
    >
      <Container className="grid gap-12 lg:grid-cols-12">
        <SectionHeading
          className="lg:col-span-4"
          eyebrow="FAQ"
          title="Questions, answered"
          description="Everything you might want to know before dropping in your first file."
        />

        <div className="border-line flex flex-col self-start border-t lg:col-span-8">
          {faqs.map((faq, i) => (
            <details
              key={faq.q}
              className="faq-item group border-line hover:bg-wash border-b transition-colors [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="grid cursor-pointer grid-cols-[2.5rem_1fr_auto] items-baseline gap-3 px-1 py-5">
                <span className="text-accent font-mono text-xs" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-fg text-[15px] font-medium">{faq.q}</span>
                <span
                  className="text-faint shrink-0 self-center font-mono text-lg leading-none transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="text-muted max-w-2xl px-1 pb-5 pl-[3.25rem] text-sm leading-relaxed">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
