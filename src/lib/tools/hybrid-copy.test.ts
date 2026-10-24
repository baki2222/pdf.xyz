// @vitest-environment node
/**
 * A hybrid tool's page says which path uploads, and that the user chooses it.
 *
 * Audited at 67e8d0f on production /tools/compress-pdf, the only hybrid tool:
 *
 *  - Its one privacy FAQ, shipped to Google as FAQPage JSON-LD, asked "What
 *    happens to my file after Compress PDF runs?" and answered "The file is
 *    processed on an encrypted, isolated worker." `toolFaq` had two arms —
 *    in-browser and everything else — and hybrid fell into the worker arm. The
 *    default path (analysis + lossless repack) never calls the API; the only
 *    upload is the "Compress images on the worker" button.
 *  - The mode line said "Runs in your browser when possible, with an encrypted
 *    server fallback for large or complex files", and the capability descriptor
 *    (/status, worker preview) said the same with "when it can". There is no
 *    fallback: a 100 MB file is repacked in the browser, and nothing routes to
 *    the server unless the user starts that step.
 *
 * Nothing caught it because every guard over this copy was scoped by capability
 * as in-browser vs. not — so hybrid was checked as a worker tool, and the worker
 * sentence passed.
 *
 * The subjects are DISCOVERED (every catalogue tool whose mode maps to the hybrid
 * capability), bounded below so an empty set cannot pass, and read twice: through
 * the helpers, and through the rendered page's own JSON-LD and text.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode, describeCapability } from "@/lib/jobs/capabilities";
import { guidesForTool } from "@/lib/guides";
import { HYBRID_WORKER_STEP, getProcessingMeta } from "./processing";
import { howToSteps, toolFaq } from "./tool-facts";
import type { Tool } from "./types";
import {
  renderToolPages,
  type RenderedToolPage,
} from "@/tests/rendered-tool-pages";

/**
 * Claims a hybrid page may not make, as shapes. Each is exercised by a sentence
 * the product actually shipped (below), and each shipped sentence is caught.
 */
const FALSE_HYBRID_CLAIMS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "an automatic route to the server",
    pattern: /\bfall-?back\b/i,
  },
  {
    name: "unconditional worker processing of the file",
    pattern:
      /\b(?:the file|your (?:file|pdf)|it) (?:is|gets) (?:processed|handled|compressed) on an? (?:encrypted|secure|isolated)[^.]*\bworker\b/i,
  },
  {
    name: "a hedge that implies the system picks the path",
    pattern: /\bwhen (?:possible|it can|needed|necessary)\b/i,
  },
];

/** Verbatim, from production and from the source at 67e8d0f. */
const SHIPPED = [
  "The file is processed on an encrypted, isolated worker. Inputs are wiped when the job finishes, the download link stops working after 60 minutes, and stored copies are erased by a daily storage rule.",
  "Runs in your browser when possible, with an encrypted server fallback for large or complex files.",
  "Runs in your browser when it can, with an encrypted secure-worker fallback for large or complex files.",
];

const hits = (text: string) =>
  FALSE_HYBRID_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );

const hybridTools = (): Tool[] =>
  tools.filter((t) => capabilityForMode(t.processing) === "hybrid");

/** Every reader-facing string the helpers produce for a hybrid tool. */
function authoredStrings(tool: Tool): string[] {
  return [
    getProcessingMeta(tool.processing).description,
    describeCapability("hybrid").summary,
    ...toolFaq(tool).flatMap((e) => [e.question, e.answer]),
    ...howToSteps(tool),
    // The default flow, which a hybrid tool without authored steps would get.
    ...howToSteps(tool, null),
  ];
}

let pages: Map<string, RenderedToolPage>;
beforeAll(() => {
  pages = renderToolPages();
}, 180_000);

describe("the ban list and its corpus cover each other", () => {
  it("catches every sentence the product shipped", () => {
    const missed = SHIPPED.filter((s) => hits(s).length === 0);
    expect(missed, "a shipped false sentence walks past the list").toEqual([]);
  });

  it("every pattern catches a shipped sentence", () => {
    const idle = FALSE_HYBRID_CLAIMS.filter(
      ({ pattern }) => !SHIPPED.some((s) => pattern.test(s)),
    ).map(({ name }) => name);
    expect(idle, "decoration: no shipped sentence exercises these").toEqual([]);
  });
});

describe("a hybrid tool's copy says the upload is a step the user starts", () => {
  it("has subjects, so a blind walk cannot read as clean", () => {
    expect(
      hybridTools().map((t) => t.slug),
      "no catalogue tool maps to the hybrid capability — this suite is blind",
    ).not.toEqual([]);
    expect(pages.size, "the rendered census is implausibly small").toBe(
      tools.length,
    );
  });

  it("no helper string makes a claim from the ban list", () => {
    const offenders = hybridTools().flatMap((tool) =>
      authoredStrings(tool).flatMap((text) =>
        hits(text).map((name) => `${tool.slug}: ${name} — "${text}"`),
      ),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no rendered hybrid page makes one, in its text or its JSON-LD", () => {
    const offenders = hybridTools().flatMap((tool) => {
      const page = pages.get(tool.slug)!;
      return [
        page.text,
        ...page.faq.flatMap((e) => [e.question, e.answer]),
        ...page.howTo,
      ].flatMap((text) =>
        hits(text).map(
          (name) => `${tool.slug}: ${name} — "${text.slice(0, 160)}"`,
        ),
      );
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the served FAQ answers the question a searcher asks, and says no by default", () => {
    for (const tool of hybridTools()) {
      const entry = pages
        .get(tool.slug)!
        .faq.find((e) => /^Is my file uploaded when I use /.test(e.question));
      expect(
        entry,
        `${tool.slug}: the served FAQPage never answers "Is my file uploaded?"`,
      ).toBeDefined();
      expect(entry!.answer).toMatch(/^Not by default\b/);
      expect(entry!.answer).toMatch(/\bonly when you start it\b/);
    }
  });

  it("the worker sentence the retention answer carries is scoped to the optional step", () => {
    for (const tool of hybridTools()) {
      const retention = pages
        .get(tool.slug)!
        .faq.find((e) => /stops working after/.test(e.answer));
      expect(retention, `${tool.slug}: no retention answer`).toBeDefined();
      expect(retention!.question).toMatch(/\boptional\b/);
    }
  });

  it("the page and its guide answer the upload question with one sentence", () => {
    // The guide said it right (and still does); the page said it wrong. Two
    // answers to one question drift, so they share the worker sentence.
    for (const tool of hybridTools()) {
      const pageAnswer = pages
        .get(tool.slug)!
        .faq.find((e) => /uploaded/.test(e.question))!.answer;
      expect(pageAnswer).toContain(HYBRID_WORKER_STEP);
      // L07 (6eb730f) made guidesForTool return { guide, role }; "its own
      // guide" is the one whose primary tool this is — role "primary".
      const guideAnswers = guidesForTool(tool.slug)
        .filter(({ role }) => role === "primary")
        .flatMap(({ guide }) => guide.faq)
        .filter((e) => /\bupload(?:ed)?\b/.test(e.question));
      expect(
        guideAnswers.length,
        `${tool.slug}: its own guide no longer asks the upload question — re-point this check`,
      ).toBeGreaterThan(0);
      for (const e of guideAnswers)
        expect(e.answer).toContain(HYBRID_WORKER_STEP);
    }
  });
});
