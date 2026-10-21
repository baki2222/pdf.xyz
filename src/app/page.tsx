import type { Metadata } from "next";
import { Hero } from "@/components/sections/hero";
import { ToolGrid } from "@/components/sections/tool-grid";
import { HowAndWhy } from "@/components/sections/how-and-why";
import { FaqSection } from "@/components/sections/faq-section";
import { GuidesSection } from "@/components/sections/guides-section";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import {
  faqPageSchema,
  organizationSchema,
  webApplicationSchema,
  websiteSchema,
} from "@/lib/structured-data";
import { faqs } from "@/lib/faq";

export const metadata: Metadata = buildMetadata({ path: "/" });

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={[
          organizationSchema(),
          websiteSchema(),
          webApplicationSchema(),
          faqPageSchema(faqs),
        ]}
      />
      {/* The paper scope is applied once, on <body> in the root layout, and
          `:root` shares its tokens, so this page, the header and the footer
          resolve one palette in either colour scheme. This wrapper only sets
          the page's ground and ink.

          The order is a first-time visitor's (owner's brief, 2026-10-21):
          what this is and one button; every tool as a card; how it works;
          why; questions; guides. WAS eleven sections, among them a stats
          band, the workflow narrative, an AI pitch, a privacy grid, a pricing
          panel, About, and an ink closing band — merged into "Why pdf.xyz",
          the FAQ, and the cards' own badges. */}
      <div className="bg-canvas text-fg">
        <Hero />
        <ToolGrid />
        <HowAndWhy />
        <FaqSection />
        <GuidesSection />
      </div>
    </>
  );
}
