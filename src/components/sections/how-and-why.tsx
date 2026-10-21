import { Container } from "@/components/ui/container";
import { HowItWorks } from "./how-it-works";
import { WhySection } from "./why-section";

/**
 * "How it works" and "Why pdf.xyz", side by side from `lg` and one after the
 * other on a phone: two short answers in one band, so the page stays short
 * (owner's brief, 2026-10-21: under about 5,000px at 1440).
 */
export function HowAndWhy() {
  return (
    <section className="border-line border-b py-10 sm:py-14">
      <Container className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <HowItWorks />
        <WhySection />
      </Container>
    </section>
  );
}
