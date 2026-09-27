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
 *     is named here.
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
import { howToSteps, toolFacts, toolFaq } from "./tool-facts";

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
    at("tagline", tool.tagline);
    at("description", tool.description);
    tool.keywords.forEach((k, i) => at(`keywords[${i}]`, k));
    howToSteps(tool).forEach((s, i) => at(`how[${i}]`, s));
    toolFacts(tool.slug).forEach((f, i) => {
      at(`facts[${i}].label`, f.label);
      at(`facts[${i}].value`, f.value);
    });
    toolFaq(tool).forEach((f, i) => {
      at(`faq[${i}].question`, f.question);
      at(`faq[${i}].answer`, f.answer);
    });
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
  pptxPresentationChain: {
    // The EXPORT to PowerPoint, not PowerPoint to PDF. Measured 2026-09-27
    // against the live catalogue: 15 sentences mention PowerPoint, slides or
    // PPTX; this matches the 7 that belong to pdf-to-powerpoint ("an editable
    // PowerPoint slide" per page, the promise the capability backs) and none
    // of the 8 that belong to powerpoint-to-pdf ("one slide per page").
    subject:
      /PDF to PowerPoint|pdf to (?:pptx|slides)|editable (?:PowerPoint )?slides?/i,
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
};

/**
 * Sentences that ARE deferrals — the positive control for every pattern above.
 *
 * The first entry is the real one. Per house rule 7 a test that pinned a defect
 * is inverted rather than deleted, so the sentence `catalog.ts` actually shipped
 * for forty days stays here as evidence, and the assertions about it now run the
 * other way: the detector must still catch it, and the catalogue must no longer
 * contain it.
 */
const HEDGES_IN_THE_WILD: readonly string[] = [
  // ── the shipped defect, kept as the fixture it became ──
  "For image-heavy files, deep compression runs on a secure worker (coming soon).",
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
    const offenders: string[] = [];
    for (const key of WIRE_KEYS) {
      const pairing = SUBJECTS[key];
      // A capability with no subject matcher is a capability this rule cannot
      // see. The pairing test above already fails on it; skipping silently here
      // would leave THIS test green on the same hole, and a green next to a red
      // is how a hole gets argued away.
      expect(pairing, `${key} has no subject matcher`).toBeDefined();
      if (!pairing) continue;
      const { subject } = pairing;
      for (const entry of COPY) {
        if (!subject.test(entry.text)) continue;
        for (const [shape, re] of Object.entries(HEDGES)) {
          if (re.test(entry.text)) {
            offenders.push(
              `${entry.slug} ${entry.where} hedges "${key}" with "${shape}": "${entry.text}"`,
            );
          }
        }
      }
    }
    expect(
      offenders,
      `the worker publishes these capabilities in its heartbeat, and this copy — which also ships as HowTo JSON-LD — tells readers they are unshipped:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
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
});
