/**
 * Global site configuration. Single source of truth for brand metadata,
 * canonical URL, and primary navigation.
 */

export const siteConfig = {
  name: "pdf.xyz",
  shortName: "pdf.xyz",
  tagline: "Every PDF tool. Private by design.",
  description:
    "pdf.xyz is a modern, fast, privacy-first PDF platform. Merge, split, compress, convert, edit, sign, and use AI on your documents — most tools run entirely in your browser.",
  // Canonical production URL. Used as metadataBase for absolute OG/canonical URLs.
  url: "https://pdf.xyz",
  // Generated at build time by src/app/opengraph-image.tsx.
  ogImage: "/opengraph-image",
  locale: "en_US",
  creator: "pdf.xyz",
  keywords: [
    "PDF tools",
    "merge PDF",
    "split PDF",
    "compress PDF",
    "convert PDF",
    "edit PDF",
    "sign PDF",
    "PDF to Word",
    "AI PDF",
    "privacy-first PDF",
  ],
  /** Where "Contact" actually goes. */
  contactEmail: "support@pdf.xyz",
  // No social profiles are claimed here on purpose. The placeholders that used
  // to sit in this slot were also emitted as schema.org `sameAs`, which asserts
  // to search engines that those accounts are officially ours. Add them back
  // only when the accounts exist and are actually controlled by us.
  /**
   * The X (Twitter) handle pdf.xyz CONTROLS, e.g. "@example". `null` while
   * none is registered to us. It is the only source of `twitter:creator`
   * (see `twitterAttribution` in `seo.ts`); every page used to name
   * "@pdfxyz", an account nothing records as ours.
   */
  xHandle: null as string | null,
} as const;

export type NavItem = {
  label: string;
  href: string;
  description?: string;
};

/**
 * Footer entries additionally allow a label with no destination, for something
 * announced but not built. Only the footer needs this — primary nav items all
 * go somewhere — so the optionality lives here rather than on `NavItem`.
 */
export type FooterNavItem = Omit<NavItem, "href"> & { href?: string };

export const primaryNav: NavItem[] = [
  { label: "All tools", href: "/tools" },
  { label: "Workspace", href: "/workspace" },
  { label: "AI tools", href: "/tools?category=ai" },
  { label: "Pricing", href: "/#pricing" },
];

export const footerNav: { title: string; items: FooterNavItem[] }[] = [
  {
    title: "Product",
    items: [
      { label: "All tools", href: "/tools" },
      { label: "Workspace", href: "/workspace" },
      { label: "AI tools", href: "/tools?category=ai" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "About", href: "/#about" },
      { label: "Privacy", href: "/#privacy" },
      { label: "Security", href: "/#security" },
      { label: "Contact", href: "/#contact" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Guides", href: "/guides" },
      { label: "Help center", href: "/#faq" },
      // Announced, not built. Rendered as plain text rather than a link that
      // goes nowhere — a dead nav item reads as neglect, which is expensive on
      // a product whose whole pitch is that it does what it says.
      { label: "API (coming soon)" },
      { label: "Status", href: "/status" },
    ],
  },
];
