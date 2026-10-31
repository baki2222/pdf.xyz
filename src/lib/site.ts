import { categories } from "@/lib/tools/categories";
import { categoryHref } from "@/lib/tools/category-href";

/**
 * Global site configuration. Single source of truth for brand metadata,
 * canonical URL, and primary navigation.
 */

export const siteConfig = {
  name: "pdf.xyz",
  shortName: "pdf.xyz",
  tagline: "Every PDF tool. Private by design.",
  description:
    "Merge, split, compress, convert, edit and sign PDFs, plus AI tools. Fast and privacy-first — most tools run entirely in your browser.",
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

/**
 * When a primary-nav item is the current page: a path, either exact or with
 * everything under it (`prefix`), and optionally query values that must
 * also be present. A rule with a query is more specific than any rule
 * without one — `/tools?category=ai` is the AI tools, though its path is
 * `/tools`'s.
 */
export type NavMatch = {
  readonly path: string;
  readonly prefix?: boolean;
  readonly query?: Readonly<Record<string, string>>;
};

export type NavItem = {
  label: string;
  href: string;
  description?: string;
  /** When it is current (see {@link currentNavHref}); none for an anchor. */
  match?: readonly NavMatch[];
  /** Shown in the desktop row only from `lg`; always in the menu. */
  wide?: boolean;
};

/**
 * Footer entries additionally allow a label with no destination, for something
 * announced but not built. Only the footer needs this — primary nav items all
 * go somewhere — so the optionality lives here rather than on `NavItem`.
 */
export type FooterNavItem = Omit<NavItem, "href" | "match" | "wide"> & {
  href?: string;
};

const AI_HREF = categoryHref("ai");

export const primaryNav: NavItem[] = [
  {
    label: "All tools",
    href: "/tools",
    match: [{ path: "/tools", prefix: true }],
  },
  {
    label: "AI tools",
    href: AI_HREF,
    // The category page, and the old shared filter URL the explorer still
    // reads (category-href.ts): both are the AI tools.
    match: [
      { path: AI_HREF, prefix: true },
      { path: "/tools", query: { category: "ai" } },
    ],
  },
  {
    label: "Guides",
    href: "/guides",
    match: [{ path: "/guides", prefix: true }],
  },
  {
    label: "Workspace",
    href: "/workspace",
    match: [{ path: "/workspace", prefix: true }],
  },
  // An in-page anchor: never current. Hidden below `lg` in the header row
  // (D.1), where four links already fill it; the menu always has it.
  { label: "Pricing", href: "/#pricing", wide: true },
];

/** How specific a rule's match on this location is, or -1 for none. */
function matchScore(
  rule: NavMatch,
  pathname: string,
  search: URLSearchParams | null,
): number {
  const onPath =
    pathname === rule.path ||
    (rule.prefix === true && pathname.startsWith(`${rule.path}/`));
  if (!onPath) return -1;
  if (rule.query) {
    // Without the query (the server render, before it is known) a rule that
    // needs one cannot be said to match.
    if (!search) return -1;
    for (const [key, value] of Object.entries(rule.query)) {
      if (search.get(key) !== value) return -1;
    }
    return 10_000 + rule.path.length;
  }
  return rule.path.length;
}

/**
 * Which primary-nav entry the current location belongs to: the item whose
 * most specific rule matches best, so `/tools/category/ai` and
 * `/tools?category=ai` light "AI tools" and not also "All tools". Pass
 * `search: null` when the query is not known (the server render): rules that
 * need it then do not match. In-page anchors (`/#pricing`) have no rules and
 * never mark a page as current.
 */
export function currentNavHref(
  pathname: string,
  search: URLSearchParams | null,
  items: readonly NavItem[] = primaryNav,
): string | undefined {
  let best: { href: string; score: number } | undefined;
  for (const item of items) {
    for (const rule of item.match ?? []) {
      const score = matchScore(rule, pathname, search);
      if (score >= 0 && (best === undefined || score > best.score)) {
        best = { href: item.href, score };
      }
    }
  }
  return best?.href;
}

export const footerNav: { title: string; items: FooterNavItem[] }[] = [
  {
    title: "Product",
    items: [
      { label: "All tools", href: "/tools" },
      { label: "Workspace", href: "/workspace" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    // Every category landing page, from `categories` — a ninth category is
    // linked site-wide by existing, and this column cannot name one that does
    // not. It replaces the single "AI tools" entry the Product column carried.
    title: "Categories",
    items: categories.map((category) => ({
      label: category.name,
      href: categoryHref(category.id),
    })),
  },
  {
    title: "Company",
    // Named for what each one opens. These were "Privacy" and "Security",
    // and the footer already had a "Privacy" for the policy (/privacy) and
    // the Categories column a "Security" for the tool category, so two names
    // each led two places (site-landmarks.test.tsx).
    items: [
      { label: "About", href: "/#about" },
      { label: "How files are handled", href: "/#privacy" },
      { label: "Security practices", href: "/#security" },
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
