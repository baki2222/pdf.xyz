// @vitest-environment node
/**
 * A capability the worker is BUILT TO REPORT may not be hedged in the catalogue.
 *
 * ── THE DEFECT THIS WAS BUILT ON ────────────────────────────────────────────
 *
 * Until 2026-08-22 `catalog.ts` shipped, as step 3 of the Compress PDF page:
 *
 *     "For image-heavy files, deep compression runs on a secure worker (coming soon)."
 *
 * It was added on 2026-07-02 (454a9a5), when it was true. Deep compression was
 * enabled eleven days later, on 2026-07-13 (4ce3612, "enable deep compression
 * on staging worker"), and the parenthetical was never revisited — so it had
 * been false for FORTY DAYS when it was measured. Three surfaces on that one
 * page already contradicted it:
 *
 *   - `description`  — "Deep image downsampling runs on a secure, auto-deleting worker."
 *   - `toolFacts`    — "deep image compression is an optional, clearly-labeled
 *                       secure-worker step that needs a native engine."
 *   - the runner     — `canRunDeepCompression` measured `true` against the LIVE
 *                      production `/api/worker/status`, so the page renders a
 *                      working "Compress images on our server" button three
 *                      lines below the sentence calling it unshipped.
 *
 * And it did not only mislead readers. `how` is what `howToSteps` feeds to
 * `howToSchema`, so the claim was served to Google as `HowToStep` position 3 —
 * measured on the wire at https://pdf.xyz/tools/compress-pdf, five of the eight
 * "coming soon" occurrences in that document (one JSON-LD, one rendered, three
 * RSC flight).
 *
 * ── THE PROPERTY, NOT THE MECHANISM ─────────────────────────────────────────
 *
 * The tempting rule is "don't write (coming soon)". That is the mechanism, and
 * it retires the moment someone writes "not yet available" instead. The
 * property is:
 *
 *   **A STATIC STRING MAY NOT ADJUDICATE A LIVE CAPABILITY.**
 *
 * Whether the secure worker can do a thing today is settled by what is deployed,
 * and the app already has an honest seam for it — the worker's own liveness
 * heartbeat, which `/api/worker/status` reads and `WorkerDeepPanel` gates on,
 * falling back to the worker's own words when no worker is up. A parenthetical
 * baked into the catalogue cannot observe any of that; it can only be right
 * until the deployment moves, and then it is wrong silently and forever.
 *
 * This is the same defect `workerPipelineStages` was rewritten to kill — a
 * static string in the web tier overriding a live capability, there claiming a
 * malware scan that was not running. Same shape, opposite sign: this one denied
 * a capability that was.
 *
 * So the rule is scoped by the heartbeat's OWN capability vocabulary: if the
 * worker is built to report on it, the catalogue does not get to hedge about
 * it. If the capability really is absent, the honest surface is the live status
 * seam, which says so in the worker's own voice.
 *
 * ── THE SECOND DEFECT: GREEN OVER SIX DEFERRALS (2026-10-09) ───────────────
 *
 * The `pptxPresentationChain` subject was widened on 2026-09-27 to reach "the
 * sentences a hedge about this capability would actually sit in", and it did:
 * it matched six deferrals on the PDF to PowerPoint page — "Not at the
 * moment.", "currently rejects", "Until that is fixed", "While PowerPoint
 * refuses that file", "Until the .pptx opens", "will not open it yet". Not one
 * matched a hedge SHAPE, so the rule passed over all six. Its control was a
 * planted "coming soon", which the shapes were built from; the page's own
 * sentences were never put through them. `not\s+yet` and `does not yet` both
 * need the two words side by side, and "will not open it yet" puts a verb and
 * an object between them. The subject was right; the vocabulary had a hole
 * exactly the size of what shipped.
 *
 * And the copy was about to go false in the direction this file exists for:
 * `publish.yml` deploys both tiers from main, so the first successful publish
 * carrying the new writer would have served "PowerPoint refuses it" beside a
 * worker whose file PowerPoint had been measured opening. Six shapes were
 * added from those six sentences (each kept verbatim in
 * `PPTX_DEFERRALS_SHIPPED`), the rule went red on exactly those six, read
 * through the page's own accessors, and the copy was rewritten so that it
 * claims neither "refuses" nor "opens" (the content file says why).
 *
 * Two holes it found in passing are closed too: a FAQ answer is now also read
 * against its QUESTION (`faqPairs`), and the subject's gaps let a dot through
 * when a word follows it ("16.0", ".pptx"). One is NOT closed and is stated
 * instead: this file reads DEFERRALS. A bare present-tense denial ("it is
 * refused as corrupted") or a bare "it opens" carries no deferral marker, and
 * either adjudicates a live capability just as surely. Nothing here sees them.
 *
 * A review the same day found two more. The rule's main path had no positive
 * control: mutated to skip every entry, the file stayed green (the six now go
 * through `hedgeOffenders` itself). And the rewrite moved four of the six
 * locations — the meta description, both use cases, step 4 — OUTSIDE the
 * subject, because their new wording names neither PowerPoint opening nor
 * refusing; a deferral put back there in other words ("it will not open
 * yet") would have passed. A subject pattern recognises sentences ABOUT a
 * capability, and on the page NAMED for the capability every sentence is, so
 * that page is now read whole (`ownPages`).
 *
 * ── HOW THE SETS ARE DERIVED (rule 4) ───────────────────────────────────────
 *
 * Neither set is typed:
 *
 *   - the CAPABILITIES come from the heartbeat itself, twice and independently —
 *     `emptyCapabilities()` (the defaults) and the keys `serializeHeartbeat`
 *     actually puts on the wire. A capability that exists in one and not the
 *     other reaches nobody, or arrives unannounced, so the two derivations are
 *     asserted equal and either one drifting is red. Deriving from the wire is
 *     the half that matters: a heartbeat guard once derived its key set from the
 *     capabilities sub-object and so never asked about a dropped top-level
 *     field.
 *   - the COPY comes from walking `tools` and calling the same accessors the
 *     page calls — `howToSteps`, `toolFacts`, `toolFaq` — so a new tool, a new
 *     fact, or a new FAQ answer is in the corpus the moment it exists. No slug
 *     is named as a corpus; slugs appear only in assertions ABOUT a derived
 *     set (which pages it found) and in the fixtures of what shipped.
 *   - the pages a capability OWNS come from its own subject run over the tool
 *     NAMES (`ownPages`), not from a list. Rename the tool out of the subject's
 *     reach and the membership test goes red rather than the page dropping out
 *     of scope.
 *
 * ── SCOPE, DELIBERATELY ─────────────────────────────────────────────────────
 *
 * Catalogue and tool-facts only. The footer's `API (coming soon)` in
 * `src/lib/site.ts` is TRUE — there is no public API and no route for one — and
 * a blanket ban on the words would have to launder it with an exemption, which
 * is how ban lists rot. A hedge about a thing nobody built is honest; a hedge
 * about a thing the worker reports on is not.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { guides } from "@/lib/guides";
import {
  buildHeartbeat,
  emptyCapabilities,
  serializeHeartbeat,
} from "@/lib/workers/heartbeat";
import {
  TRANSLATE_OCR_CHARGE_SENTENCE,
  TRANSLATE_OCR_SCOPE,
  TRANSLATE_SCAN_ROUTE,
} from "@/lib/jobs/translate-ocr";
import { ADVERTISED_WORKER_CAPABILITIES } from "@/lib/workers/observability/snapshot";
import { toolFacts } from "./tool-facts";
import { CHAT_PAGE_SELECTION_CAPABILITY } from "./chat-page-selection";
import { CHAT_SELECTION_REQUIRED } from "./chat-retrieval-claims";
import {
  SUMMARIZE_PAGE_CHOICE,
  SUMMARIZE_PAGES_CAPABILITY,
} from "./summarize-page-choice";
import { SUMMARIZE_PAGE_CHOICE_SHAPES } from "./summarize-page-choice-claims";
import {
  TRANSLATE_PAGE_CHOICE,
  TRANSLATE_PAGE_RANGE_CAPABILITY,
} from "./translate-page-choice";
import {
  TRANSLATE_PAGE_CHOICE_SHAPES,
  TRANSLATE_PAGE_CHOICE_SHIPPED,
} from "./translate-page-choice-claims";
import {
  cardSummary,
  pageContent,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";

/* ------------------------------------------------------------------ *
 *  The copy corpus — discovered from the catalogue, never listed.
 * ------------------------------------------------------------------ */

interface CopyEntry {
  readonly slug: string;
  readonly where: string;
  readonly text: string;
}

/**
 * Every string the catalogue layer hands a reader or a crawler, reached through
 * the same accessors the page uses. `howToSteps` is the one that matters most:
 * it is the literal input to `howToSchema`, so this corpus contains the exact
 * strings that become `HowToStep` JSON-LD.
 */
function catalogueCopy(): CopyEntry[] {
  const out: CopyEntry[] = [];
  for (const tool of tools) {
    const at = (where: string, text: string) =>
      out.push({ slug: tool.slug, where, text });
    at("name", tool.name);
    if (tool.seoTitle) at("seoTitle", tool.seoTitle);
    at("tagline", tool.tagline);
    if (tool.cardSummary) at("cardSummary", cardSummary(tool));
    at("description", tool.description);
    tool.keywords.forEach((k, i) => at(`keywords[${i}]`, k));
    // Through `page-copy`, the accessors the page renders — since
    // 2026-09-27 that is the authored content where a tool has it.
    pageSteps(tool).forEach((s, i) => at(`how[${i}]`, stepText(s)));
    toolFacts(tool.slug).forEach((f, i) => {
      at(`facts[${i}].label`, f.label);
      at(`facts[${i}].value`, f.value);
    });
    pageFaq(tool).forEach((f, i) => {
      at(`faq[${i}].question`, f.question);
      at(`faq[${i}].answer`, f.answer);
    });
    pageIntro(tool).forEach((p, i) => at(`intro[${i}]`, p));
    pageUseCases(tool).forEach((u, i) => {
      at(`useCases[${i}].title`, u.title);
      at(`useCases[${i}].body`, u.body);
    });
    const content = pageContent(tool);
    if (content) {
      at("seoTitle", content.seoTitle);
      at("metaDescription", content.metaDescription);
    }
  }
  // The guides catalogue, through its own accessors — the same idiom, added
  // with the /guides section (2026-09-17). Guide steps and FAQ ship as
  // HowTo/FAQPage JSON-LD exactly like the tool pages' do, so a hedge written
  // there reaches crawlers with the same authority. Slugs are prefixed so the
  // per-tool corpus bound below keeps counting only tool copy.
  for (const guide of guides) {
    const at = (where: string, text: string) =>
      out.push({ slug: `guide:${guide.slug}`, where, text });
    at("title", guide.title);
    at("description", guide.description);
    guide.keywords.forEach((k, i) => at(`keywords[${i}]`, k));
    guide.intro.forEach((p, i) => at(`intro[${i}]`, p));
    guide.steps.forEach((s, i) => at(`steps[${i}]`, s));
    guide.sections.forEach((section, i) => {
      at(`sections[${i}].heading`, section.heading);
      section.body.forEach((p, j) => at(`sections[${i}].body[${j}]`, p));
    });
    guide.faq.forEach((f, i) => {
      at(`faq[${i}].question`, f.question);
      at(`faq[${i}].answer`, f.answer);
    });
  }
  return out;
}

const COPY = catalogueCopy();

/**
 * One FAQ question with its answer.
 *
 * WHY PAIRS (2026-10-09): an answer can be a bare deferral whose subject sits
 * only in the question. To "Will the .pptx open in PowerPoint?", the answer
 * "Not at the moment." is about the capability, and no subject pattern can see
 * that in the answer alone. The PowerPoint page's answer was read only because
 * its SECOND sentence happened to name PowerPoint, and the answer that
 * replaced it fell outside the subject altogether (see the subject's note). So
 * an answer is also read against its own question.
 */
interface FaqPair {
  readonly slug: string;
  readonly where: string;
  readonly question: string;
  readonly answer: string;
}

/**
 * Paired FROM {@link COPY}, not walked a second time, so the two cannot
 * disagree about what a page asks. A question with no answer beside it is a
 * broken link in that derivation, and it throws rather than shrinking the set.
 */
function faqPairs(copy: readonly CopyEntry[]): FaqPair[] {
  const bySlug = new Map<string, Map<string, string>>();
  for (const entry of copy) {
    const page = bySlug.get(entry.slug) ?? new Map<string, string>();
    page.set(entry.where, entry.text);
    bySlug.set(entry.slug, page);
  }
  const pairs: FaqPair[] = [];
  for (const entry of copy) {
    const at = /^(faq\[\d+\])\.question$/.exec(entry.where);
    if (!at) continue;
    const where = at[1]!;
    const answer = bySlug.get(entry.slug)?.get(`${where}.answer`);
    if (answer === undefined)
      throw new Error(`${entry.slug} ${where} has a question and no answer`);
    pairs.push({ slug: entry.slug, where, question: entry.text, answer });
  }
  return pairs;
}

const FAQ_PAIRS = faqPairs(COPY);

/* ------------------------------------------------------------------ *
 *  The capability set — derived twice, from the heartbeat.
 * ------------------------------------------------------------------ */

/** The keys `serializeHeartbeat` actually writes to the broker. */
function wireCapabilityKeys(): string[] {
  const record = JSON.parse(
    serializeHeartbeat(
      buildHeartbeat({
        mode: "loop",
        capabilities: emptyCapabilities(),
        at: 0,
      }),
    ),
  ) as { capabilities: Record<string, unknown> };
  return Object.keys(record.capabilities).sort();
}

const WIRE_KEYS = wireCapabilityKeys();
const DEFAULT_KEYS = Object.keys(emptyCapabilities()).sort();

/* ------------------------------------------------------------------ *
 *  Subjects — which sentences are ABOUT which capability.
 * ------------------------------------------------------------------ */

/**
 * One heartbeat capability: how to recognise catalogue prose about it, and
 * whether the catalogue currently says anything at all.
 *
 * `catalogueCopy` is a declaration that gets CHECKED IN BOTH DIRECTIONS, which
 * is the only thing that keeps it from rotting into a comment. Declared `true`
 * and the subject must match something shipped — otherwise the pattern is
 * decoration and the rule below is vacuous for that capability. Declared
 * `false` and the subject must match NOTHING — so the day someone writes the
 * catalogue's first sentence about atomic queues, this file goes red and the
 * pairing has to be made deliberately rather than missed.
 */
