// @vitest-environment node
/**
 * Where a finished file can go next — held on the real catalogue.
 *
 * `continueTargetsFor` is computed on the tool's server page and handed to
 * the result's "Continue with" row. Every row it offers is a promise: that
 * tool opens this file, in this browser, carried there by a click. So every
 * property below is a property of the PROMISE, checked against what the
 * catalogue and the hand-off capability say — never against a typed list of
 * expected rows (which would agree with whatever the code did).
 *
 *  - every target takes one of the tool's outputs, and can be carried to;
 *  - no target is the tool itself, or its inverse (a converter's way back:
 *    PDF to JPG is never followed by JPG to PDF);
 *  - after Sign PDF only finishing steps; after Protect PDF and PDF to PDF/A
 *    none, with the reason in the plan (that the reason reaches a reader —
 *    the result card on those worker pages — is the composed chain
 *    `no-continue-delivered.test.tsx` drives; this file once said "the
 *    reason is said" of a value nothing drew: WP-08 review, 2026-10-10);
 *  - every target carries the per-file ceiling its own page states, so the
 *    row can refuse a file too large for it (`result-ending.test.tsx`);
 *  - a curated `next` leads, and names only real candidates.
 *
 * The positive control runs the same assertions over a plan built with the
 * inverse rule switched off, and requires them to FAIL — the assertion can
 * see the defect it exists for.
 */
import { describe, expect, it } from "vitest";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { normalizeFormatLabel } from "@/lib/jobs/mime-by-format";
import { toolAcceptsFormat } from "@/lib/intent/formats";
import { getToolBySlug, tools } from "@/lib/tools";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import { PDF_ENGINE_ERROR_KINDS } from "@/lib/pdf/engine";
import { remedyFor } from "@/lib/pdf/remedies";
import type { Tool } from "@/lib/tools/types";
import {
  CONTINUE_SHOWN,
  FINISHING_STEPS,
  FIX_ONLY,
  NO_CONTINUE,
  continueTargetsFor,
  isInverse,
  type ContinuePlan,
} from "./next-steps";
import { browserPdfDeadEnds, browserPdfTools } from "./dead-ends";

const plans = new Map<string, ContinuePlan>(
  tools.map((tool) => [tool.slug, continueTargetsFor(tool, tools)]),
);
const plan = (slug: string) => {
  const p = plans.get(slug);
  if (!p) throw new Error(`no plan for ${slug}`);
  return p;
};
const slugsOf = (p: ContinuePlan) => p.targets.map((t) => t.slug);
const tool = (slug: string): Tool => {
  const t = getToolBySlug(slug);
  if (!t) throw new Error(`${slug} is not in the catalogue`);
  return t;
};
const formats = (labels: readonly string[]) =>
  labels.map((l) => normalizeFormatLabel(l));

/** Rows whose target is the source tool's inverse, by the format rule. */
function inverseRows(build: (t: Tool) => ContinuePlan): string[] {
  return tools.flatMap((source) => {
    const accepted = formats(source.accept);
    const produced = formats(source.outputs);
    const converts = !accepted.some((f) => produced.includes(f));
    if (!converts) return [];
    return build(source)
      .targets.map((t) => tool(t.slug))
      .filter(
        (target) =>
          produced.some((f) => toolAcceptsFormat(target.accept, f as never)) &&
          formats(target.outputs).some((f) => accepted.includes(f)),
      )
      .map((target) => `${source.slug} -> ${target.slug}`);
  });
}

describe("the plan is computed from the whole catalogue", () => {
  it("health check: a real catalogue, and most tools have somewhere to go", () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
    const withTwo = tools.filter((t) => plan(t.slug).targets.length >= 2);
    // The redesign's bound (spec WP-08): at least 20 tools offer two or more.
    expect(withTwo.length).toBeGreaterThanOrEqual(20);
    // …and the walk is not vacuously offering everything everywhere.
    const offered = new Set(tools.flatMap((t) => slugsOf(plan(t.slug))));
    expect(offered.size).toBeGreaterThanOrEqual(5);
    expect(offered.size).toBeLessThan(tools.length);
  });

  it("the server hands over a short list, the row shows at most four of it", () => {
    expect(CONTINUE_SHOWN).toBe(4);
    for (const t of tools) {
      const p = plan(t.slug);
      expect(new Set(slugsOf(p)).size, t.slug).toBe(p.targets.length);
    }
  });
});

