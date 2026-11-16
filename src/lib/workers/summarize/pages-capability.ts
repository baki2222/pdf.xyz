/**
 * The start-up proof, published on the heartbeat as `summarizePages`, that
 * THIS image's Summarize PDF reads only the pages a person chose, by their
 * PHYSICAL page number, before the read cap — and refuses a page past the
 * end before any provider call (audit summarize-pdf#5, slice 5).
 *
 * WHY A PROOF AND NOT A FLAG. The worker image is built by hand (CLAUDE.md
 * rule 5: merging is not shipping), and an image built before this slice
 * IGNORES `pages` (`parseSummarizeOptions` was lenient to unknown keys), so
 * it would summarize the whole document under a read cap sized for the
 * selection. And the page numbers are `pdftotext`'s: a poppler that dropped
 * blank pages' form feeds would shift every page after a blank one. Neither
 * is a fact about the source tree, so this runs BY the image, on its own
 * `pdftotext`, and an image built before the key publishes nothing, which
 * the reader parses as `false`.
 *
 * WHAT IT RUNS. Three `summarize-pdf` jobs through the executor's order
 * (`../capability-chain`: registry → soundness → processor → manifest gate)
 * on the registry built with the production summarize limits and the
 * image's REAL `pdftotext`, over one 4-page PDF:
 *
 *     page 1  PROBEPAGEALPHA
 *     page 2  (blank)
 *     page 3  PROBEPAGEGAMMA
 *     page 4  PROBEPAGEDELTA
 *
 * The provider is a recording fake, so the proof spends nothing and no
 * `.complete(` call lives in this file.
 *
 * PASS requires ALL of (each printed PASS/FAIL by step):
 *   (0) HEALTH, first: the extractor reads 4 pages, page 2 blank, each
 *       marker on its own page — or every step below would fail for a reason
 *       nobody could read;
 *   (1) `pages: [[3,3]]` is delivered; the provider saw GAMMA and neither
 *       ALPHA nor DELTA (DELTA would be "the third page with text", the
 *       chunk-position defect); the delivered manifest's `source.pagesSent`
 *       is [[3,3]]; summary.md, README.txt and the system prompt all say
 *       "page 3 of 4" (the point of consumption: the READER is told which
 *       pages were read); and the record as THIS image's writer stores it
 *       (`sanitizeJobResults`, then a JSON round trip) keeps [[3,3]];
 *   (2) POSITIVE CONTROL, no `pages`: delivered, the provider saw ALPHA,
 *       GAMMA and DELTA, and the manifest's `pagesSent` is null. This is what
 *       proves the recorder records: (1)'s "did not see ALPHA" is an absence
 *       and is vacuously true of a recorder that captures nothing;
 *   (3) `pages: [[5,5]]` fails as `unprocessable_entity`, not retryable,
 *       with ZERO provider calls.
 *
 * WHAT A PASS DOES NOT MEAN. The model is a fake: whether a real model's
 * summary stays on page 3 is the production proof's question, asked of a
 * real job.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { sanitizeJobResults } from "@/lib/jobs/results";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import type { TruncationWindow } from "../ai/truncation";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import {
  runThroughExecutorOrder,
  type ExecutorOrderOutcome,
} from "../capability-chain";
import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import { createProcessorRegistry } from "../processor";
import { summarizeOutputName } from "../processor/summarize";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { SUMMARY_PACKAGE_FILES } from "../summarize-package";
import type { PdfTextExtractor } from "./engine";
import { summarizeDeps } from "./native";

type EnvSource = Record<string, string | undefined>;

/** The probe's page texts, by physical page; `null` is a blank page. */
export const SUMMARIZE_PAGES_PROOF_PAGES: readonly (string | null)[] = [
  "PROBEPAGEALPHA",
  null,
  "PROBEPAGEGAMMA",
  "PROBEPAGEDELTA",
];
const ALPHA = "PROBEPAGEALPHA";
const GAMMA = "PROBEPAGEGAMMA";
const DELTA = "PROBEPAGEDELTA";
const PROBE_NAME = "summarize-pages-proof.pdf";
/** What the probe asks for, and the sentence the reader must be told. */
const CHOSEN: [number, number][] = [[3, 3]];
const BEYOND: [number, number][] = [[5, 5]];
const NAMES_PAGE_3 = "page 3 of 4";
const PROOF_SUMMARY = "Probe summary.";