interface CapabilitySubject {
  readonly subject: RegExp;
  readonly catalogueCopy: boolean;
}

const SUBJECTS: Record<string, CapabilitySubject> = {
  deepCompression: {
    subject:
      /deep[^.]{0,40}compress|compress[^.]{0,40}\bdeep\b|deep image downsampl/i,
    catalogueCopy: true,
  },
  ocr: {
    subject: /\bOCR\b|optical character recognition|\bsearchable\b/i,
    catalogueCopy: true,
  },
  ocrLanguages: {
    subject:
      /recognition language|languages can OCR|OCR[^.]{0,30}language|language pack|traineddata/i,
    catalogueCopy: true,
  },
  malwareScan: {
    // NOT `scanned for`: measured 2026-08-22, that shape matches
    // extract-images' "every page is scanned for embedded images", which is
    // about pictures and not about safety. A subject pattern that drags in an
    // unrelated sentence makes the rule below fire for the wrong reason.
    subject: /\bmalware\b|\bvirus(?:es)?\b|\bantivirus\b/i,
    catalogueCopy: false,
  },
  atomicQueue: {
    subject: /\batomic\b|race-safe|compare-and-set/i,
    catalogueCopy: false,
  },
  chunkedTranslate: {
    subject: /\bchunk|split at page boundaries|longer document|per pass\b/i,
    catalogueCopy: true,
  },
  deliveryCap: {
    subject: /\bdelivery cap\b|reservation paid|what its reservation/i,
    catalogueCopy: false,
  },
  aiReadCap: {
    // The panels say "One run never counts more than N" — true whether or not
    // this is proven, so it is not a hedge on it. The catalogue said nothing
    // about per-run pricing, and this read `catalogueCopy: false` with "the
    // day it does, this goes red on purpose". That day was the merge with
    // L04: each AI tool's fact line and "Is it free?" answer ARE its panel
    // note, one string, so the per-call sentence is catalogue copy on
    // Summarize, Chat and Extract. Paired on purpose: it must now be found
    // there, and — like every capability here — never be hedged.
    subject: /\bread cap\b|one run never counts|reads no more of/i,
    catalogueCopy: true,
  },
  pptxPresentationChain: {
    // The EXPORT to PowerPoint, not PowerPoint to PDF: the catalogue's names
    // for it, AND any sentence saying the .pptx opens (or is refused) in
    // PowerPoint or is a complete presentation — the sentences a hedge about
    // this capability would actually sit in.
    //
    // The first version had only the names. It was measured on main's
    // catalogue (15 sentences about PowerPoint, slides or PPTX), matched all 7
    // of pdf-to-powerpoint's and none of powerpoint-to-pdf's, and was blind to
    // "Not at the moment. Opened in PowerPoint's Windows desktop app, it is
    // refused…" — a sentence written for this tool's page that same day. A
    // right pattern over the wrong set. Re-measured 2026-09-27 on both sets:
    // main 7/7 export sentences, 0/8 powerpoint-to-pdf; with the authored page
    // content (seo/content) 11/18 export sentences, 0/22 powerpoint-to-pdf, 0
    // from any other tool. Re-measured 2026-10-09 on the integration branch it
    // merged into (seo/content and the 2026-10-08 copy in): 15/23 of
    // pdf-to-powerpoint's entries that name PowerPoint, PPTX or slides,
    // 0/26 of powerpoint-to-pdf's, 0 from any other tool or guide.
    //
    // 2026-10-09, after the six deferrals were rewritten: the new FAQ answer
    // to "Will the .pptx open in PowerPoint?" — the one sentence most about
    // this capability — fell OUTSIDE the subject. "PowerPoint 16.0 for Windows
    // opened a .pptx" put a dot inside both gaps (`[^.?!]` stops at "16.0" and
    // at ".pptx"), and "PowerPoint opens it" fell to `open\b`, which "opens"
    // does not satisfy. So the gaps now let a dot through when a word follows
    // it, and the verbs take their inflections. Re-measured on both copies:
    // the old one 15/23 (unchanged, all six deferrals among them), the new
    // one 11/23 including that answer, 0/26 of powerpoint-to-pdf's and 0
    // from any other tool or guide on either.
    //
    // Since the review of 2026-10-09 the pdf-to-powerpoint page is read WHOLE
    // (`ownPages`), so on that page this pattern no longer decides what is
    // read. It still decides it everywhere else — another tool's page, a
    // guide — and "the subject still reaches the FAQ answer that needed its
    // widening" pins the widening above, which nothing else would now miss.
    subject:
      /PDF to PowerPoint|pdf to (?:pptx|slides)|editable (?:PowerPoint )?slides?|\.pptx\b(?:[^.?!]|\.(?=\w)){0,40}\bopen|\bopen(?:s|ed)?\b(?:[^.?!]|\.(?=\w)){0,40}\bPowerPoint\b|\bPowerPoint\b(?:[^.?!]|\.(?=\w)){0,40}\b(?:open(?:s|ed)?|refus(?:e[sd]?|ing)|reject(?:s|ed|ing)?)\b|slide master|complete presentation/i,
    catalogueCopy: true,
  },
  pptxPictures: {
    // Added 2026-10-10 with the key. The sentences a hedge about it would sit
    // in: a slide carrying a page's picture(s), in either order within one
    // sentence. Measured that day over the whole corpus (3,046 entries): 14
    // members, every one on pdf-to-powerpoint (tagline, description, seoTitle,
    // metaDescription, intro[0], intro[2], how[0], the three use cases and
    // four FAQ answers); none on powerpoint-to-pdf, another tool or a guide,
    // and no FAQ question. It owns no page (no tool is NAMED for pictures on
    // slides); the PDF to PowerPoint page is read whole through the chain's
    // subject anyway. catalogueCopy is true because those 14 exist.
    subject:
      /\bpictures?\b(?:[^.?!]|\.(?=\w)){0,80}\bslides?\b|\bslides?\b(?:[^.?!]|\.(?=\w)){0,80}\bpictures?\b/i,
    catalogueCopy: true,
  },
  docxPictures: {
    // Added 2026-10-17 with the key. The sentences a hedge about it would sit
    // in: a picture and Word (or DOCX) in one sentence, either order.
    // Measured that day over the whole corpus (3,048 entries): 11 members —
    // 9 on pdf-to-word (tagline, description, seoTitle, metaDescription,
    // intro[0], how[1] and three FAQ answers), the add-text guide's pointer
    // to PDF to Word (sections[2]), and one word-to-pdf FAQ answer about the
    // pictures in a Word file, where a hedge would be just as wrong; no FAQ
    // question. With "document" as well as Word and DOCX it also caught a
    // Markdown answer about emoji and a JPG guide, about nothing here, so
    // "document" is not in it. It owns no page (no tool is NAMED for pictures
    // in Word documents); catalogueCopy is true because those exist.
    subject:
      /\bpictures?\b(?:[^.?!]|\.(?=\w)){0,80}\b(?:Word|DOCX)\b|\b(?:Word|DOCX)\b(?:[^.?!]|\.(?=\w)){0,80}\bpictures?\b/i,
    catalogueCopy: true,
  },
  docxRunStyles: {
    // Added 2026-11-15 with the key (backlog #28, slice 1). The sentences a
    // hedge about it would sit in: a word's formatting — bold, italics,
    // size, colour — and Word (or DOCX) in one sentence, either order.
    // CASE-SENSITIVE: with the i flag "word" matched Split PDF's "a word on
    // the page" beside "file size" (four members, about nothing here). The
    // third branch is the page's own sentence shape ("Each word keeps its
    // bold…"), which names no Word: without it the intro walked past.
    // Measured that day over the whole corpus: see "the docxRunStyles
    // subject reaches the Word formatting sentences". catalogueCopy is true
    // because those exist.
    subject:
      /\b(?:[Bb]old|[Ii]talics?|[Ss]izes?|[Cc]olou?rs?)\b(?:[^.?!]|\.(?=\w)){0,120}\b(?:Word|DOCX)\b|\b(?:Word|DOCX)\b(?:[^.?!]|\.(?=\w)){0,120}\b(?:[Bb]old|[Ii]talics?|text sizes?|[Cc]olou?rs?)\b|\b(?:[Ee]ach word|[Ww]ords) keep\w*\s+(?:its|their)\s+bold\b/,
    catalogueCopy: true,
  },
  docxTables: {
    // Added 2026-11-15 with the key (backlog #28, slice 2: tables). The
    // sentences a hedge about it would sit in: a table and Word (or DOCX) in
    // one sentence, either order, and the page's own shape "comes through
    // as a Word table". CASE-SENSITIVE, like docxRunStyles: "word" in lower
    // case is any word. Measured that day over the whole corpus: see "the
    // docxTables subject reaches the Word table sentences". catalogueCopy is
    // true because those exist.
    subject:
      /\b[Tt]ables?\b(?:[^.?!]|\.(?=\w)){0,120}\b(?:Word|DOCX)\b|\b(?:Word|DOCX)\b(?:[^.?!]|\.(?=\w)){0,120}\b[Tt]ables?\b|\bcomes? through as a Word table\b/,
    catalogueCopy: true,
  },
  docxTypefaces: {
    // Added 2026-11-15 with the key (backlog #28, slice 4: typeface by
    // kind). The sentences a hedge about it would sit in: a typeface or font
    // and Word, DOCX or Office in one sentence, either order — the page's
    // own shapes ("set in a font that comes with Windows or Office", "in
    // standard Office fonts", "in reading order and Office fonts").
    // CASE-SENSITIVE, like docxTables: "word" in lower case is any word.
    // Measured that day over the whole corpus: see "the docxTypefaces
    // subject reaches the Word typeface sentences". catalogueCopy is true
    // because those exist.
    subject:
      /\b(?:[Tt]ypefaces?|[Ff]onts?)\b(?:[^.?!]|\.(?=\w)){0,120}\b(?:Word|DOCX)\b|\b(?:Word|DOCX)\b(?:[^.?!]|\.(?=\w)){0,120}\b(?:[Tt]ypefaces?|fonts?)\b|\bstandard Office fonts?\b|\band Office fonts\b|\bset in (?:a font that comes|fonts that come) with Windows or Office\b/,
    catalogueCopy: true,
  },
  docxTableWraps: {
    // Added 2026-11-16 with the key (backlog #28, slice 3: wraps). The
    // sentences a hedge about it would sit in: a wrap and a table and Word
    // (or DOCX) in one sentence, either order, and the shape "stays in its
    // row". CASE-SENSITIVE, like docxTables: "word" in lower case is any
    // word. Measured that day over the whole corpus: see "the
    // docxTableWraps subject reaches the Word wrapped-cell sentences".
    // catalogueCopy is true because those exist.
    subject:
      /\bwrap\w*\b(?:[^.?!]|\.(?=\w)){0,160}\b(?:Word|DOCX)\b(?:[^.?!]|\.(?=\w)){0,40}\btables?\b|\b(?:Word|DOCX)\b(?:[^.?!]|\.(?=\w)){0,40}\btables?\b(?:[^.?!]|\.(?=\w)){0,160}\bwrap\w*\b|\bstays? in (?:its|their) row\b/,
    catalogueCopy: true,
  },
  translateOcr: {
    // Added 2026-11-09 with the key (audit translate-pdf#3). The sentences a
    // hedge about it would sit in: a scan recognised ON OUR SERVER, the way
    // Translate's copy says it (`TRANSLATE_SCAN_ROUTE`, "recognised on our
    // server first"). Not bare "recognise": OCR PDF's own page recognises
    // text everywhere, and is the `ocr` subject's. Measured that day — see
    // "the translateOcr subject reaches Translate's scan sentences".
    subject:
      /recogni[sz]es? the text on our server|recogni[sz]ed on our server first|scan[^.?!]{0,80}recogni[sz]ed on our server/i,
    catalogueCopy: true,
  },
  htmlZip: {
    // Added 2026-11-14 with the key (competitor audit #26). The sentences a
    // hedge about it would sit in: HTML to PDF taking a ZIP of a page, the
    // way its copy says it ("when our server can open ZIP files", "a ZIP of
    // the page with its files", "the drop zone says whether it takes a ZIP").
    // Not bare "ZIP": half the catalogue DELIVERS a ZIP ("arrive as a ZIP"),
    // which is no claim about this capability.
    subject:
      /\bopen ZIP files\b|\bZIP of (?:a|the) page\b|\btakes? a ZIP\b|\bzip the page\b/i,
    catalogueCopy: true,
  },
  chatRetrieval: {
    // Added 2026-11-16 with the key (competitor audit wave 2 #30, slice 3).
    // The sentences a hedge about it would sit in: which pages of a longer
    // file Chat with PDF reads for a question — "how far into the document
    // the reading got", "read up to that point only", "names the pages that
    // were read" (since hedged to "says that only part of it was read,
    // naming the pages when it can"), "How much of my PDF does Chat with
    // PDF read?". Measured
    // that day over the whole corpus: see "the chatRetrieval subject reaches
    // the chat reading sentences". catalogueCopy is true because those exist.
    //
    // Slice 4 (2026-11-16): the static copy now SAYS how pages are chosen
    // ("share the most of the question's less common words"; since review,
    // conditional: "when some pages share enough of …"), so that shape
    // is in the subject: the claim is read as a claim about this key. See
    // "the static page-selection claim is a member of its capability's
    // subject".
    subject:
      /\bhow far into the document\b|\bread up to that point\b|\bpages? that (?:were|was) read\b|\bwhich page it reached\b|\bHow much of my PDF does Chat with PDF read\b|\bpages? (?:are|is) chosen\b|\bonly part (?:of (?:it|the document) )?was read\b|\bshares? (?:the most|enough)\b[^.?!]*\bwords\b/i,
    catalogueCopy: true,
  },
  summarizePages: {
    // Added 2026-11-16 with the key (audit summarize-pdf#5, slice 5). The
    // sentences a hedge about it would sit in: summarizing the pages or the
    // bookmarked section a reader chooses. Not bare "page range": Split,
    // Extract and a dozen other tools take one, which is no claim about
    // this capability. `false` while PR 5a ships no such sentence; PR 5b,
    // which adds the advertisement after the key is observed, flips it.
    //
    // FLIPPED 2026-11-16 (PR 5b): production published `summarizePages:
    // true` and a real job sent only the chosen pages, so the intro, a FAQ
    // answer and the guide now say a reader can
    // "choose pages or a bookmarked section" (`SUMMARIZE_PAGE_CHOICE`).
    // The FAQ QUESTION "Can I summarize only some pages?" joined the
    // subject: a bare "Not yet." answer is read against its question
    // (`faqPairs`), so the question must be a member. See "the static
    // page-choice advertisement is a member of its capability's subject".
    subject:
      /\bsummar\w*[^.?!]{0,60}\b(?:pages? you cho(?:o)?se|chosen pages|bookmarked section|a page range)\b|\bchoose pages or a bookmarked section\b|\bsummar\w* only some pages\b|\bonly the part you choose\b/i,
    catalogueCopy: true,
  },
  translatePdfLanguages: {
    // Added 2026-11-15 with the key (competitor audit #29, slice 1). The
    // sentences a hedge about it would sit in: Translate's reflowed PDF of
    // the translation, the way its copy says it ("a reflowed PDF of the same
    // text comes with it"). Not bare "PDF": every page names one. Measured
    // that day — see "the translatePdfLanguages subject reaches Translate's
    // PDF sentence".
    subject: /\breflowed PDF\b/i,
    catalogueCopy: true,
  },
  translateReadingOrder: {
    // Added 2026-11-16 with the key (competitor audit #29, slice 3: reading
    // order). The sentence a hedge about it would sit in: Translate's
    // column-order disclosure, the way its copy says it ("compare the order
    // of the translated paragraphs with the original", "the two columns'
    // lines ... to the model"). NOT bare "two-column": PDF to Word's copy
    // says it, and that is not this capability. Measured that day — see "the
    // translateReadingOrder subject reaches Translate's column-order
    // sentence".
    //
    // Slice 5 (2026-11-16): the copy now CLAIMS the order
    // (`TRANSLATE_COLUMN_ORDER`: "A two-column page is usually read column
    // by column. Some pages are read line by line across the columns
    // instead"), so those shapes joined ("usually" optional since the
    // 2026-11-16 review). The old shapes stay, so a hedge written in the
    // retired wording is still read as about this key.
    subject:
      /translated paragraphs with the original|columns' lines (?:reach|to) the model|\btwo-column pages? (?:is|are) (?:usually )?read column by column\b|\bline by line across the columns\b/i,
    catalogueCopy: true,
  },
  translatePageMap: {
    // Added 2026-11-16 with the key (competitor audit #29, slice 4: page
    // markers). The sentence a hedge about it would sit in: Translate's PDF
    // heading each page of the original. Kept off compare-pdf's "headed with
    // its page", the page-label prose in extract/merge/organize, and
    // pdf-to-markdown's page headings: "translat…" must come first, or "page
    // heading(s)" must be followed by "translat…". See "the translatePageMap
    // subject".
    //
    // FLIPPED 2026-11-16 (slice 5): was `catalogueCopy: false` — no shipped
    // sentence described page headings, so the coverage check REQUIRED this
    // to match nothing. Slice 5 wrote the first one
    // (`TRANSLATE_PAGE_HEADINGS`: "In the PDF, each page's translation
    // usually comes under its own heading, …"), after the key was observed
    // live.
    subject:
      /\btranslat[^.]{0,80}\b(?:heads?|headed|headings?)\b[^.]{0,40}\bpages?\b|\bpage headings?\b[^.]{0,60}\btranslat/i,
    catalogueCopy: true,
  },
  translatePageRange: {
    // Added 2026-11-16 with the key (competitor audit #29, slice 6: page
    // ranges). The sentences a hedge about it would sit in: translating the
    // pages a reader chooses, shaped for the advertisement slice 7 writes
    // ("Enter a page range and translate the rest tomorrow"). FALSE: no
    // shipped sentence offers it, so "each subject matcher's declared
    // catalogue coverage is the truth" REQUIRES this to match nothing, and
    // slice 7 flips it on purpose. Kept off Split, Extract and Delete pages
    // ("page range" with no "translat…"): "translat…" must come first, or
    // the whole phrase "enter a page range … translat…" must appear. See
    // "the translatePageRange subject".
    //
    // FLIPPED 2026-11-17 (slice 7): production published
    // `translatePageRange: true` and a real pages-"2, 4" job sent only those
    // pages, so the intro, two FAQ answers, the served "How much of my PDF"
    // fact and the guide now say a reader can "choose which pages to
    // translate" (`TRANSLATE_PAGE_CHOICE`). Those shapes joined
    // (`TRANSLATE_PAGE_CHOICE_SHAPES`): the advertisement, the FAQ QUESTION
    // "Can I translate only some pages?" (a bare "Not yet." answer is read
    // against its question, `faqPairs`) and "only the pages you choose".
    // Members pinned in "the translatePageRange subject".
    subject:
      /\btranslat[^.]{0,80}\b(?:page ranges?|pages? you (?:choose|chose|enter)|choose (?:which )?pages)\b|\benter a page range\b[^.]{0,60}\btranslat|\bchoose which pages to translate\b|\btranslat\w* only some pages\b|\bonly the pages you choose\b/i,
    catalogueCopy: true,
  },
  csvImportOptions: {
    // Added 2026-11-17 with the key (competitor audit #18). The sentences
    // about how a CSV's separator or character set is chosen or read: a
    // "delimiter", "separator" or "character set" within one sentence of
    // "CSV", in either order, a setting's own name followed by "Auto", both
    // settings' names in one sentence, or a CSV that came out as one column
    // (the FAQ question; its answer names the settings).
    // TRUE: Excel to PDF's use case and step, and its guide's section and
    // FAQ, say the settings appear for a .csv, with no hedge. Members
    // pinned in "the csvImportOptions subject".
    subject:
      /\bcsv\b[^.]{0,160}\b(?:delimiter|separator|character set)s?\b|\b(?:delimiter|separator|character set)s?\b[^.]{0,160}\bcsv\b|\b(?:Delimiter|Character set)\b[^.]{0,40}\bAuto\b|\bDelimiter\b[^.]{0,80}\bCharacter set\b|\bcsv\b[^.]{0,60}\bone column\b/i,
    catalogueCopy: true,
  },
  ocrOwnerPassword: {
    // Added 2026-11-17 with the key (competitor-audit backlog #11). The
    // sentences about OCR and a restricted PDF's owner password, in either
    // order within one sentence, or the field's own name.
    // TRUE: OCR PDF's use case says the field appears when our server can
    // use the password and what to do when it does not, with no hedge.
    // Members pinned in "the ocrOwnerPassword subject".
    subject:
      /\bOCR\b[^.]{0,200}\bowner (?:\(permissions\) )?password\b|\bowner (?:\(permissions\) )?password\b[^.]{0,200}\bOCR\b|\bOwner password field\b/i,
    catalogueCopy: true,
  },
  requestSignatureLabels: {
    // Added 2026-11-18 with the key. The sentences about a box's label
    // reaching prepared.pdf: the word "tooltip", or a label and prepared.pdf
    // in either order within one sentence (`\.(?=\w)` lets "prepared.pdf"
    // and "README.txt" through a gap that otherwise stops at a full stop).
    // TRUE: Request Signatures' FAQ answer about field names says each
    // label is also its box's tooltip, with no condition. Until 2026-11-18
    // it said "If README.txt lists your labels under each signer,
    // prepared.pdf carries them too", which the `if … too` shape below was
    // cut from. Members pinned in "the requestSignatureLabels subject".
    subject:
      /\btooltips?\b|\blabels?\b(?:[^.?!]|\.(?=\w)){0,160}\bprepared\.pdf\b|\bprepared\.pdf\b(?:[^.?!]|\.(?=\w)){0,160}\blabels?\b/i,
    catalogueCopy: true,
  },
  htmlAdBlock: {
    // Added 2026-11-22 with the key (audit wave 2 webpage-to-pdf#1). The
    // sentences about ads on a captured page: the option's own name, or
    // ads, adverts or advertisements.
    // TRUE: Webpage to PDF's FAQ answer says what Hide common ads blocks and
    // hides, with no hedge (the panel shows the box only on a worker that
    // proves it).
    subject: /\bHide common ads\b|\bads\b|\badverts?\b|\badvertisements?\b/i,
    catalogueCopy: true,
  },
  pdfaUnicodeDocInfo: {
    // Added 2026-11-22 with the key (audit wave 2 pdf-to-pdfa#3). The
    // sentences about a PDF/A copy's carried document properties: the
    // carried-fields words, DOCINFO, or a field "carried" with accents or
    // brackets named.
    // TRUE: CARRIED_DOCINFO_RULE on PDF to PDF/A's intro, FAQ, facts and
    // guide says fields with accents and brackets are carried, with no
    // hedge (the panel's notes state it only on a worker that proves it).
    subject:
      /\btitle, author, subject and keywords\b|\bDOCINFO\b|\bcarried\b[^.]{0,120}\b(?:accented|brackets?)\b/i,
    catalogueCopy: true,
  },
};

