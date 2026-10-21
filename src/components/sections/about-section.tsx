import { Mail, ShieldCheck, Wrench } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteConfig } from "@/lib/site";
import { toolCount } from "@/lib/tools";

/**
 * About + contact.
 *
 * Both were linked from the footer long before either existed, and the Team
 * plan's "Talk to us" pointed at `#contact` too — so the one call-to-action
 * aimed at the largest customers scrolled nowhere. A visitor deciding whether
 * to hand over a document looks for exactly these two things, and finding
 * neither is a worse signal than a plain answer.
 */
export function AboutSection() {
  const mailto = `mailto:${siteConfig.contactEmail}`;

  return (
    <section id="about" className="scroll-mt-24 py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeading
          eyebrow="About"
          title="Built so the privacy promise is checkable"
          description="pdf.xyz is a complete PDF toolkit that treats where your file goes as a product decision, not a policy page."
        />

        <div className="grid gap-x-10 lg:grid-cols-3">
          <div className="border-line flex flex-col gap-2.5 border-t py-6">
            <ShieldCheck
              className="text-fg size-5"
              strokeWidth={1.5}
              aria-hidden
            />
            <h3 className="text-fg text-base font-medium">
              Honest about where files go
            </h3>
            <p className="text-muted text-sm leading-relaxed">
              Every tool says up front whether it runs on your device or on a
              secure worker — on its card, on its page, and in its link preview.
              Nothing is processed somewhere you were not told about.
            </p>
          </div>

          <div className="border-line flex flex-col gap-2.5 border-t py-6">
            <Wrench className="text-fg size-5" strokeWidth={1.5} aria-hidden />
            <h3 className="text-fg text-base font-medium">
              {toolCount} tools, no upsell maze
            </h3>
            <p className="text-muted text-sm leading-relaxed">
              Merge, convert, sign, redact, OCR and more, in one place, with no
              sign-up to start and no watermark on the way out.
            </p>
          </div>

          <div className="border-line flex flex-col gap-2.5 border-t py-6">
            <Mail className="text-fg size-5" strokeWidth={1.5} aria-hidden />
            <h3 className="text-fg text-base font-medium">
              A real address, not a form
            </h3>
            <p className="text-muted text-sm leading-relaxed">
              Security questions, enterprise requirements, bug reports, or a
              tool you wish existed — all go to one inbox that a person reads.
            </p>
          </div>
        </div>

        <div
          id="contact"
          className="border-line bg-panel rounded-panel grid scroll-mt-24 gap-6 border p-7 sm:grid-cols-[1fr_auto] sm:items-center sm:p-9"
        >
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-fg text-2xl font-medium tracking-tight">
              Talk to us
            </h3>
            <p className="text-muted max-w-xl text-sm leading-relaxed">
              Evaluating pdf.xyz for a team, reviewing how we handle documents,
              or stuck on something? Write to us and say what you need.
            </p>
          </div>
          <a
            href={mailto}
            className="border-line-strong text-fg hover:bg-wash rounded-ctl inline-flex h-11 items-center gap-2 self-start border px-5 text-sm font-medium transition-colors sm:self-center"
          >
            <Mail className="size-4" strokeWidth={1.5} aria-hidden />
            {siteConfig.contactEmail}
          </a>
        </div>
      </Container>
    </section>
  );
}
