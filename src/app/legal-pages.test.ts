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
  it("neither hard-codes the retention window", () => {
    // `DEFAULT_RETENTION.inputTtlMinutes` is 60 today. A page that says "60
    // minutes" in prose reads identically and becomes a false promise the moment
    // the constant moves — with nothing failing.
    for (const [name, file] of [
      ["privacy", PRIVACY],
      ["terms", TERMS],
    ] as const) {
      const source = read(file);
      expect(source, `${name} should import the retention constants`).toContain(
        "DEFAULT_RETENTION",
      );
      expect(
        /\b60\s*minutes\b/i.test(withoutComments(source)),
        `${name} hard-codes a retention figure in prose instead of reading DEFAULT_RETENTION`,
      ).toBe(false);
    }
  });

  it("privacy derives its tool counts from the catalogue", () => {
    const source = read(PRIVACY);
    expect(source).toContain("tools.reduce");
    // The split it describes must be the real one.
    const client = tools.filter((t) => t.processing === "client").length;
    expect(client).toBeGreaterThan(0);
    expect(client).toBeLessThan(tools.length);
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
      ...readdirSync(sectionsDir)
        .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
        .map((f) => path.join(sectionsDir, f)),
    ];
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
});
