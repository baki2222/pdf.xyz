import type { ToolContent } from "./types";
import { IMAGE_HEAVY_SHARE, LOSSLESS_MIN_RATIO } from "@/lib/pdf/analyze";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { HYBRID_WORKER_STEP } from "@/lib/tools/processing";
import {
  TARGET_EXAMPLE,
  TARGET_SIZE_LABELS,
  TARGET_SIZE_PRESETS,
  targetOutcome,
} from "@/lib/pdf/compress-target";
import { DEEP_COMPRESSION_PRESETS } from "@/lib/pdf/offered-kinds";
import {
  RUNNER_FILE_CEILINGS,
  WORKER_FILE_CEILING,
} from "@/lib/tools/file-ceilings";

const MB = 1024 * 1024;

/**
 * The in-browser gate: `CompressRunner` and `useSinglePdf` both validate with
 * `partitionPdfFiles` / `validatePdfFile` at their default budget, which is the
 * constant `RUNNER_FILE_CEILINGS.compress` names.
 */
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.compress / MB);

/**
 * The deep step can only send a file that already passed the browser gate, and
 * the upload API then compares it against the worker ceiling — so the deep
 * path's cap is AT MOST the smaller of the two. Only at most: the native engine
 * also refuses above `PDFXYZ_COMPRESSION_MAX_INPUT_BYTES` (default 200 MiB in
 * native-config.ts), an env var whose production value this file cannot see.
 * So the page never asserts that the deep step ACCEPTS any size; it names a
 * deep-step figure only when the code alone makes it lower than the browser
 * cap, and then only as a refusal bound ("refuses files over"), which stays
 * true whatever that env var is set to. ("Accepts up to" would not: a lower
 * env value makes it false with no code change.)
 */
const DEEP_MB = Math.round(
  Math.min(RUNNER_FILE_CEILINGS.compress, WORKER_FILE_CEILING) / MB,
);
const DEEP_CAP_SENTENCE =
  DEEP_MB < MAX_MB ? ` The deep step refuses files over ${DEEP_MB} MB.` : "";

/** The thresholds `summarizeAnalysis` uses to pick the headline. */
const LOSSLESS_PCT = Math.round(LOSSLESS_MIN_RATIO * 100);
const IMAGE_PCT = Math.round(IMAGE_HEAVY_SHARE * 100);

const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

/** “100 KB”, “200 KB”, “500 KB” or “1 MB” — the panel's presets, as it labels them. */
const TARGET_PRESET_LIST = (() => {
  const quoted = TARGET_SIZE_PRESETS.map((p) => `“${p.label}”`);
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
})();
/** The panel's own sentence for a met target, made by the function it calls. */
const TARGET_SENTENCE = targetOutcome({
  ...TARGET_EXAMPLE,
  appliedTargetBytes: TARGET_EXAMPLE.targetBytes,
  grayscale: false,
}).text;
/** The ladder's floor, by the Quality preset's own label. */
const FLOOR_LABEL = DEEP_COMPRESSION_PRESETS[0].label;

/*
 * What the lossless repack keeps was checked against the real function
 * (`analyzePdf` in src/lib/pdf/analyze.ts) on 2026-09-27, not assumed: a
 * 30-page file saved without object streams, carrying a title, author, an
 * /Outlines entry and a filled-in text field. Output 49% smaller; title,
 * author, outline, the field and its typed value and all 30 pages kept;
 * Producer and Creator both read "pdf.xyz" and ModDate was set to the run
 * time. Nothing here claims what the DEEP path keeps beyond the page count:
 * the worker counts pages in and out and rejects a result with fewer pages
 * (engine.ts, `page_loss`), and returns the original rather than a larger file
 * — except on a Grayscale run (added 2026-10-24), where the original is in
 * colour and the gray file ships even when it is not smaller. Grayscale is
 * Ghostscript-only (`GRAYSCALE_TOOLS`), and the engine re-reads the output's
 * images and fails the run if one still has more than one colour component.
 */