/* ------------------------------------------------------------------ *
 *  Hedge shapes, and the corpus that proves each one bites.
 * ------------------------------------------------------------------ */

/**
 * The SHAPE of a deferral, not the one spelling that shipped. Every entry is
 * exercised against {@link HEDGES_IN_THE_WILD} below, because a pattern nothing
 * matches is decoration — and after today's fix the live catalogue contains no
 * hedge at all, so the live corpus cannot be what exercises them.
 */
const HEDGES: Record<string, RegExp> = {
  "coming soon": /\bcoming\s+soon\b/i,
  // NOT a bare `\bsoon\b`: the false-positive control caught it firing on
  // "Files are deleted as soon as the job finishes", where `as soon as` is an
  // immediacy idiom and the opposite of a deferral. Both sides are excluded
  // because the idiom can be split either way by a line wrap.
  soon: /(?<!\bas\s)\bsoon\b(?!\s+as\b)/i,
  "not yet": /\bnot\s+yet\b/i,
  "does not yet": /\b(?:does|do|is|are|can|will)(?:n['’]t|\s+not)\s+yet\b/i,
  planned: /\bplanned\b/i,
  "in the works": /\bin\s+the\s+works\b/i,
  "on the way": /\bon\s+the\s+way\b/i,
  upcoming: /\bupcoming\b/i,
  eventually: /\beventually\b/i,
  roadmap: /\broadmap\b/i,
  "will be available": /\bwill\s+(?:be|soon\s+be)\s+\w*\s*available\b/i,
  "not available yet": /\bnot\s+(?:currently\s+)?available\b/i,
  "for now": /\bfor\s+now\b/i,
  "at this time": /\bat\s+this\s+time\b/i,
  // `for` earned its place in mutation 1: "planned for a future release" was
  // caught only by `planned`, and a one-pattern catch is a pattern away from a
  // miss.
  "in a future": /\b(?:in|at|for)\s+an?\s*future\b|\b(?:in|at|for)\s+future\b/i,
  "work in progress": /\bwork[- ]in[- ]progress\b|\bbeta\s+soon\b/i,
  // ── the six below, added 2026-10-09: one for each deferral the PDF to
  // PowerPoint page SHIPPED that every shape above let through (see
  // PPTX_DEFERRALS_SHIPPED and the docblock). Each is the SHAPE of its shipped
  // sentence, widened to the obvious respellings, and each is held off the
  // honest prose that sits nearest it by a NOT_HEDGES control.
  //
  // "Not at the moment." — and "not currently", which `not available yet`
  // only catches when "available" follows.
  "not at the moment":
    /\bnot\s+(?:at\s+(?:the\s+moment|present)|right\s+now|currently)\b/i,
  // "PowerPoint for Windows currently rejects the file". A NOW word followed,
  // within the same clause, by a refusal. Not a bare `currently`: the unlock
  // guide's "the password that currently opens the file" is honest, and so is
  // "this tool currently writes" — a now-word is a hedge only when what it
  // dates is a NO. The clause stops at a comma, because "currently opens the
  // file, and it cannot recover…" is two claims, the second honest.
  "currently refuses":
    /\b(?:currently|at\s+the\s+moment|at\s+present|right\s+now|presently)\b[^.?!,;]{0,30}?\b(?:rejects?|refuses?|cannot|can['’]t|won['’]t|fails?\s+to|does\s+not|doesn['’]t|will\s+not|is\s+not|isn['’]t)\b/i,
  // "Until that is fixed". Singular and demonstrative on purpose: Create
  // Fillable Forms' "stays disabled until they are fixed" is about the
  // reader's own warnings, and is honest.
  "until … is fixed":
    /\buntil\s+(?:that|this|it)\s+(?:is|gets|has\s+been)\s+(?:fixed|resolved|repaired|sorted|addressed)\b/i,
  // "Until the .pptx opens". The verb is what makes it a deferral: "until the
  // job finishes", "until the conversion finishes" and "until it has been
  // unlocked" are the honest neighbours, and none of them waits on the
  // product. `\.(?=\w)` lets ".pptx" through, which a bare `[^.]` cut in half
  // — the first measurement of this shape matched nothing for that reason.
  "until … opens":
    /\buntil\s+(?:it|the\s+(?:[^.?!,;]|\.(?=\w)){1,30}?)\s+(?:opens?|works?|ships?|lands?)\b/i,
  // "PowerPoint will not open it yet". `not yet` and `does not yet` need the
  // two words side by side; a verb and an object between them walked past
  // both. Contractions and "cannot" are the same sentence respelled.
  // Up to FIVE words between, not three: on 2026-10-09 a mutation of the page
  // planted "It will not open in every app yet." (four) and stayed green.
  // Measured then over every tool and guide entry: five adds no match to the
  // three the old bound already made (extract-images twice, the flatten
  // guide once, none in any capability's scope).
  "not … yet": /\b(?:not|cannot|\w+n['’]t)\s+(?:\w+\s+){1,5}yet\b/i,
  // "While PowerPoint refuses that file, take the text from…". A SENTENCE-
  // INITIAL while, dating a refusal to open. Mid-sentence ", while … do not"
  // is contrast, not time: HTML to PDF's "while the styling and pictures in
  // that folder do not" is honest, and so is "While the job runs, the button
  // reads…".
  // ── added 2026-11-18, from the one Request Signatures shipped
  // (REQUEST_SIGNATURE_LABEL_HEDGE_SHIPPED): a capability claim made
  // CONDITIONAL on something the reader must check in the output first — "If
  // README.txt lists your labels under each signer, prepared.pdf carries them
  // too". It defers nothing in time, so no shape above saw it, yet it hands
  // the reader the job of adjudicating a live capability. The if-clause's
  // subject is an output (a file name, or the package, download, output,
  // result, README or manifest) and its verb reads that output; the main
  // clause adds the claim with "too" or "as well". Not a bare sentence-
  // initial "If": "If you write a message, it goes into README.txt" waits on
  // the reader's own choice, and is honest (NOT_HEDGES holds those).
  "if … too":
    /(?:^|[.?!;:]\s+)If\s+(?:(?:your|the)\s+)?(?:[\w-]+\.(?:txt|json|pdf|zip|docx|pptx|xlsx)|README|manifest|package|download|output|result|ZIP)\b[^.?!,;]{0,30}?\b(?:lists?|shows?|carr(?:y|ies)|contains?|includes?|has|have|names?|mentions?)\b(?:[^.?!]|\.(?=\w)){0,160}?\b(?:too|as\s+well)\b/i,
  "while … refuses":
    /(?:^|[.?!;:]\s+)while\s+(?:[^.?!,;]|\.(?=\w)){1,40}?\b(?:refuses?|rejects?|(?:won['’]t|will\s+not|cannot|can['’]t|does\s+not|doesn['’]t|fails?\s+to)\s+open)\b/i,
};

/**
 * The tool pages a capability OWNS: those whose NAME its subject matches.
 *
 * A subject recognises sentences ABOUT a capability, and on the page named for
 * it every sentence is — step 4 of PDF to PowerPoint is about the .pptx
 * whether or not it says "PowerPoint". Read from the `name` entries of the
 * copy it is given, so a control passes its own; guides have a `title`, not a
 * `name`, and own nothing (a guide is a task, not a capability's page).
 * Measured 2026-10-09: `ocr` owns ocr-pdf and `pptxPresentationChain` owns
 * pdf-to-powerpoint; no other capability owns a page, and both pages, read
 * whole, carry no hedge.
 */
function ownPages(subject: RegExp, copy: readonly CopyEntry[]): Set<string> {
  return new Set(
    copy
      .filter((entry) => entry.where === "name" && subject.test(entry.text))
      .map((entry) => entry.slug),
  );
}

/**
 * THE RULE, as a function so its control runs through the same code. Every
 * entry about a capability, every entry on a page named for one, and every
 * answer whose QUESTION is about one, is read for a deferral.
 */
function hedgeOffenders(
  copy: readonly CopyEntry[],
  pairs: readonly FaqPair[],
): string[] {
  const offenders: string[] = [];
  const hedgesIn = (text: string) =>
    Object.entries(HEDGES)
      .filter(([, re]) => re.test(text))
      .map(([shape]) => shape);
  for (const key of WIRE_KEYS) {
    const pairing = SUBJECTS[key];
    // A capability with no subject matcher is a capability this rule cannot
    // see. The pairing test already fails on it; skipping silently here would
    // leave the rule green on the same hole, and a green next to a red is how
    // a hole gets argued away.
    if (!pairing) {
      offenders.push(
        `${key} has no subject matcher, so nothing about it is read`,
      );
      continue;
    }
    const { subject } = pairing;
    const owned = ownPages(subject, copy);
    for (const entry of copy) {
      if (!owned.has(entry.slug) && !subject.test(entry.text)) continue;
      for (const shape of hedgesIn(entry.text))
        offenders.push(
          `${entry.slug} ${entry.where} hedges "${key}" with "${shape}": "${entry.text}"`,
        );
    }
    for (const pair of pairs) {
      // An answer on an owned page, or already in the subject, was read above.
      if (
        owned.has(pair.slug) ||
        !subject.test(pair.question) ||
        subject.test(pair.answer)
      )
        continue;
      for (const shape of hedgesIn(pair.answer))
        offenders.push(
          `${pair.slug} ${pair.where} answers a question about "${key}" with "${shape}": "${pair.answer}"`,
        );
    }
  }
  return offenders;
}

/** The shapes cut from {@link PPTX_DEFERRALS_SHIPPED}; each must catch one of THEM. */
const SHAPES_FROM_THE_PPTX_PAGE: readonly string[] = [
  "not at the moment",
  "currently refuses",
  "until … is fixed",
  "until … opens",
  "not … yet",
  "while … refuses",
];

/**
 * The six deferrals the PDF to PowerPoint page served at 9f2a2efb, VERBATIM as
 * the page's own accessors returned them (`pageContent`, `pageIntro`,
 * `pageUseCases`, `pageSteps`, `pageFaq`), with the 60-minute TTL as rendered.
 * Every one matches the `pptxPresentationChain` subject, and until 2026-10-09
 * not one matched a single shape in {@link HEDGES} — so the rule test passed
 * over all six. They are the corpus the six newest shapes were cut from, and
 * the inverted test below holds both halves: still caught, and gone.
 */
const PPTX_DEFERRALS_SHIPPED: readonly {
  readonly where: string;
  readonly text: string;
}[] = [
  {
    where: "metaDescription",
    text: "Export a PDF's selectable text to .pptx, one slide per page. PowerPoint for Windows currently rejects the file as corrupted; read why before you convert.",
  },
  {
    where: "intro[1]",
    text: "Read this before relying on it: the Windows desktop version of Microsoft PowerPoint refuses to open the file this tool currently writes, reporting it as corrupted and unreadable. PowerPoint for Mac and the web, Google Slides, Keynote and LibreOffice Impress have not been tested, so pdf.xyz cannot tell you whether they accept it. Until that is fixed, PDF to Text is the working route to a PDF's words; it runs in your browser, and nothing is uploaded.",
  },
  {
    where: "useCases[0].body",
    text: "The export is built to put each page's wording back on a slide of its own. While PowerPoint refuses that file, take the text from PDF to Text instead and paste it into your template; pages there are divided only by a blank line, so keep the PDF open to see where each one ends.",
  },
  {
    where: "useCases[1].body",
    text: "Because one page becomes one slide, a report's page order becomes a talk's running order. Until the .pptx opens, copy the report's words out with PDF to Text and trim them down to what you will actually say.",
  },
  {
    where: "how[3]",
    text: "Save the .pptx. \"Your PPTX file is ready.\" appears with a Download button labelled with the output's name: your PDF's name, ending in .pptx. The page has already pulled the file into the tab, so that button saves it from there; the worker's own copy becomes unreachable after 60 minutes. Remember that PowerPoint will not open it yet.",
  },
  {
    where: "faq[0].answer",
    text: "Not at the moment. Opened in PowerPoint's Windows desktop app, it is refused as corrupted and unreadable. No other presentation app has been checked. Meanwhile, copy the words out with PDF to Text and paste them onto your slides.",
  },
];

/**
 * The conditional hedge Request Signatures served from PR #364 (2026-11-17)
 * to 2026-11-18, VERBATIM as `pageFaq` returned it, inside its FAQ answer
 * about field names. It conditioned the tooltip on README.txt listing the
 * labels because an older worker image wrote neither, and no worker could
 * then report which it was; since `requestSignatureLabels` it can, so the
 * sentence became a static string adjudicating a live capability. Inverted,
 * not deleted: still caught by `if … too`, and gone from the catalogue.
 */
const REQUEST_SIGNATURE_LABEL_HEDGE_SHIPPED =
  "If README.txt lists your labels under each signer, prepared.pdf carries them too, as each box's tooltip, which many PDF viewers, Firefox among them, show when you point at the box.";

/**
 * Sentences that ARE deferrals — the positive control for every pattern above.
 *
 * The first entry is the real one. Per house rule 7 a test that pinned a defect
 * is inverted rather than deleted, so the sentence `catalog.ts` actually shipped
 * for forty days stays here as evidence, and the assertions about it now run the
 * other way: the detector must still catch it, and the catalogue must no longer
 * contain it. The PDF to PowerPoint page's six follow it, under the same terms.
 */
const HEDGES_IN_THE_WILD: readonly string[] = [
  // ── the shipped defect, kept as the fixture it became ──
  "For image-heavy files, deep compression runs on a secure worker (coming soon).",
  // ── the second shipped defect: six deferrals no shape caught ──
  ...PPTX_DEFERRALS_SHIPPED.map((shipped) => shipped.text),
  // ── those six, respelled the ways that would walk past their own shapes ──
  "PowerPoint won't open the file yet.",
  "It will not open in every app yet.",
  "At the moment PowerPoint refuses the file.",
  "PowerPoint does not currently open the .pptx.",
  "Until this is resolved, copy the words out with PDF to Text.",
  "Use PDF to Text until the export works in PowerPoint.",
  "While PowerPoint cannot open the file, copy the words from PDF to Text.",
  // ── the third shipped defect: a capability made conditional on the output ──
  REQUEST_SIGNATURE_LABEL_HEDGE_SHIPPED,
  // ── it, respelled the ways that would walk past its own shape ──
  "If your README shows the labels, the PDF has them as well.",
  "If manifest.json includes each label, prepared.pdf names the boxes too.",
  "Your file keeps them. If the download lists them, prepared.pdf carries the labels too.",
  // ── the same claim, spelled the ways that would walk past a literal search ──
  "Deep compression will be available soon.",
  "Deep image compression is not yet enabled on the worker.",
  "Deep compression does not yet run here.",
  "Deep compression is planned for the secure worker.",
  "Deep compression is in the works.",
  "Deep compression is on the way.",
  "Deep compression is an upcoming feature.",
  "We will eventually run deep compression on the worker.",
  "Deep compression is on the roadmap.",
  "Deep compression is not currently available.",
  "Lossless only for now.",
  "Deep compression is unavailable at this time.",
  "Deep compression arrives in a future release.",
  "Deep compression is work-in-progress.",
];

/**
 * Sentences that must NOT read as deferrals — the false-positive control.
 *
 * A copy guard that cries wolf is a guard the next person weakens, so the
 * near-misses are pinned explicitly: real catalogue prose that contains a
 * hedge-adjacent word in an entirely honest sentence.
 */
const NOT_HEDGES: readonly string[] = [
  "Deep image downsampling runs on a secure, auto-deleting worker.",
  "Lossless structural repack always runs in your browser; deep image compression is an optional, clearly-labeled secure-worker step that needs a native engine.",
  "Every page is scanned for embedded images, right in your browser.",
  "The secure worker processes the file and deletes the input when the job finishes.",
  "Your file is available to download for 30 minutes.",
  "Files are deleted as soon as the job finishes.",
  "Choose your options.",
  // ── the near-misses of the 2026-10-09 shapes, each the honest catalogue
  // sentence (shortened where long) that sits closest to one of them ──
  // `currently refuses`: a now-word dating a YES.
  "Unlock PDF needs the password that currently opens the file.",
  // `until … opens` / `until … is fixed`: waits on the job, or on the reader.
  "The password rides along in the job request, where it waits in the job queue until the job finishes.",
  "Stay online until the conversion finishes; saving the finished file needs no connection.",
  "Any encrypted PDF is refused until it has been unlocked, including a file your viewer shows with no password prompt.",
  "Problems such as a duplicate name, a radio group with one option or a box running off the page appear in red on that card, and “Create form” stays disabled until they are fixed.",
  // `not … yet`: "yet" as a conjunction, and a "yet" the live badge decides.
  "Some PDFs need no password to view yet still block printing or copying, because an owner password sets those permissions.",
  // (WP-10 rewrote the shipped sentence: the box now takes a file at once.)
  "If it says Not enabled or Status unknown, nothing can be sent yet.",
  // `while … refuses`: while as time with no refusal, and while as contrast.
  "While the job runs, the button reads Uploading your file…, Waiting for the worker…, Extracting tables… and Downloading the result… in turn.",
  "Only the .html travels here, so text written into the markup survives, while the styling and pictures in that folder do not.",
  // `if … too`: an if-clause that waits on the READER's choice, or on the
  // input, not on what the output turned out to carry.
  "If you write a message, it goes into README.txt and manifest.json too.",
  "If your PDF has a form, its fields are kept too.",
  "If README.txt is missing, unzip the package again.",
  "If manifest.json lists a field, README.txt names its owner.",
];

describe("catalogue copy may not hedge a worker capability", () => {
  /* ---------------- health checks: neither set may quietly empty ------------ */

  it("the copy corpus is derived and plausibly sized", () => {
    // `[] ⊆ X` is vacuously true, so a corpus that silently shrank would report
    // the strongest possible pass. Bound it from below, and bound it per-tool so
    // a walk that found every tool but no prose is red too.
    expect(tools.length).toBeGreaterThanOrEqual(50);
    expect(COPY.length).toBeGreaterThanOrEqual(500);
    for (const tool of tools) {
      const mine = COPY.filter((entry) => entry.slug === tool.slug);
      expect(
        mine.length,
        `no copy discovered for ${tool.slug}`,
      ).toBeGreaterThan(4);
    }
    // The pairs are derived from COPY, so they are bounded against it: one
    // per question entry (a dropped question would shrink both silently, so
    // there is a floor too — 576 at 2026-10-09, over 72 pages).
    const questions = COPY.filter((entry) =>
      /^faq\[\d+\]\.question$/.test(entry.where),
    );
    expect(FAQ_PAIRS).toHaveLength(questions.length);
    expect(FAQ_PAIRS.length).toBeGreaterThanOrEqual(400);
  });

  it("the capability set is derived from the heartbeat, and both derivations agree", () => {
    // A second, independent bound. `emptyCapabilities()` is what a caller sees;
    // the wire keys are what a reader receives. A key in one and not the other
    // is a capability that either never ships or arrives unannounced.
    expect(WIRE_KEYS.length).toBeGreaterThanOrEqual(5);
    expect(WIRE_KEYS).toEqual(DEFAULT_KEYS);
  });

  /* ---------------- the corpus, in both directions -------------------------- */

  it("every heartbeat capability has a subject matcher", () => {
    // Direction A. A capability added to the heartbeat with no entry here would
    // be a capability this rule cannot see — the hole rule 1 exists to close.
    const unpaired = WIRE_KEYS.filter((key) => !(key in SUBJECTS));
    expect(
      unpaired,
      `the heartbeat gained these capabilities with no subject matcher here — decide whether the catalogue promises them:\n  ${unpaired.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no subject matcher describes a capability the heartbeat dropped", () => {
    // Direction A, mirrored: a matcher for a key nothing publishes any more is
    // decoration that will be read as coverage.
    const orphaned = Object.keys(SUBJECTS).filter(
      (key) => !WIRE_KEYS.includes(key),
    );
    expect(
      orphaned,
      `these subject matchers name capabilities the heartbeat no longer publishes:\n  ${orphaned.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the chatRetrieval subject reaches the chat reading sentences", () => {
    // Measured 2026-11-16, before slice 4 rewords any of them. The FAQ
    // QUESTION is the stable member (its answer and the intro are reworded
    // by this slice's static copy); the guide's "how far into the document"
    // and the answer's "read up to that point" were the subject's first
    // members. A subject that reaches only the chat page's own question is
    // still a subject: the page is not NAMED for retrieval, so nothing else
    // would read it.
    const subject = SUBJECTS.chatRetrieval!.subject;
    const members = COPY.filter((entry) => subject.test(entry.text));
    const chat = members.filter(
      (entry) =>
        entry.slug === "chat-with-pdf" ||
        entry.slug === "guide:how-to-chat-with-a-pdf",
    );
    expect(
      chat.some(
        (entry) =>
          entry.where.endsWith(".question") &&
          /Chat with PDF read\?$/.test(entry.text),
      ),
      chat.map((e) => `${e.slug} ${e.where}`).join("\n"),
    ).toBe(true);
    expect(
      chat.length,
      "the subject reaches one chat sentence at most: it is a name, not a subject",
    ).toBeGreaterThanOrEqual(2);
  });

  it("the static page-selection claim is a member of its capability's subject", () => {
    // Slice 4, the second bound (house rule 5). Static chat copy says how a
    // longer file's pages are chosen because production's worker proved it;
    // what makes that stale is a future image without the behaviour. The
    // claim is tied to the heartbeat key that image would have to publish
    // (`CHAT_PAGE_SELECTION_CAPABILITY`, `chatRetrieval`): the key is on the
    // wire, and EVERY sentence carrying the claim, read alone, is in that
    // key's subject, so the no-hedge rule and any later reader of the
    // subject see it as a claim about the key. `WIRE_KEYS` is derived from
    // this tree's source, NOT read from production: this ties the copy to
    // the key's name only. CI makes images it BUILDS prove the key
    // (`src/deploy/worker-chat-retrieval-proof.test.ts`); the live bound is
    // the operator's deploy verification, which reads production
    // `/api/worker/status` and fails unless `chatRetrieval` is true, and
    // lives outside this repo (see `src/lib/tools/chat-page-selection.ts`).
    const key = CHAT_PAGE_SELECTION_CAPABILITY;
    expect(WIRE_KEYS).toContain(key);
    const subject = SUBJECTS[key]?.subject;
    expect(subject, `no subject for ${key}`).toBeDefined();
    const claims = COPY.flatMap((entry) =>
      entry.text
        .split(/(?<=[.?!])\s+/)
        .filter((s) => CHAT_SELECTION_REQUIRED.pattern.test(s))
        .map((sentence) => ({ at: `${entry.slug} ${entry.where}`, sentence })),
    );
    // Health: the tool page's intro and reading FAQ, its read fact and the
    // guide carry it (measured 2026-11-16); a shrunken set passes vacuously.
    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(new Set(claims.map((c) => c.at.split(" ")[0]))).toEqual(
      new Set(["chat-with-pdf", "guide:how-to-chat-with-a-pdf"]),
    );
    const outside = claims
      .filter(({ sentence }) => !subject!.test(sentence))
      .map(({ at, sentence }) => `${at}: ${sentence}`);
    expect(outside).toEqual([]);
    // Positive control: a hedge planted in the claim is caught as a hedge
    // on this key, through the same rule the catalogue runs.
    const planted: CopyEntry = {
      slug: "chat-with-pdf",
      where: "intro[1]",
      // The guide's claim, whose sentence reaches the subject ONLY through
      // the selection branch (it says nothing about the notice).
      text: `${claims.find((c) => c.at.startsWith("guide:"))!.sentence.replace(/\.$/, "")} (coming soon).`,
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes(`hedges "${key}"`),
      ),
    ).toBe(true);
  });

  it("the static page-choice advertisement is a member of its capability's subject", () => {
    // PR 5b, the second bound (house rule 5), as for chat's page selection
    // above. Summarize's static copy says a reader can choose pages or a
    // bookmarked section because production's worker proved it; what makes
    // that stale is a future image without the behaviour. Every served
    // sentence carrying the advertisement (any shape in
    // `SUMMARIZE_PAGE_CHOICE_SHAPES`), read alone, is in the subject of
    // the key that image would have to publish
    // (`SUMMARIZE_PAGES_CAPABILITY`). `WIRE_KEYS` is derived from this
    // tree's source, NOT read from production: this ties the copy to the
    // key's name only. The live bound is the operator's deploy
    // verification, which reads production `/api/worker/status`, fails
    // unless `summarizePages` is true, and lives outside this repo (see
    // `src/lib/tools/summarize-page-choice.ts`).
    const key = SUMMARIZE_PAGES_CAPABILITY;
    expect(WIRE_KEYS).toContain(key);
    const subject = SUBJECTS[key]?.subject;
    expect(subject, `no subject for ${key}`).toBeDefined();
    const claims = COPY.flatMap((entry) =>
      entry.text
        .split(/(?<=[.?!])\s+/)
        .filter((s) =>
          SUMMARIZE_PAGE_CHOICE_SHAPES.some(({ pattern }) => pattern.test(s)),
        )
        .map((sentence) => ({ at: `${entry.slug} ${entry.where}`, sentence })),
    );
    // Health: the intro, the authored FAQ (question and answer) and the
    // guide (measured 2026-11-16: six sentences).
    expect(claims.length).toBeGreaterThanOrEqual(6);
    expect(new Set(claims.map((c) => c.at.split(" ")[0]))).toEqual(
      new Set(["summarize-pdf", "guide:how-to-summarize-a-pdf"]),
    );
    const outside = claims
      .filter(({ sentence }) => !subject!.test(sentence))
      .map(({ at, sentence }) => `${at}: ${sentence}`);
    expect(outside).toEqual([]);
    // Positive controls, through the same rule the catalogue runs: a
    // deferral planted in the advertisement, and a bare "Not yet." answer
    // to the FAQ question (caught only because the question is a member).
    const advert = claims.find((c) =>
      c.sentence.includes(SUMMARIZE_PAGE_CHOICE),
    )!;
    const planted: CopyEntry = {
      slug: "summarize-pdf",
      where: "intro[0]",
      text: `${advert.sentence.replace(/\.$/, "")} (coming soon).`,
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes(`hedges "${key}"`),
      ),
    ).toBe(true);
    const question = claims.find((c) => c.at.endsWith(".question"))!;
    const pair: FaqPair = {
      slug: "summarize-pdf",
      where: "faq[9]",
      question: question.sentence,
      answer: "Not yet.",
    };
    expect(
      hedgeOffenders([], [pair]).some((line) =>
        line.includes(`answers a question about "${key}"`),
      ),
    ).toBe(true);
  });

  it("each subject matcher's declared catalogue coverage is the truth", () => {
    // Direction B, and the entry that keeps `catalogueCopy` from being a comment.
    // Declared true → it must find shipped prose (else the rule is vacuous for
    // that capability). Declared false → it must find none, so the first
    // sentence ever written about it forces this pairing to be made on purpose.
    const wrong: string[] = [];
    for (const [key, { subject, catalogueCopy }] of Object.entries(SUBJECTS)) {
      const hits = COPY.filter((entry) => subject.test(entry.text));
      if (catalogueCopy && hits.length === 0) {
        wrong.push(
          `${key}: declared to have catalogue copy, but its subject matches nothing shipped — the rule is vacuous for it`,
        );
      }
      if (!catalogueCopy && hits.length > 0) {
        wrong.push(
          `${key}: declared to have NO catalogue copy, but matches ${hits.length}: ` +
            hits
              .map((h) => `${h.slug} ${h.where} "${h.text.slice(0, 70)}"`)
              .join("; "),
        );
      }
    }
    expect(wrong, wrong.join("\n  ")).toEqual([]);
  });

  it("every hedge shape catches a real deferral, and every deferral is caught", () => {
    // The corpus in both directions. The live catalogue cannot serve as it —
    // the whole point of this file is that the catalogue contains no hedge —
    // so the fixtures do, and they are bounded from below so they cannot
    // quietly shrink into a vacuous pass.
    expect(HEDGES_IN_THE_WILD.length).toBeGreaterThanOrEqual(12);
    expect(NOT_HEDGES.length).toBeGreaterThanOrEqual(5);

    // A pattern nothing exercises is decoration.
    const idle = Object.entries(HEDGES)
      .filter(([, re]) => !HEDGES_IN_THE_WILD.some((s) => re.test(s)))
      .map(([name]) => name);
    expect(
      idle,
      `these hedge patterns match none of the known deferrals — they are decoration:\n  ${idle.join("\n  ")}`,
    ).toEqual([]);

    // A fixture nothing catches is a hole — the half that a pattern list alone
    // never notices, and the half a synonym walks through.
    const missed = HEDGES_IN_THE_WILD.filter(
      (sentence) => !Object.values(HEDGES).some((re) => re.test(sentence)),
    );
    expect(
      missed,
      `these deferrals are caught by no pattern — a hedge could ship in these words:\n  ${missed.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no hedge shape fires on honest copy", () => {
    const noisy: string[] = [];
    for (const sentence of NOT_HEDGES) {
      for (const [name, re] of Object.entries(HEDGES)) {
        if (re.test(sentence)) noisy.push(`"${name}" fired on: ${sentence}`);
      }
    }
    expect(noisy, noisy.join("\n  ")).toEqual([]);
  });

  /* ---------------- the rule ------------------------------------------------ */

  it("no catalogue sentence hedges a capability the worker reports", () => {
    const offenders = hedgeOffenders(COPY, FAQ_PAIRS);
    expect(
      offenders,
      `the worker publishes these capabilities in its heartbeat, and this copy — which also ships as HowTo JSON-LD — tells readers they are unshipped:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("control: an answer's deferral is read against its question", () => {
    // The pair the FAQ shipped, cut to the sentence the subject cannot see.
    const question = "Will the .pptx open in PowerPoint?";
    const answer = "Not at the moment.";
    const chain = SUBJECTS.pptxPresentationChain;
    expect(chain).toBeDefined();
    if (!chain) return;
    // The hole: the question is about the capability, the answer is not...
    expect(chain.subject.test(question)).toBe(true);
    expect(chain.subject.test(answer)).toBe(false);
    // ...so as an entry on its own the answer passes the rule,
    expect(
      hedgeOffenders(
        [{ slug: "control", where: "faq[0].answer", text: answer }],
        [],
      ),
    ).toEqual([]);
    // and as a pair, through the same function the rule test calls, it fails.
    expect(
      hedgeOffenders(
        [],
        [{ slug: "control", where: "faq[0]", question, answer }],
      ),
    ).toEqual([
      `control faq[0] answers a question about "pptxPresentationChain" with "not at the moment": "${answer}"`,
    ]);
  });

  /* ---------------- a capability's own page, read whole --------------------- */

  it("the pages capabilities own are derived from their names, and few", () => {
    // Members, not a count. Both directions are red: a rename that takes a
    // page out of its subject's reach (the page would silently drop back to
    // per-sentence scope), and a subject that starts owning a page it should
    // not (every sentence there would be read as about that capability).
    const owners = Object.fromEntries(
      Object.entries(SUBJECTS)
        .map(
          ([key, { subject }]) => [key, [...ownPages(subject, COPY)]] as const,
        )
        .filter(([, pages]) => pages.length > 0),
    );
    expect(owners).toEqual({
      ocr: ["ocr-pdf"],
      pptxPresentationChain: ["pdf-to-powerpoint"],
    });
    // And the PowerPoint page it found is the page the six deferrals shipped
    // on: every location they were served at is a location on it.
    const chain = SUBJECTS.pptxPresentationChain;
    expect(chain).toBeDefined();
    if (!chain) return;
    const [page] = [...ownPages(chain.subject, COPY)];
    const there = new Set(
      COPY.filter((entry) => entry.slug === page).map((entry) => entry.where),
    );
    expect(
      PPTX_DEFERRALS_SHIPPED.map(({ where }) => where).filter(
        (where) => !there.has(where),
      ),
    ).toEqual([]);
  });

  it("a deferral planted on the PowerPoint page is caught where the subject cannot see it", () => {
    const chain = SUBJECTS.pptxPresentationChain;
    expect(chain).toBeDefined();
    if (!chain) return;
    const [page] = [...ownPages(chain.subject, COPY)];
    expect(page).toBeDefined();
    if (!page) return;
    // Two of the four locations the rewrite moved outside the subject. The
    // planted words name nothing the subject knows, as a respelled deferral
    // would not.
    const planted = "Remember that it will not open yet.";
    const plant = (slug: string, where: string) => {
      let replaced = 0;
      const copy = COPY.map((entry) => {
        if (entry.slug !== slug || entry.where !== where) return entry;
        replaced += 1;
        return { ...entry, text: `${entry.text} ${planted}` };
      });
      // A location that no longer exists would leave the copy clean, and the
      // assertion below red for the wrong reason.
      expect(replaced, `${slug} has no ${where}`).toBe(1);
      const text = copy.find((e) => e.slug === slug && e.where === where)!;
      // The hole: the subject does not see the planted entry at all.
      expect(chain.subject.test(text.text)).toBe(false);
      // Who reported it, and where: `<slug> <where> hedges "<key>"`.
      const reports = hedgeOffenders(copy, faqPairs(copy)).map((line) =>
        line.slice(0, line.indexOf(" with ")),
      );
      return { reports, text: text.text };
    };
    for (const where of ["how[3]", "useCases[1].body"]) {
      const { reports, text } = plant(page, where);
      // The chain reports it because it OWNS the page; its subject cannot see
      // it (asserted in `plant`), so this line is the page read whole and
      // nothing else. Any other capability reports it only through its OWN
      // subject: since 2026-10-10 `pptxPictures` reads useCases[1] ("Pictures
      // arrive on their slides…") wherever it stands. Until then this asserted
      // `[`${page} ${where}`]`, one report with the key cut off, which a second
      // honest report made red for no fault of the page read. Derived, not
      // typed, so a subject that starts or stops seeing the entry moves the
      // expectation with it, and the chain's line stays required either way.
      const bySubject = WIRE_KEYS.filter(
        (key) =>
          key !== "pptxPresentationChain" && SUBJECTS[key]?.subject.test(text),
      );
      expect([...reports].sort()).toEqual(
        ["pptxPresentationChain", ...bySubject]
          .map((key) => `${page} ${where} hedges "${key}"`)
          .sort(),
      );
    }
    // Read whole only on its OWN page. The same words on a page no capability
    // owns, in an entry no subject sees, are about nothing this rule reads,
    // and stay out.
    const owned = new Set(
      Object.values(SUBJECTS).flatMap(({ subject }) => [
        ...ownPages(subject, COPY),
      ]),
    );
    const elsewhere = COPY.find(
      (entry) =>
        entry.where === "how[3]" &&
        !owned.has(entry.slug) &&
        !Object.values(SUBJECTS).some(({ subject }) =>
          subject.test(entry.text),
        ),
    );
    expect(elsewhere).toBeDefined();
    if (!elsewhere) return;
    expect(plant(elsewhere.slug, "how[3]").reports).toEqual([]);
  });

  it("the subject still reaches the FAQ answer that needed its widening", () => {
    // With the page read whole, narrowing the subject back would pass every
    // other test here: on pdf-to-powerpoint the subject no longer decides what
    // is read. It still does everywhere else, so the widening is pinned on the
    // sentence it was made for.
    const chain = SUBJECTS.pptxPresentationChain;
    expect(chain).toBeDefined();
    if (!chain) return;
    const question = "Will the .pptx open in PowerPoint?";
    const asked = FAQ_PAIRS.filter((pair) => pair.question === question);
    expect(asked, `no page asks "${question}" any more`).toHaveLength(1);
    const answer = asked[0]!.answer;
    expect(chain.subject.test(answer)).toBe(true);
    // Positive control: the subject as it was before the widening does NOT
    // reach this answer, so the line above holds the widening and not some
    // other alternative. If this goes red, the answer was reworded into the
    // old subject's reach: pin the widening on a sentence that still needs it.
    const BEFORE_WIDENING =
      /PDF to PowerPoint|pdf to (?:pptx|slides)|editable (?:PowerPoint )?slides?|\.pptx\b[^.?!]{0,40}\bopen|\bopen(?:s|ed)?\b[^.?!]{0,40}\bPowerPoint\b|\bPowerPoint\b[^.?!]{0,40}\b(?:open|refuses?|rejects?)\b|slide master|complete presentation/i;
    expect(BEFORE_WIDENING.test(answer)).toBe(false);
  });

  /* ---------------- the inverted defect ------------------------------------- */

  it("the sentence that shipped for forty days is caught, and is gone", () => {
    const shipped = HEDGES_IN_THE_WILD[0];
    const deep = SUBJECTS.deepCompression;
    const comingSoon = HEDGES["coming soon"];
    expect(shipped).toBeDefined();
    expect(deep).toBeDefined();
    expect(comingSoon).toBeDefined();
    if (!shipped || !deep || !comingSoon) return;
    // It would still be caught — the detector is not green because it went blind.
    expect(deep.subject.test(shipped)).toBe(true);
    expect(comingSoon.test(shipped)).toBe(true);
    // And it is no longer in the catalogue.
    expect(COPY.map((entry) => entry.text)).not.toContain(shipped);
  });

  it("the six deferrals the PowerPoint page shipped are caught, and are gone", () => {
    // Inverted, not deleted. Until 2026-10-09 the rule test above was GREEN
    // over all six, because no shape matched any of them.
    expect(PPTX_DEFERRALS_SHIPPED).toHaveLength(6);
    const chain = SUBJECTS.pptxPresentationChain;
    expect(chain).toBeDefined();
    if (!chain) return;
    // About the capability, so the rule reads each one...
    expect(
      PPTX_DEFERRALS_SHIPPED.filter(
        ({ text }) => !chain.subject.test(text),
      ).map(({ where }) => where),
      "these shipped sentences are not about the capability at all",
    ).toEqual([]);
    // ...and caught, so the rule would fire on each one today.
    expect(
      PPTX_DEFERRALS_SHIPPED.filter(
        ({ text }) => !Object.values(HEDGES).some((re) => re.test(text)),
      ).map(({ where }) => where),
      "these shipped deferrals are caught by no shape",
    ).toEqual([]);
    // ...and REPORTED, by the rule itself. The two checks above test the
    // subject and the shapes BESIDE `hedgeOffenders`, which proves nothing
    // about it: with its main path mutated to skip every entry
    // (`if (!subject.test(entry.text) || entry) continue;`, a reviewer's
    // mutation on 2026-10-09) this whole file stayed green, because the rule
    // test only ever sees a clean catalogue and the one control through the
    // function ran its FAQ-pair branch. So each shipped sentence goes through
    // the function the rule test calls, once each, in order.
    expect(
      hedgeOffenders(
        PPTX_DEFERRALS_SHIPPED.map(({ where, text }) => ({
          slug: "pdf-to-powerpoint",
          where,
          text,
        })),
        [],
      ).map((line) => line.slice(0, line.indexOf(" hedges "))),
    ).toEqual(
      PPTX_DEFERRALS_SHIPPED.map(({ where }) => `pdf-to-powerpoint ${where}`),
    );
    // Each shape cut from them catches one of THEM, not only a respelling.
    expect(
      SHAPES_FROM_THE_PPTX_PAGE.filter((name) => {
        const re = HEDGES[name];
        return !re || !PPTX_DEFERRALS_SHIPPED.some(({ text }) => re.test(text));
      }),
      "these shapes catch none of the sentences they were cut from",
    ).toEqual([]);
    // And none is served any more. Verbatim, so this half alone is weak (an
    // edit of one word passes it); the rule test is what holds the page.
    const served = new Set(COPY.map((entry) => entry.text));
    expect(
      PPTX_DEFERRALS_SHIPPED.filter(({ text }) => served.has(text)).map(
        ({ where }) => where,
      ),
    ).toEqual([]);
  });
});

describe("the translateOcr subject (audit translate-pdf#3, 2026-11-09)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). Measured when the key landed, over the
   * whole corpus (5,079 entries): exactly these seven — Translate PDF's
   * step 4, its scan FAQ answer, intro[2] and the scanned-letter use case,
   * and the translate guide's step 2, scan section and scan FAQ answer. A
   * member elsewhere is a sentence about this capability nobody paired; a
   * missing one is the subject going blind to the copy it guards.
   */
  it("reaches Translate's scan sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.translateOcr!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual(
      [
        "translate-pdf how[3]",
        "translate-pdf faq[1].answer",
        "translate-pdf intro[2]",
        "translate-pdf useCases[3].body",
        "guide:how-to-translate-a-pdf steps[1]",
        "guide:how-to-translate-a-pdf sections[3].body[0]",
        "guide:how-to-translate-a-pdf faq[5].answer",
      ].sort(),
    );
  });

  it("positive control: a deferral planted in Translate's scan sentence is caught", () => {
    const planted: CopyEntry = {
      slug: "translate-pdf",
      where: "faq[1].answer",
      text: "A scan is recognised on our server first (coming soon), then translated.",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "translateOcr"'),
      ),
    ).toBe(true);
  });
});

describe("the translatePdfLanguages subject (competitor audit #29, 2026-11-15)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). Measured when the key landed: exactly one
   * member, Translate PDF's layout FAQ answer — the one both-states sentence
   * slice 1 allowed, while the intro, metaDescription and guide still
   * described the ZIP alone.
   *
   * 2026-11-15, slice 2: those surfaces now say which languages get the
   * reflowed PDF (`translatePdfCoverage`, derived from the set CI makes the
   * worker image prove), so the members are the tool page's three and the
   * guide's six, measured that day; review r1 (2026-11-16) added the
   * catalogue description, which had named the text alone. A member elsewhere is still a sentence
   * about this capability nobody paired.
   */
  it("reaches Translate's PDF sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.translatePdfLanguages!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual([
      "guide:how-to-translate-a-pdf description",
      "guide:how-to-translate-a-pdf faq[3].answer",
      "guide:how-to-translate-a-pdf intro[0]",
      "guide:how-to-translate-a-pdf intro[2]",
      "guide:how-to-translate-a-pdf sections[0].body[1]",
      "guide:how-to-translate-a-pdf steps[5]",
      // Review r1, 2026-11-16: the catalogue description names the PDF now.
      "translate-pdf description",
      "translate-pdf faq[0].answer",
      "translate-pdf intro[0]",
      "translate-pdf metaDescription",
    ]);
  });

  it("positive control: a deferral planted in that sentence is caught", () => {
    const planted: CopyEntry = {
      slug: "translate-pdf",
      where: "faq[0].answer",
      text: "A reflowed PDF of the same text is coming soon.",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "translatePdfLanguages"'),
      ),
    ).toBe(true);
  });
});

/**
 * A POSITIVE column-order claim: "the columns are read in order", "one column
 * after the other", "column by column". None shipped at slice 3's merge
 * (2026-11-16): the copy disclosed interleaving instead, true on both images.
 * Slice 5 (the same day, after `translateReadingOrder` was observed in
 * production and a real two-column job came back in column order) SHIPPED
 * one: `TRANSLATE_COLUMN_ORDER`. Exercised in both directions below, so a
 * shape nothing matches cannot pass for a clean catalogue.
 */
const POSITIVE_COLUMN_ORDER =
  /\bcolumns?\b[^.]{0,40}\b(?:in order|one after the other)\b|\bone column after the other\b|\bcolumn by column\b/i;

describe("the translateReadingOrder subject (competitor audit #29 slice 3, 2026-11-16)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). Measured when the key landed: exactly one
   * member, Translate PDF's useCases[1] — the both-states disclosure slice 3
   * wrote. Measured again at slice 5: the same member, now carrying
   * `TRANSLATE_COLUMN_ORDER`, plus the guide FAQ slice 5 added with the same
   * sentence. A member elsewhere is a sentence about this capability nobody
   * paired.
   */
  it("reaches Translate's column-order sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.translateReadingOrder!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual([
      "guide:how-to-translate-a-pdf faq[6].answer",
      "translate-pdf useCases[1].body",
    ]);
  });

  it("every member keeps the FALLBACK clause while any fallback reason exists", () => {
    // Slice 3 required "interleav" here: "that sentence still DISCLOSES
    // interleaving (true of every fallback page, on both images)". INVERTED
    // at slice 5, not deleted: the interleave ADMISSION is now banned
    // (translate-reading-order-copy.test.ts), and what the disclosure was
    // for — fallback pages (ink, longer, rtl, bbox_failed, page_count) are
    // still sent line by line — is required as a clause in every member.
    // The clause was `cannot confirm … line by line` until the 2026-11-16
    // review: it named a column-order check that does not exist, so the
    // clause now states the outcome only.
    const members = COPY.filter((entry) =>
      SUBJECTS.translateReadingOrder!.subject.test(entry.text),
    );
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(member.text, `${member.slug} ${member.where}`).toMatch(
        /\bsome pages are read line by line\b/i,
      );
      expect(member.text, `${member.slug} ${member.where}`).not.toMatch(
        /interleav/i,
      );
    }
    // Positive control: the claim alone, its clause dropped, is a member that
    // fails the clause check.
    const dropped = "A two-column page is usually read column by column.";
    expect(SUBJECTS.translateReadingOrder!.subject.test(dropped)).toBe(true);
    expect(dropped).not.toMatch(/\bsome pages are read line by line\b/i);
  });

  it("positive control: a deferral planted in that sentence is caught", () => {
    const planted: CopyEntry = {
      slug: "translate-pdf",
      where: "useCases[1].body",
      text: "A two-column page is read column by column soon.",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "translateReadingOrder"'),
      ),
    ).toBe(true);
    // The retired wording is still read as about this key.
    const retired: CopyEntry = {
      slug: "translate-pdf",
      where: "useCases[1].body",
      text: "Columns are read in order soon, so compare the order of the translated paragraphs with the original.",
    };
    expect(
      hedgeOffenders([retired], []).some((line) =>
        line.includes('hedges "translateReadingOrder"'),
      ),
    ).toBe(true);
  });

  it("Translate's copy CLAIMS the columns are read in order, and the operations promise names that claim", () => {
    // HISTORY. Slice 3 (#340) wrote this as "no shipped sentence claims the
    // columns are read in order, so the operations promise claims nothing
    // either": `claims` had to be [], and the promise had to read "nothing
    // yet" and mention interleaving. Since #341 it was scoped to Translate's
    // copy: PDF to Word's tables FAQ said a share-capped table's cells come
    // through "read column by column", which describes PDF to Word's own
    // extraction, not this capability. INVERTED at slice 5 into a REQUIRED
    // claim: the claim now ships, tied to the key, so the rows that carry it
    // are pinned and the promise must say the same thing.
    expect(POSITIVE_COLUMN_ORDER.test("The columns are read in order.")).toBe(
      true,
    );
    expect(
      POSITIVE_COLUMN_ORDER.test(
        "Translate sends a two-column page one column after the other.",
      ),
    ).toBe(true);
    const isTranslateCopy = (entry: CopyEntry) => /translate/i.test(entry.slug);
    expect(
      COPY.filter(isTranslateCopy).length,
      "the Translate copy scope is empty: the check below would pass vacuously",
    ).toBeGreaterThan(0);
    const claims = COPY.filter(
      (entry) =>
        isTranslateCopy(entry) && POSITIVE_COLUMN_ORDER.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    // Scope control: the same words in another tool's copy are not this
    // capability.
    expect(isTranslateCopy({ slug: "pdf-to-word", where: "x", text: "" })).toBe(
      false,
    );
    expect(
      claims.sort(),
      "the column-order claim moved: re-pair it with the translateReadingOrder " +
        "promise (observability/snapshot.ts) in the same commit.",
    ).toEqual([
      "guide:how-to-translate-a-pdf faq[6].answer",
      "translate-pdf useCases[1].body",
    ]);
    // Every claim is a member of the key's subject: a claim the hedge rule
    // cannot see would be a claim about the key nobody paired.
    for (const where of claims) {
      const entry = COPY.find((e) => `${e.slug} ${e.where}` === where)!;
      expect(SUBJECTS.translateReadingOrder!.subject.test(entry.text)).toBe(
        true,
      );
    }
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "translateReadingOrder",
    )?.promise;
    expect(promise, "the operations row lost its promise").toBeDefined();
    expect(POSITIVE_COLUMN_ORDER.test(promise!)).toBe(true);
    expect(promise).not.toMatch(/nothing yet/);
    expect(promise).not.toMatch(/interleav/);
    // RTL honesty: the promise keeps right-to-left pages on the fallback.
    expect(promise).toMatch(/right-to-left/);
  });
});

