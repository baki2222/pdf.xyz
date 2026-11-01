// @vitest-environment node
/**
 * The guides catalogue's integrity and honesty suite.
 *
 * The shared walls already read this catalogue (copy-surface, the numbers
 * census, legal-pages' overclaim scan, capability-hedges — each registered
 * BEFORE the first guide was written). What they cannot know is the
 * per-guide RELATIONSHIPS: that a guide's tool references resolve, that its
 * steps tell the truth about where the primary tool runs, and that the
 * assembly step that replaces {{TOKENS}} with derived constants actually ran.
 * Those live here, over the imported catalogue — import-and-call, never a
 * regex over the file (the catalog-descriptions idiom).
 *
 * The upload-word rule is structured-steps.test.ts one level up: scoped by
 * `capabilityForMode`, never a blanket ban. An in-browser guide saying
 * "upload" ships a false claim to crawlers as HowTo JSON-LD; a worker guide
 * FORBIDDEN from saying it would ship the opposite lie.
 */
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import type { Guide } from "./types";
import { getToolBySlug, tools } from "@/lib/tools";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { aiAllowanceFactFor } from "@/lib/jobs/ai-allowance";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/** Every string a reader (or a crawler, via JSON-LD) receives from a guide. */
function copyStrings(guide: Guide): string[] {
  return [
    guide.title,
    guide.description,
    ...guide.keywords,
    ...guide.intro,
    ...guide.steps,
    ...guide.sections.flatMap((s) => [s.heading, ...s.body]),
    ...guide.faq.flatMap((f) => [f.question, f.answer]),
  ];
}

/** The strings of `guide` that match `pattern` — every ban runs through this. */
function violations(guide: Guide, pattern: RegExp): string[] {
  return copyStrings(guide).filter((text) => pattern.test(text));
}

const UPLOAD = /\bupload/i;
const DEVICE_STAYS =
  /(never leaves? (?:your|the|this) (?:device|browser|computer))|(stays? on your (?:device|computer))/i;
const LEFTOVER_TOKEN = /\{\{[A-Z_]+\}\}/;

/** A fixture guide around one offending string, for the positive controls. */
function fixtureAround(text: string): Guide {
  return {
    slug: "fixture",
    title: "Fixture",
    description: "Fixture.",
    tools: ["merge-pdf"],
    keywords: [],
    intro: [text],
    steps: [],
    sections: [],
    faq: [],
    published: "2026-09-17",
    updated: "2026-09-17",
  };
}

