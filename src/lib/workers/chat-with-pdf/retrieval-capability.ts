/**
 * The start-up proof, published on the heartbeat as `chatRetrieval`, that
 * THIS image's Chat with PDF sends, for a document whose page-labelled text
 * does not fit one question's budget, the pages THAT question points to —
 * within the budget the route charged (competitor audit wave 2 #30, slice 3).
 *
 * WHY A PROOF AND NOT A FLAG. The worker image is built by hand (CLAUDE.md
 * rule 5: merging is not shipping). The selector needs `Intl.Segmenter` with
 * word granularity and FULL ICU — a small-ICU Node segments a Bengali run as
 * nothing, and a missing Segmenter silently leaves every question on the
 * opening pages — and it reads page numbers that `pdftotext` splits. Neither
 * is a fact about the source tree. This runs BY the image, on its own
 * toolchain, and an image built before the key publishes nothing, which the
 * reader parses as `false`.
 *
 * WHAT IT RUNS. Three `chat-with-pdf` jobs through the executor's order
 * (`../capability-chain`: soundness → processor → manifest gate), each
 * under an 8,000-character delivery cap, on the registry the daemon builds
 * with the production chat limits and the image's REAL `pdftotext`. The
 * provider is a recording fake, so the proof spends nothing and no
 * `.complete(` call lives in this file (the engine scan in
 * `ai-spend-ceiling.test.ts` holds every model call to its table).
 *
 *   planted  — a 70-page PDF with `Zephyrine` on page 60 only, asked "What
 *              does the Zephyrine clause say?";
 *   negative — the same PDF, asked a question no page shares a word with;
 *   fit      — a 3-page PDF that fits the budget whole.
 *
 * PASS requires ALL of (each printed PASS/FAIL by letter):
 *   (a) `Zephyrine` reaches the provider INSIDE the `[Page 60]` chunk, inside
 *       the DOCUMENT START/END span. Not "somewhere in the system prompt":
 *       the question carries the token too, and a notice that echoed the
 *       question would otherwise pass with page 60 never sent;
 *   (b) the delivered package's manifest says `selection: "relevance"`, and
 *       its `pagesSent` covers 60 — read from the package picked BY NAME;
 *   (c) the document block plus the notice's page list is ≤ the cap, and the
 *       whole request is ≤ what the route charges for it;
 *   (d) the job record as THIS image's writer stores it (`sanitizeJobResults`,
 *       then a JSON round trip, as the broker stores it) renders a notice
 *       that names page 60 — the composed chain, not the engine's meta;
 *   (e) NEGATIVE: the no-shared-word question gets no page 60, no
 *       `selection`, and a numeric `lastCompletePage` (main's prefix);
 *   (f) FIT: the 3-page document goes whole, with `cacheSystem: true`;
 *   (g) HEALTH: ≥ 60 pages carried text, the word segmenter has full ICU,
 *       the provider saw exactly 3 requests, page 60 lies OUTSIDE the prefix
 *       window at this budget (or (a)/(b) would fail for a reason nobody can
 *       read), `Zephyrine` is on page 60's body and no other, and no word of
 *       the negative question occurs in the filler vocabulary or in any
 *       extracted page (or (e) would go red for the wrong reason, or a word
 *       list edited later would turn it green while it tests nothing).
 *
 * WHAT A PASS DOES NOT MEAN. The model is a fake: whether a real model
 * answers from page 60 is the production proof's question (the PR's step 3),
 * asked of a real job. And `aiReadCap` does NOT depend on this: a broken
 * retriever must not charge every question the whole-run clamp.
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { sanitizeJobResults } from "@/lib/jobs/results";
import { optionCharacters } from "@/lib/jobs/delivery-cap";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  chatDocumentBudget,
} from "@/lib/jobs/chat-with-pdf";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  prefixPagesFor,
  tokenize,
  wordSegmenterAvailable,
  type selectPages,
} from "@/lib/pdf/page-retrieval";
import { formatSpans } from "@/lib/pdf/page-spans";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import type { AiCompletionRequest, AiProvider } from "../ai/provider";
import { userTruncationNotice, type TruncationWindow } from "../ai/truncation";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import { runThroughExecutorOrder } from "../capability-chain";
import { resolveNativePdfTextExtractor } from "../pdf-text/native";
import type { PdfTextExtractor } from "./engine";
import { createProcessorRegistry } from "../processor";
import { chatWithPdfOutputName } from "../processor/chat-with-pdf";
import { chargedCharacters } from "../processor/read-cap-proof";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { chatWithPdfDeps } from "./native";
import {
  CHAT_RETRIEVAL_NEGATIVE_QUESTION,
  CHAT_RETRIEVAL_PLANTED_QUESTION,
  CHAT_RETRIEVAL_PROOF_ANSWER,
} from "./retrieval-proof-questions";

type EnvSource = Record<string, string | undefined>;

/** The delivery cap every proof job runs under, as the route would hand it. */
export const CHAT_RETRIEVAL_PROOF_CAP = 8_000;
export const CHAT_RETRIEVAL_PROOF_PAGES = 70;
export const CHAT_RETRIEVAL_PLANT_PAGE = 60;
export const CHAT_RETRIEVAL_PLANT = "Zephyrine";
// The questions and the fake answer live in a walked phrase module (copy-surface), apart
// from this file's use of the read ceiling; re-exported for the callers.
export { CHAT_RETRIEVAL_NEGATIVE_QUESTION, CHAT_RETRIEVAL_PLANTED_QUESTION };
const FIT_PAGES = 3;
const FILLER_CHARACTERS_PER_PAGE = 1_200;
const LINE_CHARACTERS = 90;

