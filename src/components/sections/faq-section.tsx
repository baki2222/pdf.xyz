import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { faqs } from "@/lib/faq";

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
              className="group bg-surface-2 rounded-2xl border border-white/10 p-5 [&_summary::-webkit-details-marker]:hidden"
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
