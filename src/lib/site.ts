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
  ogImage: "/og",
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
  links: {
    twitter: "https://twitter.com/pdfxyz",
    github: "https://github.com/pdfxyz",
  },
} as const;

export type NavItem = {
  label: string;
  href: string;
  description?: string;
};

export const primaryNav: NavItem[] = [
  { label: "All tools", href: "/tools" },
  { label: "Workspace", href: "/workspace" },
  { label: "AI tools", href: "/tools?category=ai" },
  { label: "Pricing", href: "/#pricing" },
];

export const footerNav: { title: string; items: NavItem[] }[] = [
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
      { label: "Help center", href: "/#faq" },
      { label: "API (coming soon)", href: "/#api" },
      { label: "Status", href: "/#status" },
      { label: "Changelog", href: "/#changelog" },
    ],
  },
];
