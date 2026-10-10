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
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { BROWSER_STORAGE } from "@/lib/browser-storage";
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

/** A page as the text a reader receives: tags out, entities decoded, one space. */
function renderedText(Page: ComponentType): string {
  return renderToStaticMarkup(createElement(Page))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
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
 * THIS NOTE USED TO SAY THE CLAIM WAS "TRUE BY CONSTRUCTION", and that was the
 * defect (legal-pages sweep, 2026-10-10, row 7). It said
 * `PDFXYZ_WORKER_REQUIRE_SCAN` refuses to start a deployment with no scanner,
 * and that `worker:release-gate` stops a promotion past a dead scanner. The
 * flag is OPT-IN and strict mode does not imply it (`guardrails.ts`), and the
 * release gate reads committed blueprints and fixtures, never the live worker
 * (`docs/DEPLOYMENT.md`). The page repeated the first half to readers — "a
 * deployment with no scanner refuses to start" — and it is banned below.
 *
 * What holds the claim today is production itself: the live worker status
 * reported `scan.active = true` at the wire on 2026-10-10, and /privacy points
 * readers to /status, which renders that live answer. That is an observation,
 * not a construction; `privacy-truth.test.tsx` keeps the page from promising
 * more than `evaluateGuardrails` enforces.
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
  const OVERCLAIMS: { pattern: RegExp; instead: string; shipped?: string }[] = [
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
    // ------------------------------------------------------------------ //
    // The entries below were on /privacy until 2026-10-10, when a sweep of
    // the legal pages against the code (the Art. 30 record, the pack's §5
    // rows 1-18) found each one false or unsupported. Each carries the
    // sentence it was written from in `shipped`, and the corpus test below
    // requires the pattern to catch it (house rule 1, both directions).
    // `privacy-truth.test.tsx` holds the page to the code in the positive
    // direction; these keep the old words from coming back anywhere the list
    // is read, which includes the marketing walk.
    // ------------------------------------------------------------------ //
    {
      // Row 12. script-src carries 'unsafe-inline' and 'wasm-unsafe-eval'
      // (next.config.mjs). Exit — the PROPERTY: the served script-src allows
      // neither; privacy-truth.test.tsx reads the header itself.
      pattern: /\bstrict\s+Content\s+Security\s+Policy\b/i,
      instead:
        "the CSP allows inline scripts; describe what it limits, and say that it allows inline scripts",
      shipped:
        "The site sets a strict Content Security Policy and related protections against common web attacks.",
    },
    {
      // Row 7. PDFXYZ_WORKER_REQUIRE_SCAN is opt-in and strict mode does not
      // imply it. Exit — the PROPERTY: a worker with no active scanner cannot
      // start in PRODUCTION, observed there (not a flag in source).
      pattern:
        /\b(?:with\s+no\s+scanner|without\s+a\s+scanner|scanner-less)[^.]{0,40}\brefuses?\s+to\s+(?:start|run)\b/i,
      instead:
        "say that uploads are scanned and point to /status for the live answer; nothing in the code makes a scanner-less worker refuse to start",
      shipped:
        "a deployment with no scanner refuses to start, so this is not a setting that can quietly lapse.",
    },
    {
      // Rows 6 and 3. Uploads and results sit in Cloudflare R2, a processor.
      pattern: /\b(?:storage|infrastructure)\s+we\s+(?:control|own)\b/i,
      instead:
        "name the storage provider (Cloudflare R2); it is a processor, not storage we control",
      shipped:
        "your file is uploaded over an encrypted connection to storage we control, scanned for malware, processed",
    },
    {
      // Row 4. No retention period for any log is configured or recorded.
      pattern: /\bretained\s+for\s+a\s+short\s+period\b/i,
      instead:
        "say who keeps logs (Cloudflare, the storage provider, our own servers) and that no fixed period is promised",
      shipped:
        "are used to operate and secure the service, including to detect abuse, and are retained for a short period by those providers.",
    },
    {
      // Row 13. True only of the dormant Anthropic adapter; production uses
      // OpenAI, which may keep inputs for up to 30 days for abuse monitoring.
      pattern: /\bminutes,\s+not\s+days\b/i,
      instead:
        "state what the production AI provider may keep, and for how long (src/lib/privacy/processors.ts)",
      shipped:
        "The provider holds it in a short-lived cache, which lowers the cost of processing the repeat rather than avoiding it; that cache lasts minutes, not days.",
    },
    {
      // Row 14. Whether Cloudflare sets cookies is not ours to rule out.
      pattern: /\bthe\s+one\s+kind\s+of\s+cookie\b/i,
      instead:
        "say our own code sets no cookies, Google Analytics sets its own after consent, and Cloudflare may set its own",
      shipped:
        "The one kind of cookie on this site belongs to Google Analytics, and it is set only after you allow analytics in the consent banner",
    },
    {
      // Row 5. Request Signatures asks for signers' names and emails;
      // Protect and Unlock ask for a password. Every verb, every order.
      pattern:
        /\b(?:do\s+not|don't|never)\s+ask\s+(?:you\s+)?for\s+(?:a\s+|your\s+)?(?:name|e-?mail|password)/i,
      instead:
        "there are no accounts, but some tools ask for a name, an email address or a password; say which",
      shipped:
        "We do not ask for a name, an email address, or a password to use the tools, so we hold no profile of you to lose.",
    },
    {
      // Row 8. The password sits in the job's instructions (the executor
      // spec), which is deleted when the job ends — not in the job record for
      // the record's whole window.
      pattern: /\bsits\s+in\s+that\s+job\s+record\b/i,
      instead:
        "say what the Protect/Unlock panel says: it waits in the queue until the job finishes or is cancelled",
      shipped:
        "the password you type is part of the instruction sent to the worker, and it sits in that job record for the same",
    },
    {
      // Rows 1 and 4. Logs carry IP addresses; the legitimate-interest
      // signals are not identifier-free.
      pattern: /\bcarry\s+no\s+identifiers\b/i,
      instead: "say what each signal carries; request logs hold IP addresses",
      shipped:
        "We have considered your rights in reaching that balance, which is why these signals carry no identifiers and no document contents.",
    },
    {
      // Review of the 2026-10-10 rewrite. The queue is a self-hosted Redis
      // with append-only persistence (`--appendonly yes`), so what FINALIZE
      // deletes stays in the on-disk journal until it is rewritten, and no
      // rewrite interval is recorded. "Only until" is the word that makes the
      // sentence false; privacy-truth.test.tsx requires every queue lifetime
      // the page states to name the journal.
      pattern: /\bonly\s+until\s+the\s+job\s+(?:ends|finishes|is\s+done)\b/i,
      instead:
        "say the job queue removes it when the job ends, and that the queue's on-disk journal can keep a copy until it is next compacted (src/lib/privacy/job-queue.ts)",
      shipped:
        "Our job queue keeps them only until the job ends — or, if no worker ever runs the job, until the queue's retention lapses after 24 hours.",
    },
  ];

  it("each 2026-10-10 entry catches the sentence it was written from", () => {
    const withCorpus = OVERCLAIMS.filter((o) => o.shipped !== undefined);
    // Health: the corpus did not quietly shrink.
    expect(withCorpus.length).toBeGreaterThanOrEqual(10);
    for (const o of withCorpus)
      expect(
        o.shipped!,
        `${String(o.pattern)} misses its own sentence`,
      ).toMatch(o.pattern);
  });

  it.each([
    ["privacy", PRIVACY, PrivacyPage],
    ["terms", TERMS, TermsPage],
  ] as const)("/%s makes no unsupported claim", (name, file, Page) => {
    // TWO READINGS, because each sees what the other cannot.
    //
    // THE RENDERED PAGE — what a reader receives. Until review (2026-10-10)
    // this read the page's source plus every `@/lib/privacy/*` module it
    // imports, matched by that typed path prefix — and its comment said the
    // modules were "found by following the page's imports, not by a list". A
    // prefix IS a list. /privacy also renders words from browser-storage,
    // retention-windows, legal, the tool catalogue, the legal-page frame and
    // the analytics choices; none were read. Mutation A: "permanently
    // deleted" planted in BROWSER_STORAGE's consent `lasts` rendered in §5,
    // and every guard stayed green. The render reads every module the page
    // draws on, because that is what rendering is.
    //
    // THE SOURCE — the page and the `src/lib/privacy` registries it imports —
    // because a branch a flag does not render today (the per-client
    // rate-limit sentence in `rate-limits.ts`) is on no rendered page and
    // still ships the day the flag flips. It is a narrower set on purpose:
    // the branches, not the reach.
    const rendered = renderedText(Page);
    // Health: the render is not blind, and it reaches beyond src/lib/privacy.
    expect(rendered.length).toBeGreaterThan(2000);
    if (name === "privacy")
      expect(rendered).toContain(BROWSER_STORAGE[0]!.lasts);
    else expect(rendered).toContain(LEGAL_ENTITY.name);
    const own = read(file);
    const registries = [
      ...own.matchAll(/from "@\/lib\/privacy\/([\w-]+)"/g),
    ].map((m) => path.join(ROOT, "src", "lib", "privacy", `${m[1]}.ts`));
    if (name === "privacy") expect(registries.length).toBeGreaterThanOrEqual(5);
    const source = [own, ...registries.map(read)]
      .map(withoutComments)
      .join(" \n ");
    const found = [
      ...OVERCLAIMS.filter((o) => o.pattern.test(rendered)).map(
        (o) => `rendered: ${String(o.pattern)} — ${o.instead}`,
      ),
      ...OVERCLAIMS.filter((o) => o.pattern.test(source)).map(
        (o) => `source: ${String(o.pattern)} — ${o.instead}`,
      ),
    ];
    expect(
      found,
      `${name} contains a claim this product cannot support:\n  ${found.join("\n  ")}`,
    ).toEqual([]);
  });

  it("positive control: an overclaim in a registry outside src/lib/privacy reaches the rendered scan", () => {
    // Mutation A, as an executable control: the consent store's `lasts` is
    // rendered by /privacy §5 from `@/lib/browser-storage`. The same scan the
    // test above runs, over the rendered page with that sentence replaced.
    const lasts = BROWSER_STORAGE[0]!.lasts;
    const rendered = renderedText(PrivacyPage);
    expect(rendered).toContain(lasts);
    const planted = rendered.replace(
      lasts,
      "Until you change it here; then it is permanently deleted.",
    );
    expect(planted).not.toBe(rendered);
    expect(OVERCLAIMS.filter((o) => o.pattern.test(rendered))).toEqual([]);
    expect(
      OVERCLAIMS.filter((o) => o.pattern.test(planted)).map((o) =>
        String(o.pattern),
      ),
    ).toEqual([String(/\bpermanently (?:delet|eras|destroy|wip|remov|purg)/i)]);
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
    // Anchored on the intro's first words: the answer it used to be planted
    // in ("Merge copies pages …") left the page at the seo/content merge.
    const planted = real.replace(
      "Merge PDF joins whole documents",
      "Your files are permanently deleted within minutes and nothing is retained. Merge PDF joins whole documents",
    );
    expect(planted).not.toBe(real);
    const caught = OVERCLAIMS.filter((o) => o.pattern.test(planted)).map((o) =>
      String(o.pattern),
    );
    expect(caught.length).toBeGreaterThanOrEqual(2);
  });
});