describe("the translatePageMap subject (competitor audit #29 slice 4, 2026-11-16)", () => {
  /**
   * Slice 4 shipped `catalogueCopy: false`, and this test was "reaches
   * nothing shipped today (measured: no member)". FLIPPED at slice 5, which
   * wrote `TRANSLATE_PAGE_HEADINGS` after the key was observed live:
   * measured that day, exactly the two sentences that carry it.
   */
  it("reaches Translate's page-heading sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.translatePageMap!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual([
      "guide:how-to-translate-a-pdf sections[0].body[1]",
      "translate-pdf faq[0].answer",
    ]);
  });

  it("positive control: a deferral planted about page headings is caught as hedging translatePageMap", () => {
    const planted: CopyEntry = {
      slug: "translate-pdf",
      where: "useCases[0].body",
      text: "The translated PDF will soon head each page with its page number.",
    };
    expect(SUBJECTS.translatePageMap!.subject.test(planted.text)).toBe(true);
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "translatePageMap"'),
      ),
    ).toBe(true);
  });

  it("negative control: compare-pdf's 'headed with its page' sentences are NOT members", () => {
    const near = COPY.filter(
      (entry) =>
        entry.slug === "compare-pdf" &&
        /headed with its page/i.test(entry.text),
    );
    // Health: the sentences this control is about are still in the corpus.
    expect(near.length).toBeGreaterThanOrEqual(1);
    for (const entry of near)
      expect(
        SUBJECTS.translatePageMap!.subject.test(entry.text),
        `${entry.slug} ${entry.where}`,
      ).toBe(false);
    // And the phrasing itself, outside any corpus.
    expect(
      SUBJECTS.translatePageMap!.subject.test(
        "Each hunk is headed with its page in both files.",
      ),
    ).toBe(false);
  });

  it("the operations promise names the page-heading claim the copy now makes", () => {
    // Slice 4: "the operations promise claims no page heading either"
    // (`/nothing yet/` required). INVERTED at slice 5.
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "translatePageMap",
    )?.promise;
    expect(promise, "the operations row lost its promise").toBeDefined();
    expect(promise).not.toMatch(/nothing yet/);
    expect(promise).toMatch(/own page heading/);
    expect(promise).toMatch(/page-range heading otherwise/);
  });
});

