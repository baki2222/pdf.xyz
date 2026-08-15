import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { faqs } from "@/lib/faq";

/**
 * A single ruled list beside the heading — questions read top to bottom the
 * way people actually scan an FAQ, instead of a two-column wall of boxes.
 */
export function FaqSection() {
  return (
    <section
      id="faq"
      className="border-line scroll-mt-24 border-b py-20 sm:py-28"
    >
      <Container className="grid gap-12 lg:grid-cols-12">
        <SectionHeading
          className="lg:col-span-4"
          eyebrow="FAQ"
          title="Questions, answered"
          description="Everything you might want to know before dropping in your first file."
        />

        <div className="border-line flex flex-col self-start border-t lg:col-span-8">
          {faqs.map((faq) => (
            <details
              key={faq.q}
              className="group border-line border-b [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="text-fg flex cursor-pointer items-center justify-between gap-6 py-5 text-[15px] font-medium">
                {faq.q}
                <span
                  className="text-faint shrink-0 font-mono text-lg leading-none transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="text-muted max-w-2xl pb-5 text-sm leading-relaxed">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