const content: ToolContent = {
  slug: "compress-pdf",

  seoTitle: "Compress PDF — Reduce PDF File Size Online",

  metaDescription:
    "Reduce PDF file size with a lossless repack that runs in your browser, or send image-heavy scans to optional deep image compression on a secure server.",

  intro: [
    "Compress PDF starts by showing you why a file is big. Add a PDF and your browser counts its pages and images, measures the images' share of the file, and repacks it losslessly into compressed object streams. A verdict (“Lossless cleanup shrank this file”, “This PDF is image-heavy” or “This PDF is already lean”) sits above four figures: current size, pages, images and the lossless result.",
    `That first pass runs online in your browser, on your device, and the PDF is not uploaded for it. Pages, text, bookmarks, filled-in form fields, title and author all carry over. Only a few metadata entries change: Producer and Creator become pdf.xyz, the modification date is updated, and a missing creation date is filled in. The drop box takes PDFs of up to ${MAX_MB} MB each.`,
    `A lossless repack cannot shrink images. So when it saves less than ${LOSSLESS_PCT}% and images make up ${IMAGE_PCT}% or more of the file, the headline points you to the optional deep image compression step, which uploads the PDF over TLS to pdf.xyz's secure server. There, Ghostscript downsamples and re-encodes images toward the resolution your Quality setting picks. A server without Ghostscript falls back to qpdf, which recompresses streams and may re-encode some images as JPEG, or to mutool, which only cleans up and recompresses the structure; neither downsamples, and neither reads the Quality setting. Tick “Grayscale” and Ghostscript also turns every colour on the pages into shades of gray; a server without Ghostscript refuses that request instead of returning a colour file. Choose a “${TARGET_SIZE_LABELS.heading}” and Ghostscript runs again at lower resolutions until the file fits, or the panel tells you the smallest it could make. Your upload is deleted when the job finishes, the result link expires after ${LINK_MINUTES} minutes, and a daily storage rule erases the stored copy after that.${DEEP_CAP_SENTENCE}`,
  ],

  useCases: [
    {
      title: "Getting under an attachment limit",
      body: "Email services and upload portals cap file size. The breakdown tells you whether a lossless pass might be enough or whether the images have to be downsampled before the file fits.",
    },
    {
      title: "Phone scans and scanner output",
      body: "A scanned contract or receipt is usually a stack of full-page photos. A lossless repack leaves those photos exactly as they are, so the deep step, set to Smaller or Balanced, is the one that can shrink it.",
    },
    {
      title: "PDFs exported by older software or scripts",
      body: "Files written without object streams keep their structure as plain, uncompressed text. Packing it into compressed object streams can cut the size without touching a page, and the file never leaves your browser.",
    },
    {
      title: "A folder of invoices or statements",
      body: "Select several PDFs and each is repacked in turn on your device. Download them one by one, or press “Download all” for a single ZIP. Deep image compression takes one file at a time.",
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: "Drop a PDF onto the box or click browse. One file opens the full analysis; two or more go to the in-browser batch list, where “Compress N PDFs” repacks each one.",
    },
    {
      title: "Read the breakdown",
      body: "The headline and the tiles Current size, Pages, Images and Lossless result show what is inflating the file and what the repack already saved.",
    },
    {
      title: "Download the lossless copy",
      body: "If the repack saved any bytes, press “Download optimized PDF”. The button shows the new size, and the file name gains “-optimized”.",
    },
    {
      title: "Optional: compress images on our server",
      body: `In the “Deep image compression (secure server)” panel, pick Extreme, Smaller, Balanced or High quality; if the file has to fit a limit, choose a “${TARGET_SIZE_LABELS.heading}” (${TARGET_PRESET_LIST}, or “${TARGET_SIZE_LABELS.custom}”). Tick “Grayscale” if you want the pages in shades of gray, and press “Compress images on our server”, which uploads your file. If it shrank, or was converted to grayscale, press “Download compressed PDF”; with a target, the panel also says whether the file is under it. If nothing shrank, the panel says the original is already efficient.`,
    },
  ],

  faqs: [
    {
      q: "Will compressing my PDF make it look worse?",
      a: "Not the lossless copy, which changes how the file is packed, not what is on the pages. Deep image compression is lossy: Extreme gives up the most detail, High quality the least, and Balanced is the default. Grayscale removes all colour from the copy; your original keeps it. Afterwards our server checks that the result opens as a PDF and, if it can count them, that no pages went missing; nothing compares how the images look, so open the result before deleting your original.",
    },
    {
      q: "Is my file uploaded when I use Compress PDF?",
      a: `Not by default. ${HYBRID_WORKER_STEP} Here that step is the “Compress images on our server” button: the analysis and the lossless copy both run in your browser, and the button is shown only once the panel has confirmed a secure server is available.`,
    },
    {
      q: "Can I compress a PDF to a specific target size?",
      // INVERTED 2026-10-31. Until then this answer read "There is no
      // target-size box." — true, and the most-asked question it answered
      // ("compress PDF to 100 KB") had no tool. The box exists now; what it
      // does is pinned in `target-size.test.ts` and the in-image options
      // proof, and every label below is read from the panel's own constants.
      a: `Yes, on the deep step. In the “Deep image compression (secure server)” panel, choose a “${TARGET_SIZE_LABELS.heading}”: ${TARGET_PRESET_LIST}, or “${TARGET_SIZE_LABELS.custom}” for a number of KB. Our server starts at your Quality setting and steps down, as far as ${FLOOR_LABEL}, until the file fits, and returns the highest-quality version that does; the panel then says, for example, “${TARGET_SENTENCE}” If even ${FLOOR_LABEL} is too big, you get the smallest file it made and the panel says it is above your target; tick “Grayscale” or split the file and try again. How small a file can get depends on how much of it is images: a mostly-text PDF may hardly shrink at all. “${TARGET_SIZE_LABELS.none}” is the default and runs exactly as before. The step uploads your file to our server, and each run starts from your original.`,
    },
    {
      q: "Why didn't my PDF get any smaller?",
      a: "A mostly-text file that is already well packed has little to remove, so the page says “This PDF is already lean” and the Lossless result tile may read “No change”. Without Grayscale, our server never returns a file bigger than the one you sent; if it cannot shrink it, it says so and offers no download. With “Grayscale” ticked the gray copy is offered even when it did not get smaller, because your original is still in colour, and the panel says it did not get smaller.",
    },
    {
      q: "What happens with a password-protected or damaged PDF?",
      a: "A PDF that needs a password to open is refused with a request to unlock it with its password first. One that opens freely but restricts printing or editing cannot be repacked in your browser, so the page offers our secure server's deep step for it instead; our server may not be able to process an encrypted file, and says so if it cannot. In a batch of several files, such a file fails with a note to compress it on its own. An unreadable file gets an error instead of a download. On the deep step our server rejects a result with fewer pages than the original; if it cannot count the original's pages, it returns the smaller file with a warning that it was not checked page-for-page.",
    },
    {
      q: "Does compressing keep a digital signature valid?",
      a: "No. Both the lossless copy and the deep step write the file out anew instead of appending to it, and a signature covers the exact bytes it was applied to, so it stops validating. Compress before signing, or keep the signed original.",
    },
  ],

  relatedGuides: ["how-to-compress-a-pdf", "how-to-compress-a-pdf-to-100-kb"],
};

export default content;
