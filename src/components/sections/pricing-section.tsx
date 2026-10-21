import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
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

/**
 * The examples and the count, both from the never-upload group.
 *
 * WAS a hand-written "Merge, split, compress, rotate, convert and more", and
 * the third verb was false: `compress-pdf` is the browser-first tool, so the
 * one tool that CAN upload was named by hand inside the sentence "your files
 * never leave it". Found by reading the built HTML, not the source — the
 * counts on this page were being fixed at the time and this sentence carries
 * no number, so no census could see it.
 *
 * Filtering `featured` out of `neverUploads` means the examples can only ever
 * be tools the promise is true of: while Compress PDF is browser-first it
 * cannot appear here however it is badged.
 */
const local = processingSplit().neverUploads;
const localExamples = local.filter((tool) => tool.featured).map((t) => t.name);

const groups = [
  {
    name: "In your browser",
    summary: `${localExamples.join(", ")} and ${local.length - localExamples.length} more run entirely on your device — your files never leave it.`,
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
    <section
      id="pricing"
      className="border-line scroll-mt-24 border-b py-20 sm:py-24"
    >
      <Container className="flex flex-col gap-12">
        <SectionHeading
          eyebrow="Pricing"
          title="Free right now. All of it."
          description={`Every one of the ${toolCount} tools is free to use today — no account, no card, no trial clock. Here is exactly how that works and what will change.`}
        />

        <div className="border-line divide-line bg-panel rounded-panel grid divide-y border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {groups.map((group) => (
            <div key={group.name} className="flex flex-col gap-5 p-7 sm:p-8">
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-fg text-2xl font-medium tracking-tight">
                  {group.name}
                </h3>
                <p className="text-muted text-sm leading-relaxed">
                  {group.summary}
                </p>
              </div>

              <ul className="flex flex-1 flex-col gap-3">
                {group.points.map((point) => (
                  <li
                    key={point}
                    className="text-fg flex items-start gap-2.5 text-sm"
                  >
                    <Check
                      className="text-accent mt-0.5 size-4 shrink-0"
                      strokeWidth={2}
                      aria-hidden
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-line bg-wash rounded-panel flex flex-col items-start gap-4 border p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <p className="text-muted max-w-2xl text-sm leading-relaxed">
            When paid options arrive they will cover the server-side work above
            — and the in-browser tools stay free. Until then, there is simply
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