/**
 * The filler vocabulary. Neutral Latin, so no English question word is in
 * it; the health check (g) proves that rather than trusting this comment.
 */
export const CHAT_RETRIEVAL_FILLER_WORDS: readonly string[] = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed eiusmod " +
  "tempor incididunt labore dolore magna aliqua enim minim veniam quis " +
  "nostrud exercitation ullamco laboris nisi aliquip commodo consequat " +
  "duis aute irure reprehenderit voluptate velit esse cillum fugiat nulla " +
  "pariatur excepteur sint occaecat cupidatat proident sunt culpa officia " +
  "deserunt mollit anim laborum"
).split(" ");

/** mulberry32: a small seeded PRNG, so the document is the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The text lines of each page: ~1,200 filler characters from the seeded
 * vocabulary, with {@link CHAT_RETRIEVAL_PLANT} inside page `plantPage`'s
 * text (mid-page, so it is not at a line or page edge).
 */
export function chatRetrievalProofLines(
  pageCount: number,
  plantPage: number | null,
): string[][] {
  const next = seeded(0x5eed0030);
  const word = () =>
    CHAT_RETRIEVAL_FILLER_WORDS[
      Math.floor(next() * CHAT_RETRIEVAL_FILLER_WORDS.length)
    ]!;
  return Array.from({ length: pageCount }, (_, index) => {
    const words: string[] = [];
    let length = 0;
    while (length < FILLER_CHARACTERS_PER_PAGE) {
      const w = word();
      words.push(w);
      length += w.length + 1;
    }
    if (index + 1 === plantPage)
      words.splice(Math.floor(words.length / 2), 0, CHAT_RETRIEVAL_PLANT);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      if (line && line.length + 1 + w.length > LINE_CHARACTERS) {
        lines.push(line);
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    if (line) lines.push(line);
    return lines;
  });
}

/** The proof PDF: one Helvetica page per entry of {@link chatRetrievalProofLines}. */
export async function chatRetrievalProofPdf(
  pageCount: number,
  plantPage: number | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pages = chatRetrievalProofLines(pageCount, plantPage);
  // Through the font chooser, like every text-drawing module: the proof's
  // words are WinAnsi, so it hands back Helvetica, but a face named here
  // directly is the shape `text-drawing-call-sites.test.ts` refuses.
  const font = await embedDrawingFont(doc, pages.flat());
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 40, y: 740 - i * 14, size: 9, font });
    });
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
        text: CHAT_RETRIEVAL_PROOF_ANSWER,
        model: "capability-probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

const DOCUMENT_START = "--- DOCUMENT START ---\n";
const DOCUMENT_END = "\n--- DOCUMENT END ---";

/** The text between DOCUMENT START and DOCUMENT END, or null. */
function documentSpan(system: string): string | null {
  const start = system.indexOf(DOCUMENT_START);
  const end = system.lastIndexOf(DOCUMENT_END);
  if (start < 0 || end < start) return null;
  return system.slice(start + DOCUMENT_START.length, end);
}