describe("the translatePageRange subject (competitor audit #29 slices 6 and 7)", () => {
  /**
   * `catalogueCopy: true` since slice 7 (2026-11-17). The served members are
   * pinned to exactly the advertisement's sentences, so a new sentence the
   * subject starts catching (a Split or Extract page, say) is red here, and
   * so is an advertisement sentence that stops being a member.
   *
   * INVERTED 2026-11-17, history kept. Slice 6 shipped this as
   *
   *   it("reaches nothing shipped today (measured: no member)")
   *     expect(members).toEqual([]);
   *
   * which was true while no static copy offered page choice, and would have
   * pinned the defect (an advertisement read as about no key) the moment
   * slice 7 shipped one.
   */
  const sentenceMembers = () =>
    COPY.flatMap((entry) =>
      entry.text
        .split(/(?<=[.?!])\s+/)
        .filter((s) => SUBJECTS.translatePageRange!.subject.test(s))
        .map((sentence) => ({ at: `${entry.slug} ${entry.where}`, sentence })),
    );

  it("its served members are exactly the page-choice advertisement's sentences", () => {
    const key = TRANSLATE_PAGE_RANGE_CAPABILITY;
    expect(WIRE_KEYS).toContain(key);
    const members = sentenceMembers();
    // Health: measured 2026-11-17, ten sentences on two surfaces.
    expect(members.length).toBeGreaterThanOrEqual(10);
    expect(members.length).toBeLessThan(40);
    expect(new Set(members.map((m) => m.at.split(" ")[0]))).toEqual(
      new Set(["translate-pdf", "guide:how-to-translate-a-pdf"]),
    );
    expect(new Set(members.map((m) => m.sentence))).toEqual(
      new Set(TRANSLATE_PAGE_CHOICE_SHIPPED.map((s) => s.sentence)),
    );
    // And every sentence carrying the advertisement (any shape) is a member.
    const claims = COPY.flatMap((entry) =>
      entry.text
        .split(/(?<=[.?!])\s+/)
        .filter((s) =>
          TRANSLATE_PAGE_CHOICE_SHAPES.some(({ pattern }) => pattern.test(s)),
        ),
    );
    expect(claims.length).toBeGreaterThanOrEqual(10);
    expect(
      claims.filter((s) => !SUBJECTS.translatePageRange!.subject.test(s)),
    ).toEqual([]);
  });

  it('positive controls: a deferral planted in the advertisement, and a bare "Not yet." to its question, are caught', () => {
    const key = TRANSLATE_PAGE_RANGE_CAPABILITY;
    const members = sentenceMembers();
    const advert = members.find((m) =>
      m.sentence.includes(TRANSLATE_PAGE_CHOICE),
    );
    expect(advert, "no served advertisement to plant in").toBeDefined();
    const planted: CopyEntry = {
      slug: "translate-pdf",
      where: "intro[2]",
      text: `${advert!.sentence.replace(/\.$/, "")} (coming soon).`,
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes(`hedges "${key}"`),
      ),
    ).toBe(true);
    const question = members.find((m) => m.at.endsWith(".question"));
    expect(question, "the FAQ question is no longer a member").toBeDefined();
    const pair: FaqPair = {
      slug: "translate-pdf",
      where: "faq[11]",
      question: question!.sentence,
      answer: "Not yet.",
    };
    expect(
      hedgeOffenders([], [pair]).some((line) =>
        line.includes(`answers a question about "${key}"`),
      ),
    ).toBe(true);
  });

  it("positive control: slice 7's advertisement is a member, and a planted deferral is caught", () => {
    // The sentence slice 6 planned for slice 7. Kept as a control: slice 7
    // shipped other words (`TRANSLATE_PAGE_CHOICE_SHIPPED`), and this
    // spelling must still be read as about the key.
    expect(
      SUBJECTS.translatePageRange!.subject.test(
        "Enter a page range and translate the rest tomorrow, with no splitting.",
      ),
    ).toBe(true);
    const planted: CopyEntry = {
      slug: "translate-pdf",
      where: "useCases[0].body",
      text: "Soon you will be able to translate only the pages you choose.",
    };
    expect(SUBJECTS.translatePageRange!.subject.test(planted.text)).toBe(true);
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "translatePageRange"'),
      ),
    ).toBe(true);
  });

  it("negative control: other tools' page-range copy is NOT a member", () => {
    const near = COPY.filter(
      (entry) =>
        entry.slug !== "translate-pdf" && /\bpage ranges?\b/i.test(entry.text),
    );
    // Health: the sentences this control is about are still in the corpus.
    expect(near.length).toBeGreaterThanOrEqual(3);
    for (const entry of near)
      expect(
        SUBJECTS.translatePageRange!.subject.test(entry.text),
        `${entry.slug} ${entry.where}`,
      ).toBe(false);
    expect(
      SUBJECTS.translatePageRange!.subject.test(
        "Enter a page range to extract, such as 1-3, 8.",
      ),
    ).toBe(false);
  });

  it("the operations promise is positive, like summarizePages's (the panel offers it only while it reads true)", () => {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "translatePageRange",
    )?.promise;
    expect(promise, "the operations row lost its promise").toBeDefined();
    expect(promise).toMatch(/sends only the pages the reader chose/);
  });
});

