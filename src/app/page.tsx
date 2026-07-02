import type { Metadata } from "next";
import { Hero } from "@/components/sections/hero";
import { StatsBand } from "@/components/sections/stats-band";
import { ToolShowcase } from "@/components/sections/tool-showcase";
import { WorkflowSection } from "@/components/sections/workflow-section";
import { AiSection } from "@/components/sections/ai-section";
import { SecuritySection } from "@/components/sections/security-section";
import { PricingSection } from "@/components/sections/pricing-section";
import { FaqSection } from "@/components/sections/faq-section";
import { CtaSection } from "@/components/sections/cta-section";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({ path: "/" });

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatsBand />
      <ToolShowcase />
      <WorkflowSection />
      <AiSection />
      <SecuritySection />
      <PricingSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
