import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/html-render-worker-panel.tsx — url mode for this
 *    slug: one text field prefilled with "https://" (placeholder
 *    "https://example.com"), the "Render PDF" button (busy label
 *    "Rendering PDF…", disabled until the trimmed field is longer than
 *    "https://"), errors in an ErrorNote under the button, and on success
 *    "Your PDF is ready." with a "Download <filename>" button. No other
 *    options (no page size, orientation, margins, header or delay setting);
 *  - src/lib/workers/html-render-client.ts — the job body is
 *    { tool, inputs: [], options: { url } } and the client fetches the
 *    artifact bytes BEFORE reporting success, so the Download button saves
 *    bytes already in the page;
 *  - src/lib/jobs/validation.ts `isSafePublicHttpUrl` — reads the host AS
 *    TYPED: http/https only, no user:password@, and localhost / *.localhost /
 *    *.local / *.internal / 0.0.0.0 / [::1] / IPv4 127.x, 10.x, 192.168.x,
 *    172.16–31.x, 169.254.x refused. It does NOT resolve names and does NOT
 *    refuse IPv6 ULA/link-local ([fc00::1], [fe80::1] pass, as do
 *    [::ffff:127.0.0.1] and names that resolve to a private IP). So the copy
 *    names only what is refused as written, and never says private networks
 *    are unreachable. Probed 2026-09-27: the WHATWG parser normalises first,
 *    so http://2130706433/, http://127.1/ and http://0x0a.0.0.1/ are refused,
 *    while http://localhost./ and https://https://example.com (a paste after
 *    the prefilled prefix; host "https") PASS — hence the copy avoids "as
 *    typed" and step 1 warns about the doubled prefix. Checked at job creation and again in the worker
 *    (html-render processor `readUrl`, engine `runWebpageToPdf`);
 *  - src/lib/workers/html-render/native.ts — headless Chromium
 *    `--print-to-pdf` with a virtual-time budget, and no header/footer flag,
 *    so Chromium's default header and footer are printed; the per-render
 *    temp folder is removed in `finally`. No --user-data-dir is passed, so
 *    the copy says the visitor's cookies are never SENT, not that the worker
 *    profile is empty;
 *  - src/lib/workers/processor/html-render.ts `webpagePdfOutputName` — host
 *    plus path, slashes to dashes, query string and fragment dropped
 *    (https://example.com/blog/post/?a=1#x -> example.com-blog-post.pdf, run);
 *  - src/components/tools/notify-me.tsx — when the worker is not drainable
 *    the panel shows a status line and "Notify me when this ships" instead
 *    of the field;
 *  - src/lib/workers/queue/redis.ts — the job and its spec (options.url) are
 *    SET with EX jobTtlSeconds and not deleted on completion. That TTL is
 *    env-configured with no compile-time owner, so no figure is given.
 *
 * Real render, 2026-09-27, local Chrome 154 with the exact chromiumPdfArgs
 * (NOT the production worker's Debian chromium): text extracted by pdftotext
 * with embedded Unicode-mapped fonts; @media print applied (print-only marker
 * present, screen-only absent); script ran; a scroll-triggered
 * IntersectionObserver image was absent while a loading="lazy" image loaded;
 * every page carried the date/time, page title, full URL INCLUDING the query
 * string (https://example.com/?q=secret), and "n/N" page numbers.
 * No figure below is typed: the only number is the download-link lifetime.
 */
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "webpage-to-pdf",

  seoTitle: "Webpage to PDF: Convert a Web Page URL to PDF",

  metaDescription: `Paste a public link and Chromium on pdf.xyz's secure worker loads the live page, runs its scripts and prints it to a PDF with real, selectable text.`,

  intro: [
    "Webpage to PDF turns a web address into a PDF without you opening the page. Paste the link and a headless copy of Chromium, the engine behind Chrome and Edge, loads it, lets its JavaScript run for a fixed budget of page time, and prints it through Chromium's own print-to-PDF path with default settings. Text stays text, so the PDF can be searched and copied from, and a site that ships a print stylesheet gets that layout.",
    `pdf.xyz's secure worker fetches the page, not your browser. The job carries only the address you typed, sent over TLS, and the site sees the worker's visit with none of your cookies. The temporary folder Chromium prints into is removed after each render, the download link lapses after ${LINK_MINUTES} minutes, and a storage rule on a daily cycle erases the stored copy after that. The address itself outlives the job, kept with the job's record until that record times out.`,
    "The worker arrives as a signed-out stranger, so cookie banners, members-only walls and paywalls come along. Chromium also prints its own header and footer on every page: the render's date and time on the worker's clock, the page title, the full address including any query string, and page numbers, so a private token in a link ends up printed in the PDF. Addresses written as localhost or as a private IPv4 number are refused before any job starts. For an HTML file on your computer, use HTML to PDF instead.",
  ],

  useCases: [
    {
      title: "Keep a public page as it reads today",
      body: "Terms of service, a returns policy or a price list can change without notice. Each page of the PDF carries the render's date and source address, so the version you relied on sits in your own files.",
    },
    {
      title: "Save a job posting before it closes",
      body: "Listings vanish when applications close, taking the duties you will be asked about at interview with them. It works when the posting is open to anyone rather than to a jobs site's members; a site that screens out automated browsers may answer with a challenge page, and that page is what gets printed.",
    },
    {
      title: "Read documentation offline",
      body: "Turn a long reference or tutorial page into a searchable PDF for a flight or an e-reader instead of a stack of screenshots.",
    },
    {
      title: "Check how your own site prints",
      body: "The PDF shows the result of your print CSS rather than your screen layout, though the date, address and page-number lines are Chromium's, not your stylesheet's. The site must be reachable from the public internet: a localhost address is refused, and a preview that only resolves inside your office network cannot be reached.",
    },
  ],

  steps: [
    {
      title: "Paste the full address",
      body: 'The field starts with "https://". Select it all and paste the complete link from your address bar over it: pasting after the prefix gives https://https://…, which is not refused up front but will not open your page. Only http and https links are accepted. If the secure worker is unavailable, a status note and a "Notify me when this ships" button stand where the field would be.',
    },
    {
      title: "Press Render PDF",
      body: "The button activates once the field holds more than its starting https://. Your address goes to the secure worker, where Chromium opens and prints the page.",
    },
    {
      title: "Wait while it renders",
      body: 'The button reads "Rendering PDF…" while the job runs. If the address is refused or the render fails, an error message appears under the button instead.',
    },
    {
      title: "Download the PDF",
      body: `When "Your PDF is ready." appears, the file is already in the page and the button reads Download plus the file name. The name is the site plus the path, so example.com/blog/post becomes example.com-blog-post.pdf, with the query string and any #fragment left out and a very long name cut short.`,
    },
  ],

  faqs: [
    {
      q: "Can I convert a page I have to be logged in to see?",
      a: "No. The worker receives only the address, never your cookies or anything else from your browser session, so a members-only or paywalled page usually comes out as the screen a logged-out stranger gets. For those, open the page yourself and use your browser's Print dialog with Save as PDF.",
    },
    {
      q: "Why was my address refused?",
      a: "It must begin with http:// or https:// and must not carry a username or password before the host. Refused hosts are localhost, names ending in .localhost, .local or .internal, and loopback, private or link-local IPv4 addresses such as 127.0.0.1, 10.x.x.x or 192.168.x.x. The check looks only at the address itself and does not look up where a name points, so it is a first filter, not a promise about which networks the worker can reach. The worker repeats it before Chromium starts.",
    },
    {
      q: "Does it capture pages built with JavaScript?",
      a: "Usually. It is a full Chromium, so single-page apps, client-rendered articles and pages that fill in after loading get their scripts run before printing, but only within a fixed rendering budget, and nothing scrolls the page: an endless feed prints only what it loads unscrolled, and images a site's script fetches only as you scroll can be missing.",
    },
    {
      q: "Can I set the page size, margins or orientation, or remove ads?",
      a: "Not here. The tool has one field and one button, so the PDF uses Chromium's default print layout plus whatever print styles the site defines, and cookie notices or adverts shown to a new visitor can appear. To tidy the result, drop pages with Delete Pages or trim edges with Crop PDF.",
    },
    {
      q: "Will the text be selectable, or is it a screenshot?",
      a: "It is a printed PDF, not an image, so the words can be selected, copied and found with Ctrl+F. Words a site draws as a picture or on a canvas stay pictures. If Chromium fails or returns a file lacking a PDF's header and end marker, you get an error message instead of a broken download.",
    },
    {
      q: "What happens to the address and the PDF afterwards?",
      a: `The address is saved with the job so the worker knows which page to open, and it stays in the job's status record until that record expires; finishing the job does not remove it. The PDF's download link works for ${LINK_MINUTES} minutes; after that, a storage rule that runs daily erases the file.`,
    },
  ],

  relatedGuides: [],
};

export default content;