/** The chunk of `page` inside a document span: `[Page N]\n…` up to the next marker. */
function pageChunk(span: string, page: number): string | null {
  const marker = `[Page ${page}]\n`;
  const at = span.indexOf(marker);
  if (at < 0) return null;
  const rest = span.slice(at + marker.length);
  const next = rest.search(/\n\n\[Page \d+\]\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The characters the model notice spends naming pages: the span list after
 * "covers pages", plus the cut page's number when it names one. The notice
 * is read as the provider received it, never recomputed from the meta.
 */
function noticeListCharacters(system: string): number {
  const covers = /The text above covers pages ([^:;]+?) of \d+[:;]/.exec(
    system,
  );
  const cut = /The text of page (\d+) ends mid-page\./.exec(system);
  return (covers?.[1]?.length ?? 0) + (cut?.[1]?.length ?? 0);
}

/** Does a "1–3, 17, 58–61" list (inside `text`, after "page(s) ") cover `page`? */
export function noticeNamesPage(text: string, page: number): boolean {
  const list = /\bpages? ((?:\d+(?:–\d+)?)(?:, \d+(?:–\d+)?)*)/.exec(text);
  if (!list) return false;
  return list[1]!.split(", ").some((part) => {
    const [a, b] = part.split("–").map(Number);
    return page >= a! && page <= (b ?? a)!;
  });
}

/** The manifest inside the delivered package, picked by the package's NAME. */
async function deliveredManifest(
  artifacts: readonly { filename: string; bytes: Uint8Array }[],
  inputName: string,
): Promise<Record<string, unknown> | null> {
  const name = chatWithPdfOutputName(inputName);
  const pkg = artifacts.find((artifact) => artifact.filename === name);
  if (!pkg) return null;
  const zip = await JSZip.loadAsync(pkg.bytes);
  const file = zip.file("manifest.json");
  if (!file) return null;
  return JSON.parse(await file.async("string")) as Record<string, unknown>;
}

/** The chunks the engine builds from an extraction (`buildGrounding`'s shape). */
function chunksOf(extracted: ExtractedPdfText) {
  return extracted.pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => ({
      pageNumber: page.pageNumber,
      text: `[Page ${page.pageNumber}]\n${page.text.trim()}`,
    }));
}

export interface ChatRetrievalProofDeps {
  build?: typeof createProcessorRegistry;
  /** The page-text extractor; the image's REAL `pdftotext` unless a test swaps it. */
  extractor?: PdfTextExtractor;
  soundness?: SoundnessGate;
  manifest?: ArtifactManifestGate;
  /** The selector seam (tests and mutants only; production never passes it). */
  select?: typeof selectPages;
}

export interface ChatRetrievalProofResult {
  ok: boolean;
  /** One `PASS (x) …` / `FAIL (x) …` line per check, content-free. */
  lines: string[];
}

/** Run the proof and report every check by letter. Throws are the caller's. */
export async function runChatRetrievalProof(
  env: EnvSource = process.env,
  deps: ChatRetrievalProofDeps = {},
): Promise<ChatRetrievalProofResult> {
  const lines: string[] = [];
  let ok = true;
  const check = (letter: string, pass: boolean, what: string) => {
    lines.push(`${pass ? "PASS" : "FAIL"} (${letter}) ${what}`);
    if (!pass) ok = false;
  };

  const extractor = deps.extractor ?? resolveNativePdfTextExtractor(env);
  if (!extractor) {
    check("g", false, "this image has a PDF text extractor (pdftotext)");
    return { ok: false, lines };
  }
  const seen: AiCompletionRequest[] = [];
  const extractions: ExtractedPdfText[] = [];
  const extract: PdfTextExtractor = async (bytes, run) => {
    const extracted = await extractor(bytes, run);
    extractions.push(extracted);
    return extracted;
  };
  const registry = (deps.build ?? createProcessorRegistry)({
    chatWithPdf: {
      limits: chatWithPdfDeps(env).limits,
      extract,
      provider: recordingProvider(seen),
      ...(deps.select ? { selectPages: deps.select } : {}),
    },
  });
  const soundness = deps.soundness ?? resolveWorkerSoundness(env);
  const manifestGate = deps.manifest ?? resolveWorkerArtifactManifest(env);
  const delivery = { characters: CHAT_RETRIEVAL_PROOF_CAP };
  const ask = async (question: string, bytes: Uint8Array, name: string) => {
    const before = seen.length;
    const options = { question };
    const outcome = await runThroughExecutorOrder({
      tool: "chat-with-pdf",
      input: { bytes, filename: name, contentType: "application/pdf" },
      options,
      delivery,
      registry,
      env,
      soundness,
      manifest: manifestGate,
    });
    return {
      outcome,
      options,
      request: seen.length === before + 1 ? seen[seen.length - 1]! : null,
      extracted: extractions[extractions.length - 1] ?? null,
    };
  };

  const long = await chatRetrievalProofPdf(
    CHAT_RETRIEVAL_PROOF_PAGES,
    CHAT_RETRIEVAL_PLANT_PAGE,
  );
  const planted = await ask(
    CHAT_RETRIEVAL_PLANTED_QUESTION,
    long,
    "retrieval-proof.pdf",
  );
  const negative = await ask(
    CHAT_RETRIEVAL_NEGATIVE_QUESTION,
    long,
    "retrieval-proof.pdf",
  );
  const fit = await ask(
    CHAT_RETRIEVAL_PLANTED_QUESTION,
    await chatRetrievalProofPdf(FIT_PAGES, null),
    "retrieval-fit.pdf",
  );

  // (g) HEALTH first: a red letter below must be readable.
  const segmenter = wordSegmenterAvailable();
  check(
    "g",
    segmenter,
    "Intl.Segmenter segments words with full ICU (Latin + Bengali sample)",
  );
  const extracted = planted.extracted;
  const textPages =
    extracted?.pages.filter((page) => page.text.trim().length > 0) ?? [];
  check(
    "g",
    textPages.length >= CHAT_RETRIEVAL_PLANT_PAGE,
    `pages carrying text: ${textPages.length} (need >= ${CHAT_RETRIEVAL_PLANT_PAGE})`,
  );
  check(
    "g",
    seen.length === 3,
    `the recording provider saw ${seen.length} requests (need exactly 3)`,
  );
  const plantPages = textPages
    .filter((page) => page.text.includes(CHAT_RETRIEVAL_PLANT))
    .map((page) => page.pageNumber);
  check(
    "g",
    plantPages.length === 1 && plantPages[0] === CHAT_RETRIEVAL_PLANT_PAGE,
    `${CHAT_RETRIEVAL_PLANT} is extracted on page(s) [${plantPages.join(", ")}] only (need [${CHAT_RETRIEVAL_PLANT_PAGE}])`,
  );
  const maxChars = Math.min(
    CHAT_MAX_CHARACTERS_PER_QUESTION,
    chatDocumentBudget({ question: CHAT_RETRIEVAL_PLANTED_QUESTION }, delivery),
  );
  const prefix = extracted
    ? prefixPagesFor(chunksOf(extracted), "\n\n", maxChars)
    : new Set<number>();
  check(
    "g",
    prefix.size > 0 && !prefix.has(CHAT_RETRIEVAL_PLANT_PAGE),
    `page ${CHAT_RETRIEVAL_PLANT_PAGE} lies outside the prefix window (pages ${formatSpans(
      [...prefix].length ? [[Math.min(...prefix), Math.max(...prefix)]] : [],
    )}) at ${maxChars} characters`,
  );
  const negativeTerms = new Set(tokenize(CHAT_RETRIEVAL_NEGATIVE_QUESTION));
  const vocabulary = new Set(
    CHAT_RETRIEVAL_FILLER_WORDS.flatMap((w) => tokenize(w)),
  );
  const bodyTerms = new Set(textPages.flatMap((page) => tokenize(page.text)));
  const leaked = [...negativeTerms].filter(
    (term) => vocabulary.has(term) || bodyTerms.has(term),
  );
  check(
    "g",
    segmenter && negativeTerms.size >= 3 && leaked.length === 0,
    `no word of the negative question is in the filler or any page (${negativeTerms.size} terms, leaked: [${leaked.join(", ")}])`,
  );

  // (a) page 60 inside the document span, with the token inside its chunk.
  const plantedSpan = planted.request
    ? documentSpan(planted.request.system ?? "")
    : null;
  const chunk60 = plantedSpan
    ? pageChunk(plantedSpan, CHAT_RETRIEVAL_PLANT_PAGE)
    : null;
  check(
    "a",
    chunk60 !== null && chunk60.includes(CHAT_RETRIEVAL_PLANT),
    `${CHAT_RETRIEVAL_PLANT} reached the provider inside the [Page ${CHAT_RETRIEVAL_PLANT_PAGE}] chunk of the document span`,
  );

  // (b) the delivered package's manifest, picked by name.
  const plantedManifest =
    planted.outcome.stage === "delivered"
      ? await deliveredManifest(
          planted.outcome.result.artifacts,
          "retrieval-proof.pdf",
        )
      : null;
  const source = (plantedManifest?.source ?? {}) as {
    selection?: unknown;
    pagesSent?: unknown;
  };
  const pagesSent = Array.isArray(source.pagesSent)
    ? (source.pagesSent as [number, number][])
    : [];
  check(
    "b",
    source.selection === "relevance" &&
      pagesSent.some(
        ([a, b]) =>
          a <= CHAT_RETRIEVAL_PLANT_PAGE && CHAT_RETRIEVAL_PLANT_PAGE <= b,
      ),
    `the manifest says selection "relevance" with pagesSent ${formatSpans(pagesSent)} covering ${CHAT_RETRIEVAL_PLANT_PAGE}`,
  );

  // (c) the read bound, as the provider received it.
  const listed = planted.request
    ? noticeListCharacters(planted.request.system ?? "")
    : 0;
  const total = planted.request
    ? (planted.request.system ?? "").length +
      planted.request.messages.reduce((sum, m) => sum + m.content.length, 0)
    : Number.POSITIVE_INFINITY;
  const charged = chargedCharacters(CHAT_RETRIEVAL_PROOF_CAP, planted.options);
  check(
    "c",
    plantedSpan !== null &&
      listed > 0 &&
      plantedSpan.length + listed <= CHAT_RETRIEVAL_PROOF_CAP &&
      total <= charged,
    `document ${plantedSpan?.length ?? "?"} + page list ${listed} <= ${CHAT_RETRIEVAL_PROOF_CAP}; request ${total} <= charged ${charged} (options ${optionCharacters(planted.options)})`,
  );

  // (d) the stored record, through THIS image's writer and a JSON round trip.
  let stored: TruncationWindow | null = null;
  if (planted.outcome.stage === "delivered") {
    const clean = sanitizeJobResults({
      ai: planted.outcome.result.results?.ai,
    });
    const record = JSON.parse(JSON.stringify(clean ?? {})) as {
      ai?: { truncation?: TruncationWindow };
    };
    stored = record.ai?.truncation ?? null;
  }
  const storedNotice = stored ? userTruncationNotice(stored) : "";
  check(
    "d",
    noticeNamesPage(storedNotice, CHAT_RETRIEVAL_PLANT_PAGE),
    `the stored record's notice names page ${CHAT_RETRIEVAL_PLANT_PAGE}: "${storedNotice}"`,
  );

  // (e) NEGATIVE: main's prefix, byte for byte in shape.
  const negativeSpan = negative.request
    ? documentSpan(negative.request.system ?? "")
    : null;
  const negativeWindow =
    negative.outcome.stage === "delivered"
      ? (negative.outcome.result.results?.ai?.truncation as
          TruncationWindow | undefined)
      : undefined;
  check(
    "e",
    negativeSpan !== null &&
      !negativeSpan.includes(`[Page ${CHAT_RETRIEVAL_PLANT_PAGE}]`) &&
      negativeWindow !== undefined &&
      negativeWindow.truncated === true &&
      negativeWindow.selection === undefined &&
      typeof negativeWindow.lastCompletePage === "number",
    `a question sharing no word with any page gets the opening pages (lastCompletePage ${String(negativeWindow?.lastCompletePage)}, selection ${String(negativeWindow?.selection)})`,
  );

  // (f) FIT: the whole document, cached as main caches it.
  const fitWindow =
    fit.outcome.stage === "delivered"
      ? (fit.outcome.result.results?.ai?.truncation as
          TruncationWindow | undefined)
      : undefined;
  check(
    "f",
    fit.request?.cacheSystem === true &&
      fitWindow !== undefined &&
      fitWindow.truncated === false &&
      fitWindow.selection === undefined,
    `a ${FIT_PAGES}-page document goes whole with cacheSystem true (cacheSystem ${String(fit.request?.cacheSystem)})`,
  );

  return { ok, lines };
}

/**
 * True when this image's Chat with PDF sends a long document's pages by the
 * question, within the charge (see the file header). False on any throw and
 * when the image has no text extractor.
 */
export async function provesChatRetrieval(
  env: EnvSource = process.env,
  build: typeof createProcessorRegistry = createProcessorRegistry,
  extractor: PdfTextExtractor | undefined = resolveNativePdfTextExtractor(env),
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
  select?: typeof selectPages,
): Promise<boolean> {
  try {
    if (!extractor) return false;
    const result = await runChatRetrievalProof(env, {
      build,
      extractor,
      soundness,
      manifest,
      ...(select ? { select } : {}),
    });
    return result.ok;
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}