describe("the guides catalogue is structurally sound", () => {
  it("is plausibly sized, in both directions", () => {
    const slugs = guides.map((g) => g.slug);
    expect(slugs.length, `guides: ${slugs.join(", ")}`).toBeGreaterThanOrEqual(
      8,
    );
    // The route-indexability bounds tolerate 25 guide routes today; a count
    // near that is the signal to revisit both files together, not to creep.
    // Revisited 2026-09-27: L04 and L05 each added five guides (16 → 21), so
    // both bounds moved together, keeping this one a guide under that one.
    // Revisited 2026-10-29: wave 2 added ten guides (22 → 32). The
    // route-indexability bound no longer has a fixed guide allowance — it
    // derives its expected expansion from `guides.length` — so this ceiling
    // stands alone now: a count past it is a catalogue growing faster than
    // anyone reviewed, not a route walk running out of slack.
    // Revisited 2026-10-30: three guides for the options PR #236 shipped
    // inside existing tools — Bates numbering, alternate-page merging for
    // double-sided scans, and WebP / GIF / BMP to PDF (36 → 39). Each was
    // checked against its runner and engine, not against the tool copy.
    // Revisited 2026-10-31 (UTC): one guide, "How to compress a PDF to
    // 100 KB", for the deep step's new Target size (39 → 40) — the search
    // the feature was built for. Checked against the ladder and its tests.
    // Revisited 2026-10-31 (UTC), later the same day: one guide, "How to
    // convert JPG to PDF under 100 KB", for JPG / PNG to PDF's new Max file
    // size (40 → 41) — the search family that feature exists for. Checked
    // against `image-size-limit.ts`, its ladder tests and the e2e proof.
    // Revisited 2026-10-31 (UTC), later again: one guide, "How to convert
    // Bangla PDF to Word" (41 → 42), for a search
    // family the Bengali OCR pack serves. Written only after production read
    // a Bengali page back and was measured against it
    // (`pnpm worker:prove-tools bengali-ocr`).
    // Revisited 2026-10-31 (UTC), last: four guides for tools that had none
    // of their own — Excel to PDF, PowerPoint to PDF, Extract Pages and
    // Summarize PDF (42 → 46). Each was written from its tool's content
    // file, runner and shared helpers, and claims nothing those pages do not.
    // Revisited 2026-10-31 (UTC), after that: four more for tools with no
    // guide of their own — PDF to PDF/A, PDF to PNG, PDF to Text and
    // Grayscale PDF (46 → 50), written the same way, from each tool's
    // content file, runner or worker panel, and the helpers they call.
    // Revisited 2026-10-31 (UTC), after that: four more for tools with no
    // guide of their own — Annotate PDF (as "How to highlight text in a
    // PDF"), Chat with PDF, Extract Tables and PDF to Markdown (50 → 54),
    // each checked first for an existing guide with the same search intent.
    // Revisited 2026-10-31 (UTC), after that: four more for tools with no
    // guide of their own — PDF Header & Footer, Text to PDF, Request
    // Signatures (as "How to prepare a PDF for other people to sign", since
    // the tool sends nothing to anyone) and AI Data Extraction (54 → 58),
    // each checked first against the guides with a neighbouring intent.
    // Revisited 2026-10-31 (UTC), after that: the last four tools with no
    // guide of their own — PNG to PDF (for what is particular to PNG, not a
    // second JPG guide), HTML to PDF (a file, where the webpage guide is a
    // URL), Overlay PDF (as "How to add a letterhead to a PDF", the task it
    // does) and Optimize PDF for Web (58 → 62). Every tool now has one.
    expect(slugs.length).toBeLessThanOrEqual(62);
    for (const guide of guides) {
      expect(
        copyStrings(guide).length,
        `${guide.slug} carries implausibly little copy`,
      ).toBeGreaterThanOrEqual(15);
    }
  });

  it("slugs, ids, titles, and descriptions hold their contracts", () => {
    const seen = new Set<string>();
    for (const guide of guides) {
      expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(guide.slug), `duplicate slug ${guide.slug}`).toBe(false);
      seen.add(guide.slug);
      // SERP ceilings — ceiling only, deliberately no floor (the
      // thin-stays-thin ruling from catalog-descriptions.test.ts).
      expect(
        guide.description.length,
        `${guide.slug}: description is ${guide.description.length} chars`,
      ).toBeLessThanOrEqual(165);
      expect(guide.title.length, guide.slug).toBeLessThanOrEqual(70);
      const ids = guide.sections.map((s) => s.id);
      expect(new Set(ids).size, `${guide.slug}: duplicate section id`).toBe(
        ids.length,
      );
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every tool reference resolves, and the shapes are article-sized", () => {
    for (const guide of guides) {
      expect(guide.tools.length, guide.slug).toBeGreaterThanOrEqual(1);
      expect(guide.tools.length, guide.slug).toBeLessThanOrEqual(3);
      expect(new Set(guide.tools).size, guide.slug).toBe(guide.tools.length);
      for (const slug of guide.tools) {
        expect(
          getToolBySlug(slug),
          `${guide.slug} references unknown tool "${slug}"`,
        ).toBeDefined();
      }
      expect(guide.steps.length, guide.slug).toBeGreaterThanOrEqual(4);
      expect(guide.steps.length, guide.slug).toBeLessThanOrEqual(8);
      expect(guide.sections.length, guide.slug).toBeGreaterThanOrEqual(2);
      expect(guide.faq.length, guide.slug).toBeGreaterThanOrEqual(3);
      for (const entry of guide.faq) {
        expect(entry.question, guide.slug).toMatch(/\?$/);
      }
    }
  });

  it("every tool under 'Tools used in this guide' is one the guide uses", () => {
    // The guide page renders `guide.tools` under the heading "Tools used in
    // this guide", and the tool page's Guides band links back through the same
    // field. So each entry is a claim that the article USES that tool, and a
    // reader can check it: the tool must be named in the copy. The compress
    // guide listed Grayscale PDF and Optimize for Web while naming neither,
    // and Grayscale PDF makes a text PDF 150-300x LARGER (audit, 67e8d0f) —
    // the "used" claim was the only thing sending compress readers there.
    const unnamed = (guide: Guide) =>
      guide.tools.filter((slug) => {
        const name = getToolBySlug(slug)?.name;
        const copy = copyStrings(guide).join(" ").toLowerCase();
        return !name || !copy.includes(name.toLowerCase());
      });
    const holes = guides.flatMap((guide) =>
      unnamed(guide).map((slug) => `${guide.slug} lists ${slug}`),
    );
    expect(holes, holes.join("\n")).toEqual([]);
    // Health check: the corpus is the whole catalogue's tool references.
    expect(guides.flatMap((g) => g.tools).length).toBeGreaterThanOrEqual(
      2 * guides.length,
    );
    // Positive control, through the same detector: a listed tool the copy
    // never names is reported; one it names is not.
    const fixture = {
      ...fixtureAround("Open Merge PDF and add your files."),
      tools: ["merge-pdf", "split-pdf"],
    };
    expect(unnamed(fixture)).toEqual(["split-pdf"]);
  });

  it("every tool the site promotes has a guide that teaches it", () => {
    // Audit at 67e8d0f: the guides covered 11 tasks, and Edit PDF — badged
    // popular AND featured, the most-promoted in-browser tool in the
    // catalogue — had no guide at all, not even as a neighbour. The top
    // intents are the ones the site itself promotes, so the corpus is DERIVED
    // from the catalogue's own `badge`/`featured`, never typed here.
    const promoted = tools.filter((t) => t.featured || t.badge === "popular");
    const untaught = (list: readonly Guide[]) =>
      promoted
        .filter((t) => !list.some((g) => g.tools[0] === t.slug))
        .map((t) => t.slug);

    // The KNOWN gaps, each with the property that excuses it. The excuse is
    // not "we have not got to it": it is that every claim a guide makes must
    // be checkable in this tree, and these run on the worker, whose image is
    // built by hand and can differ from main (the FAQ that advertised
    // chunking against a nine-day-old worker). An in-browser tool has no such
    // excuse, so the ledger cannot hold one.
    // "word-to-pdf" left the ledger 2026-10-29 when how-to-convert-word-to-pdf
    // shipped. Its excuse was "fidelity claims need a real job against the
    // running image"; the guide makes none — it says LibreOffice lays the
    // pages out, substitutes missing fonts and can move breaks, the same
    // caveats the tool page states and claims-vs-capability holds.
    // "chat-with-pdf" left the ledger 2026-10-31 when how-to-chat-with-a-pdf
    // shipped. Its excuse was "answer-grounding claims need a real job
    // against the running image"; the guide makes none. It states the
    // INSTRUCTION the engine gives the model (`buildSystemPrompt` in
    // workers/chat-with-pdf/engine.ts), says nothing checks an answer
    // against the pages, and calls a [p.N] citation the model's pointer, to
    // be checked by opening the page. The excuse's own exit was then met
    // before it merged: on 2026-11-01 a real job ran against
    // https://pdf.xyz (`worker:prove-tools "chat-with-pdf" "chat-with-pdf
    // (follow-up)"`, 2/2 PASS). In each answer ZIP, answer.md — the file the
    // guide says lists the cited pages — read "Cited pages: p.2", and the
    // answer ended "[p.2]": the page CHAT_FACT_PAGE plants the fact on, not
    // merely one in range. The follow-up sent 2 prior turns and named the
    // asked-about team's channel, not a decoy's.
    const KNOWN_GAPS: Record<string, string> = {};
    // Only a tool whose claims cannot be checked in this tree may be excused.
    const excusable = (slug: string): boolean => {
      const tool = getToolBySlug(slug);
      return (
        tool !== undefined &&
        capabilityForMode(tool.processing) !== "in-browser"
      );
    };
    const gaps = untaught(guides);
    const unexcused = gaps.filter((slug) => !(slug in KNOWN_GAPS));
    expect(unexcused, unexcused.join("\n")).toEqual([]);
    for (const [slug, why] of Object.entries(KNOWN_GAPS)) {
      expect(
        getToolBySlug(slug),
        `ledger names unknown tool ${slug}`,
      ).toBeDefined();
      expect(
        excusable(slug),
        `${slug} runs in the browser, so "${why}" cannot excuse it`,
      ).toBe(true);
      // Stale entries go red: an entry the site stopped promoting is no
      // longer a top intent, and a gap that got its guide leaves the ledger.
      expect(
        promoted.map((t) => t.slug),
        `${slug} is not promoted — drop it from KNOWN_GAPS`,
      ).toContain(slug);
      expect(
        gaps,
        `${slug} has a guide now — drop it from KNOWN_GAPS`,
      ).toContain(slug);
    }

    // Health: the promoted set is a real slice of the catalogue.
    expect(promoted.length).toBeGreaterThanOrEqual(8);
    expect(promoted.length).toBeLessThan(tools.length / 2);
    // Positive control, through the same detector: removing a promoted
    // tool's only guide surfaces that tool.
    const merge = guides.filter((g) => g.tools[0] !== "merge-pdf");
    expect(untaught(merge)).toContain("merge-pdf");
    // And through the excuse predicate: an in-browser promoted tool (found,
    // not named) cannot be excused, nor can a slug the catalogue lacks.
    const inBrowser = promoted.find(
      (t) => capabilityForMode(t.processing) === "in-browser",
    );
    expect(
      inBrowser,
      "no promoted in-browser tool to control with",
    ).toBeDefined();
    expect(excusable(inBrowser!.slug)).toBe(false);
    expect(excusable("no-such-tool")).toBe(false);
  });

  it("dates are real and ordered", () => {
    for (const guide of guides) {
      for (const date of [guide.published, guide.updated]) {
        expect(date, guide.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(date)), `${guide.slug}: ${date}`).toBe(
          false,
        );
      }
      expect(
        guide.updated >= guide.published,
        `${guide.slug}: updated ${guide.updated} precedes published ${guide.published}`,
      ).toBe(true);
    }
  });
});