/** The 4-page probe PDF of {@link SUMMARIZE_PAGES_PROOF_PAGES}. */
export async function summarizePagesProofPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const words = SUMMARIZE_PAGES_PROOF_PAGES.filter(
    (text): text is string => text !== null,
  );
  // Through the font chooser, like every text-drawing module: the markers
  // are WinAnsi, so it hands back Helvetica.
  const font = await embedDrawingFont(doc, words);
  for (const text of SUMMARIZE_PAGES_PROOF_PAGES) {
    const page = doc.addPage([612, 792]);
    if (text !== null) page.drawText(text, { x: 72, y: 700, size: 14, font });
  }
  return doc.save({ useObjectStreams: false });
}

/** A provider that answers at once and records every request it was sent. */
function recordingProvider(seen: AiCompletionRequest[]): AiProvider {
  return {
    id: "openai",
    model: "capability-probe",
    async complete(request) {
      seen.push(request);
      return {
        ok: true,
        text: PROOF_SUMMARY,
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** Everything a request carried to the model, system prompt and messages. */
const requestText = (request: AiCompletionRequest): string =>
  [request.system ?? "", ...request.messages.map((m) => m.content)].join("\n");

/** The delivered package's files, picked BY NAME, or null. */
async function deliveredPackage(outcome: ExecutorOrderOutcome): Promise<{
  manifest: { source?: { pagesSent?: unknown } };
  markdown: string;
  readme: string;
} | null> {
  if (outcome.stage !== "delivered") return null;
  const name = summarizeOutputName(PROBE_NAME);
  const pkg = outcome.result.artifacts.find((a) => a.filename === name);
  if (!pkg) return null;
  const zip = await JSZip.loadAsync(pkg.bytes);
  const read = (entry: string) => zip.file(entry)?.async("string") ?? null;
  const [manifest, markdown, readme] = await Promise.all([
    read("manifest.json"),
    read(SUMMARY_PACKAGE_FILES.markdown),
    read("README.txt"),
  ]);
  if (manifest === null || markdown === null || readme === null) return null;
  return {
    manifest: JSON.parse(manifest) as { source?: { pagesSent?: unknown } },
    markdown,
    readme,
  };
}

const sameSpans = (value: unknown, expected: [number, number][]): boolean =>
  JSON.stringify(value) === JSON.stringify(expected);

export interface SummarizePagesProofDeps {
  build?: typeof createProcessorRegistry;
  /** The page-text extractor; the image's REAL `pdftotext` unless a test swaps it. */
  extract?: PdfTextExtractor;
  soundness?: SoundnessGate;
  manifest?: ArtifactManifestGate;
  /**
   * The provider seam (tests and mutants only): given the array the proof
   * reads, returns the provider the registry is built with. Production
   * never passes it.
   */
  provider?: (seen: AiCompletionRequest[]) => AiProvider;
}

export interface SummarizePagesProofResult {
  ok: boolean;
  /** One `PASS (n) …` / `FAIL (n) …` line per check, content-free. */
  lines: string[];
}

/** Run the proof and report every check by step. Throws are the caller's. */
export async function runSummarizePagesProof(
  env: EnvSource = process.env,
  deps: SummarizePagesProofDeps = {},
): Promise<SummarizePagesProofResult> {
  const lines: string[] = [];
  let ok = true;
  const check = (step: string, pass: boolean, what: string) => {
    lines.push(`${pass ? "PASS" : "FAIL"} (${step}) ${what}`);
    if (!pass) ok = false;
  };

  const extractor = deps.extract ?? resolveNativePdfTextExtractor(env);
  if (!extractor) {
    check("0", false, "this image has a PDF text extractor (pdftotext)");
    return { ok: false, lines };
  }
  const bytes = await summarizePagesProofPdf();

  // (0) HEALTH first, on the extractor itself: a red step below must be
  // readable as "the selection is wrong", never "poppler numbered it oddly".
  const read: ExtractedPdfText = await extractor(bytes);
  const pageText = (n: number) => read.pages[n - 1]?.text.trim() ?? "";
  const markersOnTheirPages = SUMMARIZE_PAGES_PROOF_PAGES.every((text, i) =>
    text === null
      ? pageText(i + 1) === ""
      : pageText(i + 1).includes(text) &&
        read.pages.every(
          (page) => page.pageNumber === i + 1 || !page.text.includes(text),
        ),
  );
  check(
    "0",
    read.pageCount === 4 &&
      read.pages.length === 4 &&
      read.pages.every((page, i) => page.pageNumber === i + 1) &&
      markersOnTheirPages,
    `the extractor reads ${read.pageCount} pages (need 4), page 2 blank, each marker on its own page only`,
  );
  if (!ok) return { ok, lines };

  const seen: AiCompletionRequest[] = [];
  const provider = (deps.provider ?? recordingProvider)(seen);
  const registry = (deps.build ?? createProcessorRegistry)({
    summarize: {
      limits: summarizeDeps(env).limits,
      extract: extractor,
      provider,
    },
  });
  const soundness = deps.soundness ?? resolveWorkerSoundness(env);
  const manifestGate = deps.manifest ?? resolveWorkerArtifactManifest(env);
  const run = async (pages?: [number, number][]) => {
    const before = seen.length;
    const outcome = await runThroughExecutorOrder({
      tool: "summarize-pdf",
      input: { bytes, filename: PROBE_NAME, contentType: "application/pdf" },
      options: {
        length: "brief",
        format: "paragraphs",
        ...(pages ? { pages } : {}),
      },
      registry,
      env,
      soundness,
      manifest: manifestGate,
    });
    const requests = seen.slice(before);
    return {
      outcome,
      requests,
      sent: requests.map(requestText).join("\n"),
      system: requests.map((r) => r.system ?? "").join("\n"),
    };
  };

  // (1) the chosen page, and only it, at every hop a reader meets.
  const chosen = await run(CHOSEN);
  check(
    "1",
    chosen.outcome.stage === "delivered",
    `pages [[3,3]] is delivered (stage ${chosen.outcome.stage})`,
  );
  check("1", chosen.sent.includes(GAMMA), "the provider saw page 3's text");
  check(
    "1",
    !chosen.sent.includes(ALPHA) && !chosen.sent.includes(DELTA),
    "the provider saw neither page 1's nor page 4's text",
  );
  const pkg = await deliveredPackage(chosen.outcome);
  check(
    "1",
    pkg !== null && sameSpans(pkg.manifest.source?.pagesSent, CHOSEN),
    `the delivered manifest's source.pagesSent is [[3,3]] (${JSON.stringify(pkg?.manifest.source?.pagesSent ?? null)})`,
  );
  check(
    "1",
    pkg !== null &&
      pkg.markdown.includes(NAMES_PAGE_3) &&
      pkg.readme.includes(NAMES_PAGE_3),
    `summary.md and README.txt both say "${NAMES_PAGE_3}"`,
  );
  check(
    "1",
    chosen.system.includes(NAMES_PAGE_3),
    `the system prompt the model received says "${NAMES_PAGE_3}"`,
  );
  let stored: TruncationWindow | null = null;
  if (chosen.outcome.stage === "delivered") {
    const clean = sanitizeJobResults({
      ai: chosen.outcome.result.results?.ai,
    });
    const record = JSON.parse(JSON.stringify(clean ?? {})) as {
      ai?: { truncation?: TruncationWindow };
    };
    stored = record.ai?.truncation ?? null;
  }
  check(
    "1",
    stored !== null && sameSpans(stored.pagesSent, CHOSEN),
    `the stored record keeps pagesSent [[3,3]] (${JSON.stringify(stored?.pagesSent ?? null)})`,
  );

  // (2) POSITIVE CONTROL: no pages, every page — and the recorder records.
  const all = await run();
  const allPkg = await deliveredPackage(all.outcome);
  check(
    "2",
    all.outcome.stage === "delivered" &&
      all.sent.includes(ALPHA) &&
      all.sent.includes(GAMMA) &&
      all.sent.includes(DELTA) &&
      allPkg !== null &&
      allPkg.manifest.source?.pagesSent === null,
    `no pages: delivered (stage ${all.outcome.stage}), the provider saw pages 1, 3 and 4, and the manifest's pagesSent is null`,
  );

  // (3) a page past the end: refused, not retried, nothing sent.
  const beyond = await run(BEYOND);
  const error =
    beyond.outcome.stage === "failed" ? beyond.outcome.result.error : null;
  check(
    "3",
    error !== null &&
      error.code === "unprocessable_entity" &&
      error.retryable === false &&
      beyond.requests.length === 0,
    `pages [[5,5]] fails as ${error?.code ?? beyond.outcome.stage} (retryable ${String(error?.retryable)}) with ${beyond.requests.length} provider calls (need 0)`,
  );

  return { ok, lines };
}

/**
 * True when this image's Summarize PDF reads only the chosen pages (see the
 * file header). False on any throw and when the image has no text extractor.
 */
export async function provesSummarizePages(
  opts: { env?: EnvSource } & SummarizePagesProofDeps = {},
): Promise<boolean> {
  try {
    const { env = process.env, ...deps } = opts;
    const extract = deps.extract ?? resolveNativePdfTextExtractor(env);
    if (!extract) return false;
    const result = await runSummarizePagesProof(env, { ...deps, extract });
    return result.ok;
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}
