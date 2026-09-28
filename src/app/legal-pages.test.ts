// @vitest-environment node
/**
 * The policy pages must stay true, reachable, and consistent with each other.
 *
 * A privacy policy is the highest-stakes place in a product to state something
 * that is not true, and this codebase has shipped that failure twice: a pipeline
 * description claiming every file was malware-scanned while no scanner was
 * configured, and a homepage claiming layout-preserving translation the engine
 * explicitly disclaims. Both were prose written next to a picture instead of
 * next to the code.
 *
 * So the pages DERIVE their figures — tool counts from the catalogue, retention
 * windows from `DEFAULT_RETENTION`, the size cap from `JOB_LIMITS` — and this
 * guard checks that they still do. Hard-coding "60 minutes" into the page would
 * pass a reader's eye and silently become false the day the constant changes.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_LIMITS } from "@/lib/jobs/types";
import { LEGAL_CONTACT, LEGAL_ENTITY, LEGAL_UPDATED } from "@/lib/legal";
import { tools } from "@/lib/tools";
import { processingSplit } from "@/lib/tools/processing-split";
import { toolContentFiles } from "@/lib/tools/copy-surface";

const ROOT = process.cwd();
const PRIVACY = path.join(ROOT, "src", "app", "privacy", "page.tsx");
const TERMS = path.join(ROOT, "src", "app", "terms", "page.tsx");
const FOOTER = path.join(
  ROOT,
  "src",
  "components",
  "layout",
  "site-footer.tsx",
);
const SITEMAP = path.join(ROOT, "src", "app", "sitemap.ts");

const read = (file: string) => readFileSync(file, "utf8");
/**
 * Source with comments removed.
 *
 * These guards scan prose, and a docblock explaining the defect a guard exists
 * to prevent will contain the very phrase it forbids — which is exactly what
 * happened: the privacy page's comment cites the old "layout-preserving
 * translation" claim, and its note about a rendering bug quotes "60minutes".
 * Flagging those is a false positive, and a guard that cries wolf is a guard the
 * next person weakens. Only what a user can read counts.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Prose with every DERIVED value removed: template interpolations (`${...}`)
 * and JSX expressions that are a bare name or member path (`{outputWindow}`,
 * `{RETENTION_WINDOWS.jobRecord}`). Only those two shapes — stripping every
 * `{...}` would also strip the object literal that holds the page's metadata
 * description, and a description is prose a search engine shows.
 */
function withoutInterpolations(source: string): string {
  return source
    .replace(/\$\{[^{}]*\}/g, " ")
    .replace(/\{\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\}/g, " ");
}

/**
 * A duration written out: a quantity — digits, "a"/"an"/"one", "a few",
 * "several", optionally after "~" — and a unit of time. Every gap is `\s+`:
 * this scans JSX source, where prose wraps mid-phrase.
 */
const DURATION_SHAPE =
  /(?:~\s*)?\b(?:\d+|an?|one|two|three|a\s+few|a\s+couple\s+of|several)\s+(?:minutes?|hours?|days?|weeks?)\b/gi;

/**
 * WHERE THE MALWARE-SCANNING CLAIM IS GUARDED — deliberately not here.
 *
 * The privacy page states plainly that uploaded files are scanned. That is a
 * claim about a RUNNING SERVICE, and nothing in this file can observe whether
 * clamd answers. A test asserting the sentence exists beside a constant would
 * restate the claim, not check it — the decoration problem.
 *
 * It is true by construction instead: `PDFXYZ_WORKER_REQUIRE_SCAN` arms a
 * guardrail that refuses to start a deployment with no scanner configured, and
 * `worker:release-gate` runs `ops-check`, which exits 4 when scanning is
 * required but not active — so a promotion cannot carry the claim past a dead
 * scanner.
 *
 * If you came here to add a guard for that sentence: the honest one is
 * operational, not a unit test. Check the guardrail is still armed and the gate
 * still runs before promotion.
 */
