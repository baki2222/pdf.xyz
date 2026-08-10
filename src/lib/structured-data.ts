import { siteConfig } from "@/lib/site";
import { toolCount } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { getProcessingMeta } from "@/lib/tools/processing";
import type { FaqItem } from "@/lib/faq";

/**
 * schema.org JSON-LD builders. Each returns a plain, serializable object that a
 * <JsonLd> node renders into a <script type="application/ld+json">. Node `@id`s
 * are stable so entities can reference each other across the graph.
 */

type Json = Record<string, unknown>;

const abs = (path: string) => new URL(path, siteConfig.url).toString();

const ORG_ID = abs("/#organization");
const WEBSITE_ID = abs("/#website");
const WEBAPP_ID = abs("/#webapp");

export function organizationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    logo: abs("/icon.svg"),
    image: abs(siteConfig.ogImage),
    description: siteConfig.description,
    // No `sameAs`: it asserts ownership of the linked profiles to search
    // engines, so it stays out until there are real accounts to claim.
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: siteConfig.contactEmail,
      availableLanguage: ["en"],
    },
  };
}

export function websiteSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: abs("/tools?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function webApplicationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": WEBAPP_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires a modern web browser with JavaScript enabled.",
    description: siteConfig.description,
    inLanguage: "en-US",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "Merge PDF",
      "Split PDF",
      "Compress PDF",
      "Convert to and from PDF",
      "Edit and annotate PDF",
      "Sign PDF and fill forms",
      "Protect, unlock, and redact PDF",
      "AI: chat, summarize, translate, extract",
    ],
    // Honest, non-fabricated count of what the catalog offers.
    keywords: [...siteConfig.keywords, `${toolCount} PDF tools`].join(", "),
  };
}

/**
 * A tool's steps as HowTo structured data. The steps come from
 * `howToSteps` — the tool's own catalogue steps or the mode-true default —
 * and the structured-steps guard pins that an in-browser tool's steps never
 * claim an upload, because this block ships to crawlers as fact.
 */
export function howToSchema(name: string, steps: readonly string[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to use ${name}`,
    step: steps.map((text, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text,
    })),
  };
}

export function faqPageSchema(items: FaqItem[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** A single tool, described as a free WebApplication that's part of the suite. */
export function toolApplicationSchema(tool: Tool): Json {
  const processing = getProcessingMeta(tool.processing);
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": abs(`/tools/${tool.slug}#webapp`),
    name: tool.name,
    url: abs(`/tools/${tool.slug}`),
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    description: tool.description,
    inLanguage: "en-US",
    isPartOf: { "@id": WEBAPP_ID },
    publisher: { "@id": ORG_ID },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    // e.g. "Runs in your browser" / "Secure worker" — matches the on-page label.
    featureList: processing.label,
  };
}

export function breadcrumbSchema(
  crumbs: { name: string; path: string }[],
): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: abs(crumb.path),
    })),
  };
}
