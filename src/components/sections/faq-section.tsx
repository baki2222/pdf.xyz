import { Container } from "@/components/ui/container";
import { faqs } from "@/lib/faq";
import { siteConfig } from "@/lib/site";

/**
 * The FAQ: every question in `faqs` — the same list the page's FAQPage
 * JSON-LD is built from, so what a crawler is told is what a reader can
 * open — as plain disclosure rows. WAS a numbered register beside a large
 * heading, with mono numerals; the questions and answers are unchanged.
 *
 * The contact line closes it, and carries `#contact` (linked from the
 * footer); it was the About section's "Talk to us" panel until 2026-10-21.
 */
export function FaqSection() {
  return (
    <section
      id="faq"
      className="border-line scroll-mt-24 border-b py-10 sm:py-14"
    >
      <Container className="grid gap-8 lg:grid-cols-12">
        <h2 className="font-display text-fg text-display-2 font-medium text-balance lg:col-span-4">
          Questions, answered
        </h2>
        <div className="lg:col-span-8">
          <div className="border-line border-t">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="faq-item group border-line border-b [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="text-fg hover:text-accent flex cursor-pointer items-center justify-between gap-4 py-4 text-[15px] font-medium transition-colors">
                  {faq.q}
                  <span
                    aria-hidden
                    className="text-faint shrink-0 text-lg leading-none transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted max-w-2xl pb-4 text-sm leading-relaxed">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
          <p id="contact" className="text-muted mt-6 scroll-mt-24 text-sm">
            Another question? Write to{" "}
            <a
              href={`mailto:${siteConfig.contactEmail}`}
              className="text-accent font-medium underline-offset-4 hover:underline"
            >
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </div>
      </Container>
    </section>
  );
}
