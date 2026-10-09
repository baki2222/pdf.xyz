import type { Metadata } from "next";
import { Hero } from "@/components/sections/hero";
import { StatsBand } from "@/components/sections/stats-band";
import { ToolShowcase } from "@/components/sections/tool-showcase";
import { WorkflowSection } from "@/components/sections/workflow-section";
import { AiSection } from "@/components/sections/ai-section";
import { SecuritySection } from "@/components/sections/security-section";
import { PricingSection } from "@/components/sections/pricing-section";
import { FaqSection } from "@/components/sections/faq-section";
import { GuidesSection } from "@/components/sections/guides-section";
import { AboutSection } from "@/components/sections/about-section";
import { CtaSection } from "@/components/sections/cta-section";
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
          the page's ground and ink; the closing band inverts locally with
          `.theme-ink`. */}
      <div className="bg-canvas text-fg">
        <Hero />
        <StatsBand />
        <ToolShowcase />
        <WorkflowSection />
        <AiSection />
        <SecuritySection />
        <PricingSection />
        <FaqSection />
        <GuidesSection />
        <AboutSection />
        <CtaSection />
      </div>
    </>
  );
}