describe("guide copy tells the truth about where the work runs", () => {
  it("no assembly token survived into shipped copy", () => {
    // The catalogue is assembled from drafts whose figures are {{TOKENS}}
    // until a derived constant replaces them. A survivor would render
    // literally — "{{RETENTION_MINUTES}} minutes" — on the page and in the
    // JSON-LD, so this is the seam the assembly step can silently drop.
    for (const guide of guides) {
      expect(violations(guide, LEFTOVER_TOKEN), guide.slug).toEqual([]);
    }
    // Positive control, through the same detector.
    expect(
      violations(
        fixtureAround("wait {{RETENTION_MINUTES}} minutes"),
        LEFTOVER_TOKEN,
      ).length,
    ).toBe(1);
  });

  it("an in-browser guide never says upload; a worker guide's steps do", () => {
    for (const guide of guides) {
      const primary = getToolBySlug(guide.tools[0]!);
      expect(primary, guide.slug).toBeDefined();
      const capability = capabilityForMode(primary!.processing);

      if (capability === "in-browser") {
        expect(
          violations(guide, UPLOAD),
          `${guide.slug}: an in-browser guide claims an upload`,
        ).toEqual([]);
      } else if (capability === "secure-worker" || capability === "ai") {
        expect(
          guide.steps.some((step) => UPLOAD.test(step)),
          `${guide.slug}: a worker-backed guide's steps never say the file is uploaded — that is its truth`,
        ).toBe(true);
        expect(
          violations(guide, DEVICE_STAYS),
          `${guide.slug}: a worker-backed guide claims the file stays on the device`,
        ).toEqual([]);
      } else {
        // hybrid — compress-pdf's shape: the browser path and the optional
        // worker pass must BOTH be named, or the guide is telling half the
        // story in whichever direction reads better.
        const all = copyStrings(guide).join(" ");
        expect(
          /browser/i.test(all),
          `${guide.slug}: hybrid, no browser path`,
        ).toBe(true);
        expect(
          /secure[ -]server/i.test(all),
          `${guide.slug}: hybrid, no secure-server pass`,
        ).toBe(true);
      }
    }
    // Positive controls, through the same detectors.
    expect(violations(fixtureAround("Upload your PDF."), UPLOAD).length).toBe(
      1,
    );
    expect(
      violations(fixtureAround("It never leaves your device."), DEVICE_STAYS)
        .length,
    ).toBe(1);
    expect(
      violations(fixtureAround("The file stays on your device."), DEVICE_STAYS)
        .length,
    ).toBe(1);
  });

  it("the retention and allowance sentences are the derived ones", () => {
    // Value-level derivation checks: if a guide states the window or the
    // allowance, the words must be the constant's CURRENT text, so a changed
    // constant flips this red instead of leaving stale prose behind.
    const retention = `stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes`;
    for (const guide of guides) {
      for (const text of copyStrings(guide)) {
        if (/stops working after/i.test(text)) {
          expect(
            text.includes(retention),
            `${guide.slug}: retention sentence does not carry the derived window: "${text}"`,
          ).toBe(true);
        }
      }
      const primary = getToolBySlug(guide.tools[0]!)!;
      if (capabilityForMode(primary.processing) === "ai") {
        // Per tool: the allowance is stated in the unit the route charges the
        // guide's primary tool (characters for translate, runs for the rest).
        const fact = aiAllowanceFactFor(primary.slug);
        expect(
          copyStrings(guide).some((text) => text.includes(fact)),
          `${guide.slug}: an AI guide must carry its tool's allowance sentence verbatim (interpolate aiAllowanceFactFor)`,
        ).toBe(true);
      }
    }
  });
});
