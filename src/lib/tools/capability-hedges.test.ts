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
 *                      working "Compress images on the worker" button three
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
import { toolFacts } from "./tool-facts";
import {
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
  "If it says Not enabled or Status unknown, there is nowhere to add a file yet.",
  // `while … refuses`: while as time with no refusal, and while as contrast.
  "While the job runs, the button reads Uploading your file…, Waiting for the worker…, Extracting tables… and Downloading the result… in turn.",
  "Only the .html travels here, so text written into the markup survives, while the styling and pictures in that folder do not.",
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
      return hedgeOffenders(copy, faqPairs(copy)).map((line) =>
        line.slice(0, line.indexOf(" hedges ")),
      );
    };
    for (const where of ["how[3]", "useCases[1].body"])
      expect(plant(page, where)).toEqual([`${page} ${where}`]);
    // Read whole only on its OWN page. The same words on a page no capability
    // owns are about nothing this rule reads, and stay out.
    const owned = new Set(
      Object.values(SUBJECTS).flatMap(({ subject }) => [
        ...ownPages(subject, COPY),
      ]),
    );
    const elsewhere = COPY.find(
      (entry) => entry.where === "how[3]" && !owned.has(entry.slug),
    );
    expect(elsewhere).toBeDefined();
    if (!elsewhere) return;
    expect(plant(elsewhere.slug, "how[3]")).toEqual([]);
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
