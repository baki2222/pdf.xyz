import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buttonVariants } from "@/components/ui/button";

/**
 * The pricing section answers the one question a visitor actually has here —
 * "will you charge me?" — with what is true today: everything is free, there
 * is nothing to buy, and nothing to sign up for.
 *
 * It deliberately carries NO price, NO named future tier, and NO upgrade CTA.
 * An earlier version rendered a three-tier price list (a monthly price, an
 * "Upgrade" button, an enterprise tier with single-sign-on claims) for a
 * product with no billing system, no accounts, and no way to pay — a promise
 * about a plan is still a promise. `src/lib/tools/pricing-honesty.test.ts`
 * fails the build if sell-language for a purchasable product returns while the
 * repository still cannot take a payment. The `id="pricing"` anchor is load-
 * bearing: the nav and footer link to `/#pricing` (src/lib/site.ts).
 */

const groups = [
  {
    name: "In your browser",
    summary:
      "Merge, split, compress, rotate, convert and more run entirely on your device — your files never leave it.",
    points: [
      "No account and no card, ever",
      "Unlimited local tasks",
      "These tools stay free",
    ],
  },
  {
    name: "On our servers",
    summary:
      "The AI tools and heavy jobs run on secure, auto-deleting workers, because a browser alone cannot do them.",
    points: [
      "Free to use right now",
      "Paid options will come for these — they genuinely cost money to run",
      "No date promised until there is one",
    ],
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24 py-20 sm:py-28">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow="Pricing"
          title="Free right now. All of it."
          description={`Every one of the ${toolCount} tools is free to use today — no account, no card, no trial clock. Here is exactly how that works and what will change.`}
        />

        <div className="grid gap-5 lg:grid-cols-2">
          {groups.map((group) => (
            <div
              key={group.name}
              className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-surface-2 p-7"
            >
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold text-white">{group.name}</h3>
                <p className="text-sm text-slate-300">{group.summary}</p>
              </div>

              <ul className="flex flex-1 flex-col gap-3">
                {group.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2.5 text-sm text-slate-300"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-emerald-400"
                      aria-hidden
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-start gap-4 rounded-3xl border border-white/10 bg-surface-2 p-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed text-slate-300">
            When paid options arrive they will cover the server-side work above —
            and the in-browser tools stay free. Until then, there is simply
            nothing to pay for.
          </p>
          <Link
            href="/workspace"
            className={buttonVariants({
              variant: "outline",
              size: "md",
              className: "shrink-0",
            })}
          >
            Open the workspace
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
}
