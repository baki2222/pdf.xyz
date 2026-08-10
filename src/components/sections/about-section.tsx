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
    <section id="about" className="scroll-mt-24 py-20 sm:py-28">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="About"
          title="Built so the privacy promise is checkable"
          description="pdf.xyz is a complete PDF toolkit that treats where your file goes as a product decision, not a policy page."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="bg-surface-2 flex flex-col gap-3 rounded-2xl border border-white/10 p-6">
            <span className="grid size-11 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <ShieldCheck className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <h3 className="text-base font-semibold text-white">
              Honest about where files go
            </h3>
            <p className="text-sm leading-relaxed text-slate-400">
              Every tool says up front whether it runs on your device or on a
              secure worker — on its card, on its page, and in its link preview.
              Nothing is processed somewhere you were not told about.
            </p>
          </div>

          <div className="bg-surface-2 flex flex-col gap-3 rounded-2xl border border-white/10 p-6">
            <span className="grid size-11 place-items-center rounded-xl border border-indigo-400/20 bg-indigo-400/10 text-indigo-300">
              <Wrench className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <h3 className="text-base font-semibold text-white">
              {toolCount} tools, no upsell maze
            </h3>
            <p className="text-sm leading-relaxed text-slate-400">
              Merge, convert, sign, redact, OCR and more, in one place, with no
              sign-up to start and no watermark on the way out.
            </p>
          </div>

          <div className="bg-surface-2 flex flex-col gap-3 rounded-2xl border border-white/10 p-6">
            <span className="grid size-11 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
              <Mail className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <h3 className="text-base font-semibold text-white">
              A real address, not a form
            </h3>
            <p className="text-sm leading-relaxed text-slate-400">
              Security questions, enterprise requirements, bug reports, or a
              tool you wish existed — all go to one inbox that a person reads.
            </p>
          </div>
        </div>

        <div
          id="contact"
          className="bg-surface-2 scroll-mt-24 rounded-2xl border border-white/10 p-8 text-center sm:p-10"
        >
          <h3 className="text-xl font-semibold text-white sm:text-2xl">
            Talk to us
          </h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            Evaluating pdf.xyz for a team, reviewing how we handle documents, or
            stuck on something? Write to us and say what you need.
          </p>
          <a
            href={mailto}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <Mail className="size-4" aria-hidden />
            {siteConfig.contactEmail}
          </a>
        </div>
      </Container>
    </section>
  );
}