describe("every target is a promise the catalogue keeps", () => {
  it("takes one of the tool's outputs", () => {
    const wrong = tools.flatMap((source) =>
      plan(source.slug)
        .targets.filter(
          (t) =>
            !formats(source.outputs).some((f) =>
              toolAcceptsFormat(tool(t.slug).accept, f as never),
            ),
        )
        .map((t) => `${source.slug} -> ${t.slug}`),
    );
    expect(wrong).toEqual([]);
  });

  it("can be carried to — a hand-off this browser can make", () => {
    const wrong = tools.flatMap((source) =>
      plan(source.slug)
        .targets.filter((t) => !handoffCapabilityFor(t.slug).supported)
        .map((t) => `${source.slug} -> ${t.slug}`),
    );
    expect(wrong).toEqual([]);
    // Its mode travels with it, read from the same capability.
    for (const source of tools)
      for (const t of plan(source.slug).targets)
        expect(t.mode, t.slug).toBe(handoffCapabilityFor(t.slug).mode);
  });

  it("names the target as the catalogue does, and says where it runs", () => {
    for (const source of tools)
      for (const t of plan(source.slug).targets) {
        expect(t.name).toBe(tool(t.slug).name);
        expect(t.processing).toBe(tool(t.slug).processing);
      }
  });

  it("carries the largest file it opens — the ceiling its own page states", () => {
    let checked = 0;
    for (const source of tools)
      for (const t of plan(source.slug).targets) {
        checked += 1;
        expect(t.ceilingBytes, t.slug).toBe(toolFileCeilingBytes(tool(t.slug)));
      }
    // Health: real rows, and real ceilings among them (a plan of nulls
    // would let the row offer anything to anyone).
    expect(checked).toBeGreaterThan(50);
    const ceilings = new Set(
      tools.flatMap((s) => plan(s.slug).targets.map((t) => t.ceilingBytes)),
    );
    expect([...ceilings].filter((c) => c !== null).length).toBeGreaterThan(0);
  });

  it("is never the tool itself", () => {
    const self = tools.filter((t) => slugsOf(plan(t.slug)).includes(t.slug));
    expect(self.map((t) => t.slug)).toEqual([]);
  });

  it("is never the tool's inverse", () => {
    expect(inverseRows((t) => continueTargetsFor(t, tools))).toEqual([]);
    // The pairs a reader would name first, each checked by name too.
    expect(slugsOf(plan("pdf-to-jpg"))).not.toContain("jpg-to-pdf");
    expect(slugsOf(plan("jpg-to-pdf"))).not.toContain("pdf-to-jpg");
    expect(slugsOf(plan("markdown-to-pdf"))).not.toContain("pdf-to-markdown");
    expect(slugsOf(plan("text-to-pdf"))).not.toContain("pdf-to-text");
    // The same-format pair the format rule cannot see: a merge undone.
    expect(slugsOf(plan("split-pdf"))).not.toContain("merge-pdf");
    expect(slugsOf(plan("merge-pdf"))).not.toContain("split-pdf");
    // …and a step that leaves nothing for the next: no fields after a flatten.
    expect(slugsOf(plan("flatten-pdf"))).not.toContain("fill-forms");
    // The direction matters: filling a form, then flattening it, is the job.
    expect(slugsOf(plan("fill-forms"))).toContain("flatten-pdf");
  });

  it("POSITIVE CONTROL: with the inverse rule off, the same assertion fails", () => {
    const blind = (t: Tool) =>
      continueTargetsFor(t, tools, { inverse: () => false });
    // The mutation landed: the predicate the plan uses is the one switched.
    expect(isInverse(tool("pdf-to-jpg"), tool("jpg-to-pdf"))).toBe(true);
    expect(slugsOf(blind(tool("jpg-to-pdf")))).toContain("pdf-to-jpg");
    expect(inverseRows(blind).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the policy rows", () => {
  it("after Sign PDF, only steps that finish a signed document", () => {
    const signed = slugsOf(plan("sign-pdf"));
    expect(signed.length).toBeGreaterThanOrEqual(2);
    expect(signed.filter((s) => !FINISHING_STEPS.includes(s))).toEqual([]);
    // Every finishing step that can be carried to is offered.
    expect(signed).toEqual(
      FINISHING_STEPS.filter((s) => handoffCapabilityFor(s).supported),
    );
  });

  it("after Protect PDF and PDF to PDF/A, nothing — and the plan carries the reason", () => {
    for (const slug of ["protect-pdf", "pdf-to-pdfa"]) {
      expect(plan(slug).targets, slug).toEqual([]);
      expect(plan(slug).none, slug).toBe(NO_CONTINUE[slug]);
      expect(plan(slug).none!.length, slug).toBeGreaterThan(20);
    }
    // Health: the table names real tools and nothing else gets a reason.
    for (const slug of Object.keys(NO_CONTINUE)) tool(slug);
    const reasoned = tools.filter((t) => plan(t.slug).none !== undefined);
    expect(reasoned.map((t) => t.slug).sort()).toEqual(
      Object.keys(NO_CONTINUE).sort(),
    );
  });

  it("text, Markdown, image and archive outputs go nowhere — only inverses take them", () => {
    for (const slug of [
      "pdf-to-text",
      "pdf-to-markdown",
      "pdf-to-jpg",
      "pdf-to-png",
      "extract-images",
      "compare-pdf",
    ])
      expect(slugsOf(plan(slug)), slug).toEqual([]);
  });

  it("a combiner is marked, so several files are offered only to one", () => {
    const merge = plan("compress-pdf").targets.find(
      (t) => t.slug === "merge-pdf",
    );
    expect(merge?.combines).toBe(true);
    for (const source of tools)
      for (const t of plan(source.slug).targets) {
        const target = tool(t.slug);
        const combines =
          t.mode === "collect" &&
          formats(target.outputs).every((f) =>
            formats(target.accept).includes(f),
          );
        expect(t.combines, t.slug).toBe(combines);
      }
  });
});

describe("the order", () => {
  it("a curated `next` leads, and names only real candidates", () => {
    const curated = tools.filter((t) => t.next && t.next.length > 0);
    // Health: the override is used, or this test checks nothing.
    expect(curated.length).toBeGreaterThanOrEqual(1);
    for (const source of curated) {
      const offered = slugsOf(plan(source.slug));
      expect(offered.slice(0, source.next!.length), source.slug).toEqual(
        source.next,
      );
    }
  });

  it("then the tool's related tools, then the priority list", () => {
    // Merge: its curated pair first, then its related tools in order.
    const merge = slugsOf(plan("merge-pdf"));
    expect(merge.slice(0, 2)).toEqual(["compress-pdf", "page-numbers"]);
    expect(merge).toContain("organize-pages");
    expect(merge.indexOf("organize-pages")).toBeLessThan(
      merge.indexOf("sign-pdf") === -1 ? Infinity : merge.indexOf("sign-pdf"),
    );
    // Rotate: related (organize, crop, merge) before the priority list.
    expect(slugsOf(plan("rotate-pdf")).slice(0, 3)).toEqual([
      "organize-pages",
      "crop-pdf",
      "merge-pdf",
    ]);
  });
});

/**
 * A REMEDY IS NOT A NEXT STEP (WP-10). Once worker panels took hand-offs,
 * Unlock PDF — a remedy, reached from a file a tool could NOT open — was
 * ranked into Merge PDF's four "Continue with" rows: a file this site had
 * just written, with no password, offered a tool whose only job is removing
 * one. The fixers are offered by the error that needs them (`remedyFor`),
 * so the set here is the remedy targets themselves, derived, both ways.
 */
describe("the tools that fix a file are offered by its refusal, never as a next step", () => {
  const fixers = new Set(
    PDF_ENGINE_ERROR_KINDS.map(
      (kind) => remedyFor({ kind, verdict: null }, "")!.toolSlug,
    ),
  );

  it("health: the remedy targets are found, and they take hand-offs", () => {
    expect(fixers.size).toBeGreaterThanOrEqual(2);
    for (const slug of fixers)
      expect(handoffCapabilityFor(slug).supported, slug).toBe(true);
  });

  it("the plan's fix-only set is exactly the remedy targets", () => {
    expect(new Set(FIX_ONLY)).toEqual(fixers);
  });

  it("no plan offers one", () => {
    const offering = tools.flatMap((tool) =>
      plan(tool.slug)
        .targets.filter((t) => fixers.has(t.slug))
        .map((t) => `${tool.slug} → ${t.slug}`),
    );
    expect(offering).toEqual([]);
  });
});

describe("every PDF made in the browser has somewhere to go", () => {
  // The property the homepage's step 3 rests on ("Every PDF made in your
  // browser offers the next tool, with the file already loaded."), which
  // `feature-claims.test.ts` gates on this same predicate. A browser tool is
  // one with an in-browser runner; a PDF tool is one whose outputs include a
  // PDF. Worker tools are not in the claim (Protect PDF and PDF to PDF/A end
  // on purpose, with the reason said).
  it("health: the subjects are the catalogue's browser PDF tools, derived", () => {
    const subjects = browserPdfTools(tools).map((t) => t.slug);
    expect(subjects.length).toBeGreaterThanOrEqual(15);
    expect(subjects).toContain("merge-pdf");
    expect(subjects).toContain("sign-pdf");
    // Worker tools are outside it; a filter that let them in would make
    // Protect PDF a "dead end" and this test red for the wrong reason.
    expect(subjects).not.toContain("protect-pdf");
    expect(subjects).not.toContain("pdf-to-jpg");
  });

  it("each has at least one continue target", () => {
    expect(browserPdfDeadEnds(tools)).toEqual([]);
  });

  it("POSITIVE CONTROL: a catalogue without the finishing steps leaves Sign PDF a dead end", () => {
    const without = tools.filter((t) => !FINISHING_STEPS.includes(t.slug));
    expect(browserPdfDeadEnds(without)).toContain("sign-pdf");
  });
});