describe("the policy pages exist and are reachable", () => {
  it.each([
    ["privacy", PRIVACY],
    ["terms", TERMS],
  ])("/%s is a real page", (_name, file) => {
    expect(read(file)).toContain("export default function");
  });

  it("the footer links to both, not to a homepage anchor", () => {
    const footer = read(FOOTER);
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/terms"');
    // The old links pointed at marketing sections on the landing page. A visitor
    // looking for the policy would have been handed a sales pitch.
    expect(footer).not.toContain('href="/#privacy"');
  });

  it("both are in the sitemap", () => {
    const sitemap = read(SITEMAP);
    expect(sitemap).toContain('url("/privacy")');
    expect(sitemap).toContain('url("/terms")');
  });
});

describe("the policy pages derive their facts rather than restating them", () => {
  it("neither hard-codes a duration, in any spelling", () => {
    // WAS a ban on the one spelling /\b60\s*minutes\b/, and it was green while
    // the privacy page told readers "we delete files within an hour" and
    // described its own metadata as "after an hour" — the same figure one
    // spelling over, and a false one besides (see legal-retention.test.tsx).
    // A literal ban reports "no figure in the words I know". So the ban is on
    // the SHAPE — a quantity and a unit of time — over the prose a reader
    // gets, with every derived value (`${...}`, `{window}`) stripped first:
    // a duration may appear on these pages only as an interpolation of the
    // constant that owns it (`src/lib/retention-windows.ts`).
    for (const [name, file] of [
      ["privacy", PRIVACY],
      ["terms", TERMS],
    ] as const) {
      const source = read(file);
      expect(
        source,
        `${name} should state its windows from the one shared derivation`,
      ).toContain("RETENTION_WINDOWS");
      const prose = withoutInterpolations(withoutComments(source));
      // Health: the stripping must leave the page's prose, not eat it.
      expect(prose.length, `${name}'s prose was stripped away`).toBeGreaterThan(
        source.length / 2,
      );
      const found = [...prose.matchAll(DURATION_SHAPE)].map((m) => m[0]);
      expect(
        found,
        `${name} hand-writes a duration instead of interpolating the constant that owns it:\n  ${found.join("\n  ")}`,
      ).toEqual([]);
    }
  });

  it("the duration ban catches every spelling that shipped, and spares what it must", () => {
    // House rule 1, both directions. Each positive was on /privacy or /terms
    // before 2026-09-27; each negative is true prose, or a derivation, that
    // must never trip it.
    const caught = [
      "60 minutes",
      "an hour",
      "delete files within an hour",
      "stops serving the result after an hour",
      "a few hours longer than the link does",
      "is kept\n              for about 24 hours",
      "that job record for the same ~24 hours",
      "about a day",
    ];
    for (const text of caught) {
      expect(
        [...text.matchAll(DURATION_SHAPE)],
        `the ban no longer catches: ${text}`,
      ).toHaveLength(1);
    }
    const spared = [
      "that cache lasts minutes, not days",
      "runs on a daily cycle",
      "You must be at least 13 years old.",
      "after {outputWindow}",
      "after {RETENTION_WINDOWS.outputLink}",
      "`stops serving the result after ${RETENTION_WINDOWS.outputLink}.`",
      "`${DEFAULT_RETENTION.outputTtlMinutes} minutes`",
    ];
    for (const text of spared) {
      expect(
        [...withoutInterpolations(text).matchAll(DURATION_SHAPE)].map(
          (m) => m[0],
        ),
        `the ban trips on honest text: ${text}`,
      ).toEqual([]);
    }
  });

  it("privacy derives its tool counts from the shared catalogue split", () => {
    // WAS `toContain("tools.reduce")`, and it passed for two months while the
    // page disagreed with the homepage. Reducing the catalogue here IS
    // deriving — it was never a literal — so this assertion could only ever
    // see that the page did arithmetic, not that it did the SAME arithmetic as
    // every other surface. The mechanism was the exit condition; the property
    // is "one function over the catalogue", so that is what it names now.
    const source = read(PRIVACY);
    expect(source).toContain("processingSplit");
    // The split it describes must be the real one.
    const { neverUploads } = processingSplit();
    expect(neverUploads.length).toBeGreaterThan(0);
    expect(neverUploads.length).toBeLessThan(tools.length);
  });

  it("terms derives the file size cap", () => {
    expect(read(TERMS)).toContain("JOB_LIMITS.maxFileBytes");
    expect(JOB_LIMITS.maxFileBytes).toBeGreaterThan(0);
  });

  it("both carry the same entity, contact and date, from one source", () => {
    // Two policy documents naming different companies is the kind of small
    // inconsistency that undermines both, and it is invisible to a reader who
    // only opens one of them.
    for (const file of [PRIVACY, TERMS]) {
      const source = read(file);
      expect(source).toContain("LEGAL_CONTACT");
      expect(source).toContain("LEGAL_UPDATED");
      expect(source).toContain("LEGAL_ENTITY");
    }
    expect(LEGAL_CONTACT).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(LEGAL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("names a real operating company, not a placeholder", () => {
    // A policy whose controller is "[Company Name]" or just a domain identifies
    // nobody, and a data-subject request has nowhere to go.
    expect(LEGAL_ENTITY.name).toMatch(/\S/);
    expect(LEGAL_ENTITY.name).not.toMatch(/\[|TODO|placeholder|your company/i);
    expect(LEGAL_ENTITY.name.toLowerCase()).not.toBe("pdf.xyz");
    expect(LEGAL_ENTITY.address.length).toBeGreaterThanOrEqual(2);
    expect(LEGAL_ENTITY.jurisdiction).toMatch(/\S/);
  });

  it("the terms state a governing law", () => {
    // Without one, every dispute starts with an argument about where it happens.
    const source = withoutComments(read(TERMS));
    expect(source).toMatch(/governed by the laws of/i);
    expect(source).toContain("LEGAL_ENTITY.jurisdiction");
  });

  it("the footer's copyright names the company", () => {
    expect(read(FOOTER)).toContain("LEGAL_ENTITY.name");
  });
});

describe("the policy pages do not promise what the product does not do", () => {
  /**
   * Phrases that are tempting in a privacy policy and that this product cannot
   * support. Each is paired with what is actually true, so a failure explains
   * itself rather than just forbidding a word.
   */
  const OVERCLAIMS: { pattern: RegExp; instead: string }[] = [
    {
      pattern: /\bend-to-end encrypt/i,
      instead:
        "files are encrypted in transit and processed server-side for worker tools, which is not end-to-end encryption",
    },
    {
      pattern: /\bzero[- ]knowledge\b/i,
      instead:
        "the worker necessarily reads the file it processes, so zero-knowledge is false",
    },
    {
      pattern: /\bwe never (?:see|store|receive) (?:your |any )?files?\b/i,
      instead:
        "true only of the in-browser tools; the worker tools do receive the file",
    },
    {
      // Every verb a writer actually reaches for, not just the one first found.
      // The original pattern was /\bpermanently delet/i, and the homepage said
      // "permanently ERASED" — same lie, one synonym over, and the guard read
      // clean. A guard that misses a synonym does not report "no claim"; it
      // reports "no claim in the words I know", and the clean result got read
      // as evidence of honesty. Stemmed so -ed/-es/-ing all match.
      pattern: /\bpermanently (?:delet|eras|destroy|wip|remov|purg)/i,
      instead:
        "say what is done and when (deleted within the retention window) rather than claiming an absolute",
    },
    {
      // Proposed in TASK-07, built after the homepage proved the need: this is
      // the rule that catches the instance the file-widening missed. "Nothing
      // is retained" carries no digits, so the numbers census can never see it.
      pattern: /\bnothing is (?:retained|stored|kept)\b/i,
      instead:
        "the job record (including the filename) is kept ~24 hours; say what is kept and for how long",
    },
    {
      pattern: /\b(?:fully|completely) (?:GDPR|CCPA)[- ]compliant\b/i,
      instead:
        "compliance is not a self-certifiable badge; describe the practices instead",
    },
    {
      // The owner is deferring the Art. 27 appointment (2026-08-10), which
      // makes this the claim we are one careless sentence away from: only the
      // possessive/claiming form is banned, because an honest DENIAL ("we
      // have not appointed an EU representative") must never trip it — the
      // invitation-vs-denial lesson from the account guard, applied here.
      pattern: /\bour (?:EU|EEA|UK|Article 27) representative\b/i,
      instead:
        "no Art. 27 representative is appointed; data-subject requests go to LEGAL_CONTACT and are answered there — do not claim a representative until one exists",
    },
    {
      // The first draft of this page said the result was "deleted" after the
      // output window. It is not: `retrieval-storage.ts` denies the read with a
      // 410 once the signed lifecycle metadata says the window passed, and the
      // bytes are erased later by a bucket rule whose granularity is DAYS —
      // `minutesToBackstopDays` turns a 60-minute TTL into a 1-day rule. The
      // link dying and the bytes dying are different events, hours apart, and
      // conflating them is the kind of small overstatement a policy cannot make.
      pattern: /\bresults? (?:are|is) deleted\b/i,
      instead:
        "the result stops being downloadable after the window; say that, and say the stored copy is erased by a daily storage rule (see minutesToBackstopDays in src/lib/workers/lifecycle/policy.ts)",
    },
    {
      pattern:
        /\bdeletes? (?:the )?(?:input and|inputs? and) (?:the )?(?:result|output)s?\b/i,
      instead:
        "inputs are actively deleted at job end; outputs are denied at read time and erased later — one sentence cannot honestly cover both",
    },
    {
      // Caught: "…and in any case within 60 minutes" (privacy §2, until
      // 2026-09-27). Pinned INVERTED. The only code that deletes an upload runs
      // for a claimed job; an upload that never becomes one lives until the
      // daily lifecycle rule. Exit condition — the PROPERTY: every `inputs/`
      // object older than the input TTL is deleted by code running in the
      // production worker (published in its heartbeat, and an observed orphan
      // upload gone after the window). A sweeper in source is not that.
      pattern: /\bin\s+any\s+case\s+within\b/i,
      instead:
        "state what deletes an upload and when: at the job's end, or — for an upload that never becomes a job — by the daily storage rule after RETENTION_WINDOWS.inputStorageRule",
    },
    {
      // Caught: "because we hold no accounts and delete files within an hour"
      // (privacy §10, until 2026-09-27). Pinned INVERTED. Uploads, stored
      // results and job records have three different clocks; one duration
      // cannot cover them, and the one chosen covered none.
      pattern: /\bdelete\s+(?:all\s+|your\s+|the\s+)?files\s+within\b/i,
      instead:
        "name each clock: uploads end with the job (or the daily rule), the link dies after RETENTION_WINDOWS.outputLink, the job record after RETENTION_WINDOWS.jobRecord",
    },
    // ------------------------------------------------------------------ //
    // The three entries below were TRUE sentences on this very page until
    // 2026-08-25, when consent-gated Google Analytics shipped (owner's call,
    // matching the market leader). They are pinned here INVERTED, per house
    // rule, so a later edit cannot resurrect a formerly-true absolute: each
    // pattern was checked against the removed sentence it used to describe.
    // ------------------------------------------------------------------ //
    // Every gap in these three is \s+ (and the wildcard [\s\S]), because the
    // scan runs on JSX SOURCE, where prose wraps mid-phrase: the very sentence
    // the second pattern exists for was committed as "…a consent\n banner",
    // and the single-space version of that pattern read the old page as clean
    // on its first corpus run. A phrase search has a hole at every wrap.
    {
      // Caught: "There is no analytics vendor, no advertising pixel, and…"
      pattern: /\bno\s+analytics\s+vendor\b/i,
      instead:
        "Google Analytics is a consent-gated vendor since 2026-08-25; describe the gate (nothing loads before an explicit yes), not an absence",
    },
    {
      // Caught: "…which is why you are not being asked to dismiss a consent banner."
      pattern: /\bnot\s+being\s+asked\s+to\s+dismiss\s+a\s+consent\s+banner\b/i,
      instead:
        "a consent banner exists now; the honest sentence is what pressing each button does",
    },
    {
      // Caught: "We use no advertising cookies, no analytics cookies, and…"
      // The honest CONDITIONAL denial ("decline and no analytics cookie is
      // ever set") must never trip this, so only the unconditional "we use
      // no … analytics cookies" form is banned.
      pattern: /\bwe\s+use\s+no\s+[\s\S]{0,40}analytics\s+cookies\b/i,
      instead:
        "analytics cookies exist after consent; say when they are set and that declining sets none",
    },
  ];

  it.each([
    ["privacy", PRIVACY],
    ["terms", TERMS],
  ])("/%s makes no unsupported claim", (name, file) => {
    const source = withoutComments(read(file));
    const found = OVERCLAIMS.filter((o) => o.pattern.test(source)).map(
      (o) => `${String(o.pattern)} — ${o.instead}`,
    );
    expect(
      found,
      `${name} contains a claim this product cannot support:\n  ${found.join("\n  ")}`,
    ).toEqual([]);
  });

  it("neither does the marketing copy the legal pages sit one click from", () => {
    // The guard above was scoped to where the overclaims were FOUND, not to
    // where they can APPEAR — and the FAQ proved the difference on 2026-08-09:
    // it said "permanently deleted within minutes … nothing is retained" while
    // /privacy, one click away, stated the truth this list encodes. The FAQ
    // also feeds the FAQPage JSON-LD, so the overclaim shipped to crawlers as
    // structured data. Same walk as the marketing-honesty guards: every
    // sections component plus the FAQ source.
    const sectionsDir = path.join(ROOT, "src", "components", "sections");
    const targets = [
      path.join(ROOT, "src", "lib", "faq.ts"),
      // The per-tool facts/FAQ source: added to this walk BEFORE its first
      // answer was written (TASK-20), because its FAQ entries feed FAQPage
      // JSON-LD — the same channel that carried the fabricated pricing and
      // the retention lie to crawlers.
      path.join(ROOT, "src", "lib", "tools", "tool-facts.ts"),
      // The guides catalogue, added the same way on 2026-09-17 — before its
      // first article was written. Guides state retention and privacy facts
      // as a matter of course, which is exactly this list's vocabulary.
      path.join(ROOT, "src", "lib", "guides", "catalog.ts"),
      // The fifty tool pages' authored content, added 2026-09-27 BEFORE it
      // shipped — the same in-order rule as tool-facts and the guides. Its
      // FAQs become FAQPage JSON-LD. DERIVED from the content index (what the
      // page consumes), not listed, so a fifty-first tool is read on arrival.
      ...toolContentFiles().values(),
      ...readdirSync(sectionsDir)
        .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
        .map((f) => path.join(sectionsDir, f)),
    ];
    // Health check: the derived content set is the catalogue, not a sliver.
    expect([...toolContentFiles().keys()].sort()).toEqual(
      tools.map((t) => t.slug).sort(),
    );
    const offenders: string[] = [];
    for (const file of targets) {
      const source = withoutComments(read(file));
      for (const o of OVERCLAIMS) {
        if (o.pattern.test(source)) {
          offenders.push(
            `${path.relative(ROOT, file).replace(/\\/g, "/")}: ${String(o.pattern)} — ${o.instead}`,
          );
        }
      }
    }
    expect(
      offenders,
      `marketing copy contains a claim the legal pages are forbidden from making:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("positive control: a retired claim planted in real tool content is caught", () => {
    // A real content file, with the FAQ lie of 2026-08-09 planted in one of
    // its answers. Same scan, same list: if the tool content ever falls out
    // of `targets` above, the corpus test stops reading it; this shows the
    // list still bites on content-shaped source when it is read.
    const file = toolContentFiles().get("merge-pdf")!;
    const real = withoutComments(read(file));
    expect(OVERCLAIMS.filter((o) => o.pattern.test(real))).toEqual([]);
    const planted = real.replace(
      "Merge copies pages",
      "Your files are permanently deleted within minutes and nothing is retained. Merge copies pages",
    );
    expect(planted).not.toBe(real);
    const caught = OVERCLAIMS.filter((o) => o.pattern.test(planted)).map((o) =>
      String(o.pattern),
    );
    expect(caught.length).toBeGreaterThanOrEqual(2);
  });
});