describe("the csvImportOptions subject (competitor audit #18, 2026-11-17)", () => {
  /**
   * `catalogueCopy: true`: the shipped sentences are what exercise it
   * (house rule 1; members printed and bounded), and a planted deferral is
   * caught through the rule's own path (positive control).
   */
  const members = () =>
    COPY.filter((entry) =>
      SUBJECTS.csvImportOptions!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);

  it("reaches Excel to PDF's page and guide (members printed, bounded)", () => {
    const found = members();
    expect(found.length, found.join("\n")).toBeGreaterThanOrEqual(4);
    for (const where of [
      "excel-to-pdf useCases",
      "excel-to-pdf how",
      "guide:how-to-convert-excel-to-pdf sections",
      "guide:how-to-convert-excel-to-pdf faq",
    ])
      expect(
        found.some((m) => m.startsWith(where)),
        `${where} is not a member:\n${found.join("\n")}`,
      ).toBe(true);
  });

  it("positive control: the sentence it replaced, and a planted deferral, are caught", () => {
    // Shipped until 2026-11-17 in Excel to PDF's CSV use case: a bare
    // present-tense denial, which this file says it cannot see as a hedge,
    // but which IS about the capability.
    expect(
      SUBJECTS.csvImportOptions!.subject.test(
        "A CSV saved as UTF-8 keeps its letters. There is no delimiter option, so check the CSV columns split as expected.",
      ),
    ).toBe(true);
    const planted: CopyEntry = {
      slug: "excel-to-pdf",
      where: "useCases[4].body",
      text: "Choosing a CSV delimiter is coming soon.",
    };
    expect(SUBJECTS.csvImportOptions!.subject.test(planted.text)).toBe(true);
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "csvImportOptions"'),
      ),
    ).toBe(true);
  });

  it("the operations promise is positive (the panel offers it only while it reads true)", () => {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "csvImportOptions",
    )?.promise;
    expect(promise, "the operations row lost its promise").toBeDefined();
    expect(promise).toMatch(/delimiter and character set the reader chose/);
  });
});

