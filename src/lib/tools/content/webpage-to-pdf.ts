import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  HTML_LAYOUT_STEP,
  htmlLayoutAnswer,
} from "@/lib/tools/html-layout-copy";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/html-render-worker-panel.tsx — url mode for this
 *    slug: one text field prefilled with "https://" (placeholder
 *    "https://example.com"), the "Render PDF" button (busy label
 *    "Rendering PDF…", disabled until the trimmed field is longer than
 *    "https://"), errors in an ErrorNote under the button, and on success
 *    "Your PDF is ready." with a "Download <filename>" button. Since
 *    2026-10-25 a Page layout group (src/lib/tools/html-layout-copy.ts); no header or
 *    delay setting;
 *  - src/lib/workers/html-render-client.ts — the job body is
 *    { tool, inputs: [], options: { ...layout, url } } (layout empty unless
 *    a setting was changed) and the client fetches the
 *    artifact bytes BEFORE reporting success, so the Download button saves
 *    bytes already in the page;
 *  - src/lib/jobs/validation.ts `isSafePublicHttpUrl` — the address as the
 *    WHATWG parser normalises it (http://2130706433/ and http://127.1/ are
 *    127.0.0.1): http/https only, no user:password@, and the host must not be
 *    internal by `isInternalHostname` (src/lib/net/public-address.ts):
 *    localhost and other reserved suffixes (.localhost, .local, .internal,
 *    .lan, .test …), a single-label name, or any non-public IPv4 or IPv6
 *    literal. Probed 2026-10-06: http://localhost./, http://[fc00::1]/,
 *    http://[::ffff:127.0.0.1]/ and https://https://example.com (a paste
 *    after the prefilled prefix; host "https", one label) are all REFUSED, so
 *    step 1 says the doubled prefix is refused. Checked at job creation and
 *    again in the worker (html-render processor `readUrl`, engine
 *    `runWebpageToPdf`);
 *  - src/lib/workers/html-render/network.ts — while rendering, every request
 *    (the page, its redirects, its sub-resources) is resolved by the worker
 *    and fetched only from public addresses, pinned to the checked one;
 *    Chromium's own network is dead (`chromiumArgs`). A main document that
 *    leads somewhere private fails with the "blocked" message;
 *  - src/lib/workers/html-render/native.ts — Chromium over a CDP pipe, a
 *    virtual-time budget, then `Page.printToPDF` with `PRINT_TO_PDF_OPTIONS`:
 *    no header or footer, backgrounds printed, the stylesheet's @page size
 *    preferred (held to this page by worker-tool-answers.test.ts). The
 *    per-render temp folder, the fresh --user-data-dir profile inside it
 *    included, is removed in `finally`. `mainDocumentVerdict` fails the job
 *    on a 4xx/5xx or a `cf-mitigated: challenge` answer (engine.ts
 *    `webpageFetchMessage` words it); a bot check served with a 200 is still
 *    printed;
 *  - src/lib/workers/processor/html-render.ts `webpagePdfOutputName` — host
 *    plus path, slashes to dashes, query string and fragment dropped
 *    (https://example.com/blog/post/?a=1#x -> example.com-blog-post.pdf, run);
 *  - src/components/tools/notify-me.tsx — when the worker is not drainable
 *    the panel shows a status line and "Notify me when this ships" instead
 *    of the field;
 *  - src/lib/workers/queue/redis.ts + redis-scripts.ts — the address lives
 *    only in the job's spec (options.url). FINALIZE DELs the spec on every
 *    terminal transition (complete, terminal fail, dead-letter, cancel,
 *    expire); REQUEUE keeps it for a retry. The status record (`Job`) has no
 *    options field: what stays is artifacts[].filename, from
 *    `webpagePdfOutputName`. The record's TTL is env-configured with no
 *    compile-time owner, so no figure is given.
 *
 * Real render, 2026-09-27, local Chrome 154 with the CLI argv since replaced
 * (NOT the production worker's Debian chromium): text extracted by pdftotext
 * with embedded Unicode-mapped fonts; @media print applied (print-only marker
 * present, screen-only absent); script ran; a scroll-triggered
 * IntersectionObserver image was absent while a loading="lazy" image loaded.
 * That CLI also stamped the date, title, full URL and "n/N" on every page;
 * the CDP print does not (native.chromium.test.ts reads it back).
 * No figure below is typed: the only number is the download-link lifetime.
 */
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "webpage-to-pdf",

  seoTitle: "Webpage to PDF: Convert a Web Page URL to PDF",

  metaDescription: `Paste a public link and Chromium on pdf.xyz's secure worker loads the live page, runs its scripts and prints it to a PDF with real, selectable text.`,

  intro: [
    "Webpage to PDF turns a web address into a PDF without you opening the page. Paste the link and a headless copy of Chromium, the engine behind Chrome and Edge, loads it, lets its JavaScript run for a fixed budget of page time, and prints it to PDF with backgrounds included and any page size the site's print stylesheet sets. Text stays text, so the PDF can be searched and copied from, and a site that ships a print stylesheet gets that layout.",
    `pdf.xyz's secure worker fetches the page, not your browser. The job carries only the address you typed, sent over TLS, and the site sees the worker's visit with none of your cookies. The temporary folder Chromium runs in is removed after each render, the download link lapses after ${LINK_MINUTES} minutes, and a storage rule on a daily cycle erases the stored copy after that. The full address is deleted from the job queue when the job finishes; the job's status record keeps only the PDF's file name, built from the site and path without the query string, until that record times out.`,
    "The worker arrives as a signed-out stranger, so cookie banners, members-only walls and paywalls come along. The PDF carries the page and nothing else: pdf.xyz adds no date, title, address or page-number lines. Addresses written as localhost or as a private IPv4 number are refused before any job starts. For an HTML file on your computer, use HTML to PDF instead.",
  ],

  useCases: [
    {
      title: "Keep a public page as it reads today",
      body: "Terms of service, a returns policy or a price list can change without notice. Convert the page on the day you rely on it and keep the PDF, named with the date, in your own files; the PDF itself adds no date or address line.",
    },
    {
      title: "Save a job posting before it closes",
      body: "Listings vanish when applications close, taking the duties you will be asked about at interview with them. It works when the posting is open to anyone rather than to a jobs site's members. A site that screens out automated browsers usually answers with an error or a bot check, and the job ends with a message saying so instead of a PDF; a check page served as an ordinary page can still be printed, so glance at the result.",
    },
    {
      title: "Read documentation offline",
      body: "Turn a long reference or tutorial page into a searchable PDF for a flight or an e-reader instead of a stack of screenshots.",
    },
    {
      title: "Check how your own site prints",
      body: "The PDF shows the result of your print CSS rather than your screen layout, including any @page size it sets, with backgrounds printed and no header or footer lines added. The site must be reachable from the public internet: a localhost address is refused, and a preview that only resolves inside your office network cannot be reached.",
    },
  ],

  steps: [
    {
      title: "Paste the full address",
      body: 'The field starts with "https://". Select it all and paste the complete link from your address bar over it: pasting after the prefix gives https://https://…, which is refused before any job starts. Only http and https links are accepted. If the secure worker is unavailable, the Render PDF button stays off and a status note and a "Notify me when this ships" button appear under it.',
    },
    HTML_LAYOUT_STEP,
    {
      title: "Press Render PDF",
      body: "The button activates once the field holds more than its starting https://. Your address goes to the secure worker, where Chromium opens and prints the page.",
    },
    {
      title: "Wait while it renders",
      body: 'While the job runs, the button says where it is: "Waiting for the worker…" while it is queued, "Rendering PDF…" while Chromium opens and prints the page, and "Downloading the result…" at the end. If the address is refused or the render fails, an error message appears under the button instead.',
    },
    {
      title: "Download the PDF",
      body: `When "Your PDF is ready." appears, the file is already in the page and the button reads Download plus the file name. The name is the site plus the path, so example.com/blog/post becomes example.com-blog-post.pdf, with the query string and any #fragment left out and a very long name cut short.`,
    },
  ],

  faqs: [
    {
      q: "Can I convert a page I have to be logged in to see?",
      a: "No. The worker receives only the address, never your cookies or anything else from your browser session, so a members-only or paywalled page usually comes out as the screen a logged-out stranger gets, or, if the site answers with an access-refused error, as an error message instead of a PDF. For those, open the page yourself and use your browser's Print dialog with Save as PDF.",
    },
    {
      q: "Why was my address refused?",
      a: "It must begin with http:// or https:// and must not carry a username or password before the host. Refused hosts include localhost, a name with no dot in it, names ending in .localhost, .local or .internal, and loopback, private or link-local addresses such as 127.0.0.1, 10.x.x.x, 192.168.x.x or [::1]. That first check reads only the address as written, and the worker repeats it before Chromium starts. While rendering, the worker also looks up where every name points, including redirects and the page's own images and scripts, and fetches only public addresses, so a link that leads into a private network ends with an error instead of a PDF.",
    },
    {
      q: "Does it capture pages built with JavaScript?",
      a: "Usually. It is a full Chromium, so single-page apps, client-rendered articles and pages that fill in after loading get their scripts run before printing, but only within a fixed rendering budget, and nothing scrolls the page: an endless feed prints only what it loads unscrolled, and images a site's script fetches only as you scroll can be missing.",
    },
    {
      q: "Can I set the page size, margins or orientation, or remove ads?",
      // Until 2026-10-25 the answer began "Not here. The tool has one field
      // and one button" — true until the Page layout group shipped
      // (src/lib/tools/html-layout-copy.ts).
      a: `${htmlLayoutAnswer("site")} Ads cannot be removed: the page prints as a new, signed-out visitor sees it, so cookie notices or adverts shown to a new visitor can appear. To tidy the result, drop pages with Delete Pages or trim edges with Crop PDF.`,
    },
    {
      q: "Will the text be selectable, or is it a screenshot?",
      a: "It is a printed PDF, not an image, so the words can be selected, copied and found with Ctrl+F. Words a site draws as a picture or on a canvas stay pictures. If Chromium fails or returns a file lacking a PDF's header and end marker, you get an error message instead of a broken download.",
    },
    {
      q: "What happens to the address and the PDF afterwards?",
      a: `The address is saved with the job so the worker knows which page to open, and it is deleted from the job queue when the job finishes (an automatic retry keeps it until the last attempt). The job's status record keeps the PDF's file name, made from the site and path without any query string, until that record expires. The PDF's download link works for ${LINK_MINUTES} minutes; after that, a storage rule that runs daily erases the file.`,
    },
  ],

  relatedGuides: [],
};

export default content;
