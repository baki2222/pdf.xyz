import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tiers = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    tagline: "Everything you need for everyday PDFs.",
    features: [
      `All ${toolCount} tools, no paywalls on the basics`,
      "In-browser processing — unlimited local tasks",
      "Files up to 100 MB each",
      "No account required",
    ],
    cta: { label: "Start for free", href: "/workspace" },
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$8",
    cadence: "per month",
    tagline: "For heavy documents, AI, and saved workflows.",
    features: [
      "Everything in Free",
      "Batch processing & saved workflow presets",
      "Higher limits and priority secure workers",
      "Full AI suite — chat, summarize, translate, extract",
      "Signature requests & audit trails",
    ],
    cta: { label: "Upgrade to Pro", href: "/workspace" },
    highlighted: true,
  },
  {
    name: "Team",
    price: "Custom",
    cadence: "contact us",
    tagline: "SSO, shared workspaces, and admin controls.",
    features: [
      "Everything in Pro",
      "Shared team workspaces & templates",
      "SSO / SAML and role-based access",
      "Data residency & compliance support",
    ],
    cta: { label: "Talk to us", href: "/#contact" },
    highlighted: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24 py-20 sm:py-28">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Pricing"
          title="Start free. Upgrade when you scale."
          description="Every core tool is free and runs in your browser. Pay only when you need AI, big batches, or team features."
        />

        <div className="grid gap-5 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative flex flex-col gap-6 rounded-3xl border p-7",
                tier.highlighted
                  ? "border-violet-400/40 bg-gradient-to-b from-violet-500/10 to-transparent shadow-xl shadow-violet-500/10"
                  : "border-white/10 bg-surface-2",
              )}
            >
              {tier.highlighted && (
                <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold text-white">{tier.name}</h3>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight text-white">
                    {tier.price}
                  </span>
                  <span className="text-sm text-slate-500">{tier.cadence}</span>
                </p>
                <p className="text-sm text-slate-400">{tier.tagline}</p>
              </div>

              <ul className="flex flex-1 flex-col gap-3">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm text-slate-300"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-emerald-400"
                      aria-hidden
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={tier.cta.href}
                className={buttonVariants({
                  variant: tier.highlighted ? "primary" : "outline",
                  size: "md",
                  className: "w-full",
                })}
              >
                {tier.cta.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