describe("the ocrOwnerPassword subject (competitor-audit backlog #11, 2026-11-17)", () => {
  const members = () =>
    COPY.filter((entry) =>
      SUBJECTS.ocrOwnerPassword!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);

  it("reaches OCR PDF's restricted-PDF use case (members printed, bounded)", () => {
    const found = members();
    expect(found.length, found.join("\n")).toBeGreaterThanOrEqual(1);
    expect(found.length, found.join("\n")).toBeLessThan(12);
    expect(
      found.some((m) => m.startsWith("ocr-pdf useCases")),
      found.join("\n"),
    ).toBe(true);
  });

  it("positive control: the refusal it replaced, and a planted deferral, are caught", () => {
    // A bare denial in either order, the shape a pre-feature page would say.
    for (const denial of [
      "OCR can't read a restricted PDF, even with its owner password.",
      "The owner (permissions) password does not help OCR here.",
    ])
      expect(SUBJECTS.ocrOwnerPassword!.subject.test(denial), denial).toBe(
        true,
      );
    const planted: CopyEntry = {
      slug: "ocr-pdf",
      where: "useCases[7].body",
      text: "Running OCR with an owner password is coming soon.",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "ocrOwnerPassword"'),
      ),
    ).toBe(true);
  });

  it("the operations promise is positive (the panel offers it only while it reads true)", () => {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "ocrOwnerPassword",
    )?.promise;
    expect(promise, "the operations row lost its promise").toBeDefined();
    expect(promise).toMatch(
      /keeps the author's restrictions and owner password \(except that screen readers are always allowed to read it\)/,
    );
  });
});

describe("the requestSignatureLabels subject (2026-11-18)", () => {
  const members = () =>
    COPY.filter((entry) =>
      SUBJECTS.requestSignatureLabels!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);

  it("reaches Request Signatures' FAQ answer about field names (members printed, bounded)", () => {
    const found = members();
    expect(found.length, found.join("\n")).toBeGreaterThanOrEqual(1);
    expect(found.length, found.join("\n")).toBeLessThan(8);
    const faq = pageFaqAnswer(
      "request-signatures",
      /^How do signers fill in their boxes\?$/,
    );
    expect(
      found.some((m) => m === `request-signatures ${faq}`),
      `${faq}\n${found.join("\n")}`,
    ).toBe(true);
  });

  it("the hedge it replaced is caught by its shape, reported by the rule, and gone", () => {
    const shipped = REQUEST_SIGNATURE_LABEL_HEDGE_SHIPPED;
    // About the capability...
    expect(SUBJECTS.requestSignatureLabels!.subject.test(shipped)).toBe(true);
    // ...caught by the shape cut from it, and by no other (a one-shape catch
    // is honest here: it is the only shape of its kind)...
    expect(
      Object.entries(HEDGES)
        .filter(([, re]) => re.test(shipped))
        .map(([name]) => name),
    ).toEqual(["if … too"]);
    // ...REPORTED by the function the rule test calls, on the page's own
    // slug and in the answer it sat in, with the rest of that answer kept...
    const answer = COPY.find(
      (entry) =>
        entry.slug === "request-signatures" &&
        entry.text.includes("Each label is also the tooltip of its box"),
    );
    expect(answer, "the plain sentence is not served").toBeDefined();
    const planted: CopyEntry = {
      slug: "request-signatures",
      where: answer!.where,
      text: answer!.text.replace(
        "Each label is also the tooltip of its box in prepared.pdf, which many PDF viewers show when you point at the box.",
        shipped,
      ),
    };
    // Health: the replacement landed, or the line below tests nothing.
    expect(planted.text).toContain(shipped);
    expect(
      hedgeOffenders([planted], []).filter((line) =>
        line.includes('hedges "requestSignatureLabels" with "if … too"'),
      ),
    ).toHaveLength(1);
    // ...and the served answer itself is clean.
    expect(hedgeOffenders([answer!], [])).toEqual([]);
    // ...and gone from the catalogue.
    expect(COPY.some((entry) => entry.text.includes(shipped))).toBe(false);
  });

  it("the operations promise names the tooltip", () => {
    const promise = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "requestSignatureLabels",
    )?.promise;
    expect(promise, "the operations row lost its promise").toBeDefined();
    expect(promise).toMatch(/\btooltip\b/);
  });
});

/** The `faq[i].answer` location of a page's answer whose QUESTION matches. */
function pageFaqAnswer(slug: string, question: RegExp): string {
  const pair = FAQ_PAIRS.find(
    (p) => p.slug === slug && question.test(p.question),
  );
  if (!pair)
    throw new Error(`${slug} has no FAQ question matching ${question}`);
  return `${pair.where}.answer`;
}

/* ------------------------------------------------------------------ *
 *  A translateOcr claim names BOTH states (review finding, 2026-11-09)
 * ------------------------------------------------------------------ */

/**
 * The hedge rule above catches "coming soon" next to the capability. It
 * cannot catch the opposite defect, which shipped on this branch twice: an
 * UNCONDITIONAL "a scan is recognised" — Translate's step 4 and the guide's
 * heading "Scanned PDFs are recognised first" — false for as long as the
 * running worker publishes no `translateOcr`, which is what production does
 * the day the web tier deploys (CLAUDE.md rule 5). Static copy cannot know
 * which state it is read in, so every sentence on Translate's surfaces that
 * says a scan is recognised must name both: what happens when our server can,
 * and what happens when it cannot.
 *
 * THE SURFACES ARE DERIVED: the tool that reads `status.translateOcr`, and
 * every guide whose PRIMARY tool (`tools[0]`) it is. The claim shape is any
 * sentence mentioning a scan and recognising, wider than the hedge subject on
 * purpose — the heading that slipped through says neither "on our server"
 * nor "the text".
 *
 * Two follow-up sentences are exempt only where they FOLLOW the both-branch
 * route sentence in the same entry, whose condition they inherit:
 * `TRANSLATE_OCR_SCOPE` and `TRANSLATE_OCR_CHARGE_SENTENCE`.
 */
const TRANSLATE_OCR_TOOL = "translate-pdf";
const SCAN_CLAIM = (sentence: string) =>
  /\bscan/i.test(sentence) && /\brecogni[sz]/i.test(sentence);
const CAN_BRANCH = /\bwhen\b[^.?!]*\bcan\b(?!not)/i;
const CANNOT_BRANCH = /\bwhen\b[^.?!]*\b(?:cannot|can't|can not)\b/i;
const sentencesOf = (text: string) => text.split(/(?<=[.?!])\s+(?=[A-Z])/);

function translateOcrSurfaces(copy: readonly CopyEntry[]): CopyEntry[] {
  const guideSlugs = new Set(
    guides
      .filter((guide) => guide.tools[0] === TRANSLATE_OCR_TOOL)
      .map((guide) => `guide:${guide.slug}`),
  );
  return copy.filter(
    (entry) => entry.slug === TRANSLATE_OCR_TOOL || guideSlugs.has(entry.slug),
  );
}

/** Each scan claim on Translate's surfaces, and whether it names both states. */
function translateScanClaims(
  copy: readonly CopyEntry[],
): { where: string; sentence: string; ok: boolean }[] {
  const followUps = [
    ...sentencesOf(TRANSLATE_OCR_SCOPE),
    ...sentencesOf(TRANSLATE_OCR_CHARGE_SENTENCE),
  ];
  const out: { where: string; sentence: string; ok: boolean }[] = [];
  for (const entry of translateOcrSurfaces(copy)) {
    const sentences = sentencesOf(entry.text);
    sentences.forEach((sentence, i) => {
      if (!SCAN_CLAIM(sentence)) return;
      const bothBranches =
        CAN_BRANCH.test(sentence) && CANNOT_BRANCH.test(sentence);
      const inherited =
        followUps.includes(sentence) &&
        sentences.slice(0, i).join(" ").includes(TRANSLATE_SCAN_ROUTE);
      out.push({
        where: `${entry.slug} ${entry.where}`,
        sentence,
        ok: bothBranches || inherited,
      });
    });
  }
  return out;
}

describe("a sentence saying a scan is recognised names both worker states", () => {
  it("health check: the surfaces and the claims are found, and the route sentence is among them", () => {
    const surfaces = translateOcrSurfaces(COPY);
    expect(new Set(surfaces.map((e) => e.slug)).size).toBeGreaterThanOrEqual(2);
    const claims = translateScanClaims(COPY);
    // Measured 2026-11-09 after the fix: 11 claim sentences over 7 entries.
    // A collapse to a handful is the derivation going blind, not clean copy.
    expect(claims.length).toBeGreaterThanOrEqual(8);
    expect(claims.length).toBeLessThanOrEqual(40);
    const route = sentencesOf(TRANSLATE_SCAN_ROUTE).filter(SCAN_CLAIM);
    expect(route).toHaveLength(1);
    expect(claims.some((c) => c.sentence === route[0])).toBe(true);
  });

  it("every claim on Translate's surfaces carries both branches", () => {
    expect(
      translateScanClaims(COPY)
        .filter((claim) => !claim.ok)
        .map((claim) => `${claim.where}: ${claim.sentence}`),
    ).toEqual([]);
  });

  it.each([
    [
      "the unconditional route sentence",
      "A scan has no selectable text, so Translate PDF asks which languages are printed on the page, recognises the text on our server (OCR) and then translates it.",
    ],
    ["the heading that shipped", "Scanned PDFs are recognised first"],
    [
      "the step that shipped",
      "Your browser counts the text first; a scan is recognised on our server before it is translated, which takes longer.",
    ],
    [
      "only the 'can' branch",
      "When our server can recognise scans, a scan is recognised first.",
    ],
  ])("positive control: %s is caught", (_name, text) => {
    const planted: CopyEntry = {
      slug: TRANSLATE_OCR_TOOL,
      where: "how[3]",
      text,
    };
    expect(translateScanClaims([planted]).map((c) => c.ok)).toEqual([false]);
  });

  it("control: a follow-up sentence with no route sentence before it is not exempt", () => {
    const planted: CopyEntry = {
      slug: TRANSLATE_OCR_TOOL,
      where: "faq[1].answer",
      text: TRANSLATE_OCR_SCOPE,
    };
    expect(translateScanClaims([planted]).map((c) => c.ok)).toEqual([false]);
  });
});

describe("the docxRunStyles subject (backlog #28 slice 1, 2026-11-15)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). Measured when the key landed, over the
   * whole corpus (5,239 entries): exactly these eight — PDF to Word's
   * intro[0], its look FAQ answer and its keep FAQ answer (PDF_TO_WORD_KEEPS),
   * and the convert guide's intro, two section paragraphs, step 6 and the
   * look FAQ answer. A member elsewhere is a formatting sentence nobody
   * paired; a missing one is the subject going blind to the copy it guards.
   * NINE since review round 1 the same day: the add-text guide's "Changing
   * the text that is already there", which had said PDF to Word exports
   * "plain paragraphs" and now says each word keeps its formatting — so a
   * heartbeat that denies docxRunStyles hedges it too.
   */
  it("reaches the Word formatting sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.docxRunStyles!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual(
      [
        "pdf-to-word intro[0]",
        "pdf-to-word faq[0].answer",
        "pdf-to-word faq[7].answer",
        "guide:how-to-convert-pdf-to-word intro[0]",
        "guide:how-to-convert-pdf-to-word sections[0].body[0]",
        "guide:how-to-convert-pdf-to-word sections[0].body[1]",
        "guide:how-to-convert-pdf-to-word steps[5]",
        "guide:how-to-convert-pdf-to-word faq[4].answer",
        "guide:how-to-add-text-to-a-pdf sections[2].body[0]",
      ].sort(),
    );
  });

  it("positive control: a deferral planted in the intro's formatting sentence is caught", () => {
    const planted: CopyEntry = {
      slug: "pdf-to-word",
      where: "intro[0]",
      text: "Each word keeps its bold, italics, text size and colour (coming soon).",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "docxRunStyles"'),
      ),
    ).toBe(true);
  });
});

describe("the docxTables subject (backlog #28 slice 2, 2026-11-15)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). CHANGED 2026-11-15 (review round 2):
   * eleven, not thirteen — the scanned-PDF and Bangla-PDF guides' "not
   * carried over" paragraphs no longer mention tables (nothing tests that a
   * table is recognised from OCR text, so those guides now say a scanned
   * table "may come through as a Word table or as lines of text", in their
   * "comes through" paragraphs, which stay members). Measured when the key
   * landed, over the whole corpus: exactly these thirteen — PDF to Word's intro[1], its look
   * FAQ answer, its tables FAQ answer and its keep FAQ answer
   * (PDF_TO_WORD_KEEPS); the convert guide's two section paragraphs and its
   * look FAQ answer (PDF_TO_WORD_KEEPS again); the add-text guide's pointer
   * to PDF to Word; the scanned-PDF and Bangla-PDF guides' "comes through"
   * paragraphs and their "not carried over" paragraphs (which said "fonts,
   * columns, tables and spacing are not carried over" — no "Word" in the
   * sentence, so this subject never saw them; the table rule in
   * claims-vs-capability.test.ts caught them); and OCR PDF's answer pointing
   * to PDF to Word. Decided, not
   * found: NO Word to PDF, Extract Tables or PDF to Excel sentence is a
   * member — their table sentences are about a Word file going the other
   * way or about spreadsheets, never about what PDF to Word writes, so a
   * heartbeat that denies docxTables has nothing to hedge there.
   */
  it("reaches the Word table sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.docxTables!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual(
      [
        "pdf-to-word intro[1]",
        "pdf-to-word faq[0].answer",
        "pdf-to-word faq[3].answer",
        "pdf-to-word faq[7].answer",
        "ocr-pdf faq[1].answer",
        "guide:how-to-convert-pdf-to-word sections[0].body[0]",
        "guide:how-to-convert-pdf-to-word sections[0].body[1]",
        "guide:how-to-convert-pdf-to-word faq[4].answer",
        "guide:how-to-add-text-to-a-pdf sections[2].body[0]",
        "guide:how-to-convert-a-scanned-pdf-to-word sections[0].body[0]",
        "guide:how-to-convert-bangla-pdf-to-word sections[0].body[0]",
      ].sort(),
    );
  });

  it("positive control: a deferral planted in the tables answer is caught", () => {
    const planted: CopyEntry = {
      slug: "pdf-to-word",
      where: "faq[3].answer",
      text: "A table whose cells each fit on one line comes through as a Word table (coming soon).",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "docxTables"'),
      ),
    ).toBe(true);
  });
});

describe("the docxTableWraps subject (backlog #28 slice 3, 2026-11-16)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). Measured 2026-11-16 with PR-1's
   * INTERIM copy, over the whole corpus: exactly these seven, every one a
   * sentence about what PDF to Word does with a wrapped cell — PDF to
   * Word's intro[1] and its tables FAQ answer; PDF_TO_WORD_KEEPS, wherever
   * it is served (PDF to Word's keep FAQ answer, the convert guide's first
   * section paragraph and its look FAQ answer); the convert guide's second
   * section paragraph ("only when it has at least three rows …"); and the
   * add-text guide's pointer to PDF to Word. The rest of this file stays
   * green over all seven, so the interim sentence ("may come through as one
   * Word table, each wrapped cell kept in its row, or as a smaller table and
   * lines of text, or as lines of text alone") describes outcomes and does
   * not read as a deferral of the capability.
   *
   * Re-measured 2026-11-16 with PR-2's DEFINITE copy: the same seven
   * entries, the rest of this file still green over them. The intro, the
   * tables FAQ and PDF_TO_WORD_KEEPS now carry the definite sentence ("…
   * stays in its row as one paragraph, except in a table's first column …"),
   * reached by "stays in its row"; the two guide sentences carry "may stay
   * in its row", reached both by wrap + Word + table and by "stay in its
   * row".
   *
   * Decided, not found: NO PDF to Excel or Extract Tables sentence is a
   * member. The PDF to Excel guide's "gives you two rows" (a wrapped cell in
   * a spreadsheet) and Extract Tables' "a cell that wraps in the first
   * column ends its table" and its centred-note sentence are about a
   * detector slice 3 does not change, and they name no Word, so a heartbeat
   * that denies docxTableWraps has nothing to hedge there. They are kept
   * out by the shape (wrap AND Word/DOCX AND table), not by an exclusion.
   */
  it("reaches the Word wrapped-cell sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.docxTableWraps!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual(
      [
        "pdf-to-word intro[1]",
        "pdf-to-word faq[3].answer",
        "pdf-to-word faq[7].answer",
        "guide:how-to-convert-pdf-to-word sections[0].body[0]",
        "guide:how-to-convert-pdf-to-word sections[0].body[1]",
        "guide:how-to-convert-pdf-to-word faq[4].answer",
        "guide:how-to-add-text-to-a-pdf sections[2].body[0]",
      ].sort(),
    );
  });

  it("positive control: a deferral planted in the wrapped-cell sentence is caught", () => {
    const planted: CopyEntry = {
      slug: "pdf-to-word",
      where: "faq[3].answer",
      text: "A table whose cells wrap onto further lines comes through as one Word table, each wrapped cell kept in its row (coming soon).",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "docxTableWraps"'),
      ),
    ).toBe(true);
  });

  it("positive control: the definite shape alone (no table, no Word) is reached", () => {
    expect(
      SUBJECTS.docxTableWraps!.subject.test(
        "A cell whose text continues onto the lines below it stays in its row.",
      ),
    ).toBe(true);
  });
});

describe("the docxTypefaces subject (backlog #28 slice 4, 2026-11-15)", () => {
  /**
   * BOTH DIRECTIONS (house rule 1). Measured when the key landed, over the
   * whole corpus: exactly these thirteen — PDF to Word's intro[0] (the font
   * sentence), its Track Changes use case ("starts out in standard Office
   * fonts"), its look FAQ answer, its keep FAQ answer (PDF_TO_WORD_KEEPS)
   * and its catalogue description ("in reading order and Office fonts");
   * the convert guide's intro, its first section paragraph, its "open it in
   * Word" step and its look FAQ answer; the add-text guide's pointer to PDF
   * to Word; the Bangla-PDF guide's paragraph on the Bengali font Word
   * picks (true: Bengali words carry no font name); and TWO Word to PDF
   * sentences about the fonts of a Word file going the other way, through
   * LibreOffice. Decided, not found: those two stay members — a hedge there
   * would not be about this key, but no shape tells them from PDF to Word's
   * own "Word … font" sentences without missing some of those. NO PDF to
   * PowerPoint sentence is a member: "A font that comes with Windows or
   * Office keeps its name" is the deck's, and the either-order branches
   * name Word and DOCX, not Office, for that reason.
   */
  it("reaches the Word typeface sentences, and nothing else", () => {
    const members = COPY.filter((entry) =>
      SUBJECTS.docxTypefaces!.subject.test(entry.text),
    ).map((entry) => `${entry.slug} ${entry.where}`);
    expect(members.sort()).toEqual(
      [
        "pdf-to-word intro[0]",
        "pdf-to-word useCases[3].body",
        "pdf-to-word faq[0].answer",
        "pdf-to-word faq[7].answer",
        "pdf-to-word description",
        "guide:how-to-convert-pdf-to-word intro[0]",
        "guide:how-to-convert-pdf-to-word sections[0].body[0]",
        "guide:how-to-convert-pdf-to-word steps[5]",
        "guide:how-to-convert-pdf-to-word faq[4].answer",
        "guide:how-to-add-text-to-a-pdf sections[2].body[0]",
        "guide:how-to-convert-bangla-pdf-to-word sections[0].body[2]",
        "guide:how-to-convert-word-to-pdf sections[0].body[0]",
        "word-to-pdf intro[1]",
      ].sort(),
    );
  });

  it("positive control: a deferral planted in the font sentence is caught", () => {
    const planted: CopyEntry = {
      slug: "pdf-to-word",
      where: "intro[0]",
      text: "Each word it matches is also set in a font that comes with Windows or Office (coming soon).",
    };
    expect(
      hedgeOffenders([planted], []).some((line) =>
        line.includes('hedges "docxTypefaces"'),
      ),
    ).toBe(true);
  });
});
