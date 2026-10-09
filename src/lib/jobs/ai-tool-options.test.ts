// @vitest-environment node
/**
 * The route's AI option check and the worker's are the SAME check.
 *
 * `POST /api/jobs` now parses an AI job's options before it charges the
 * allowance (2026-09-28); until then only the processor did, after the charge.
 * A pre-check that disagrees with the worker is worse than none: where it is
 * looser the old defect survives, and where it is stricter the product refuses
 * jobs the worker would run. So this pins the pair, not either half:
 *
 *  - the table covers exactly the catalog's AI tools (derived, both
 *    directions, with a floor);
 *  - over a corpus of admitted AND refused bags, the route's verdict and the
 *    REAL processor's verdict (resolved from the registry) are identical,
 *    message included.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { capabilityForMode } from "./capabilities";
import { AI_TOOL_OPTION_PARSERS, parseAiToolOptions } from "./ai-tool-options";
import {
  AI_TOOL_OPTION_COUNTEREXAMPLES,
  AI_TOOL_OPTION_EXAMPLES,
} from "./ai-tool-options.examples";
import { createProcessorRegistry } from "@/lib/workers/processor";

const AI_TOOLS = tools
  .filter((tool) => capabilityForMode(tool.processing) === "ai")
  .map((tool) => tool.slug)
  .sort();

/** Deps with no extractor and no provider: a run stops right after options. */
const registry = createProcessorRegistry({
  summarize: {},
  translate: {},
  aiExtract: {},
  chatWithPdf: {},
});

async function workerVerdict(slug: string, options: Record<string, unknown>) {
  const processor = registry.resolve(slug);
  if (!processor) throw new Error(`no processor resolves ${slug}`);
  const result = await processor.process({
    tool: slug,
    options,
    inputs: [
      {
        fileId: "f_abc123def456",
        filename: "in.pdf",
        contentType: "application/pdf",
        bytes: new Uint8Array([1]),
      },
    ],
  });
  // The processor reports a refused option bag as `invalid_request`; every
  // other failure here is the missing extractor/provider, AFTER the options.
  return !result.ok && result.error.code === "invalid_request"
    ? { refused: true as const, message: result.error.message }
    : { refused: false as const };
}

describe("the table", () => {
  it("is exactly the catalog's AI tools, in both directions", () => {
    expect(
      AI_TOOLS.length,
      "no AI tools — asking nothing",
    ).toBeGreaterThanOrEqual(4);
    expect(Object.keys(AI_TOOL_OPTION_PARSERS).sort()).toEqual(AI_TOOLS);
  });

  it("has nothing to say about a tool that is not AI", () => {
    const nonAi = tools
      .filter((tool) => capabilityForMode(tool.processing) !== "ai")
      .map((tool) => tool.slug);
    expect(nonAi.length).toBeGreaterThan(10);
    for (const slug of nonAi) expect(parseAiToolOptions(slug, {})).toBeNull();
  });
});

describe("the route and the worker agree, on admitted and refused bags", () => {
  const corpus = AI_TOOLS.flatMap((slug) => [
    [slug, "admitted", AI_TOOL_OPTION_EXAMPLES[slug as never]] as const,
    [slug, "refused", AI_TOOL_OPTION_COUNTEREXAMPLES[slug as never]] as const,
  ]);

  it("health: every tool has one bag the parser admits and one it refuses", () => {
    for (const [slug, expected, bag] of corpus) {
      const verdict = parseAiToolOptions(slug, bag);
      expect(verdict, slug).not.toBeNull();
      expect(verdict!.ok, `${slug}'s ${expected} example`).toBe(
        expected === "admitted",
      );
    }
  });

  it.each(corpus)(
    "%s (%s bag): same verdict, same words",
    async (slug, _kind, bag) => {
      const route = parseAiToolOptions(slug, bag)!;
      const worker = await workerVerdict(slug, bag);
      expect(worker.refused, `${slug}: the route and the worker disagree`).toBe(
        !route.ok,
      );
      if (!route.ok && worker.refused) {
        expect(worker.message).toBe(route.error.body.error.message);
      }
    },
  );
});

describe("ai-extract's refusal is written for the person who typed it", () => {
  it("names the fields from one, without backticks, and keeps the machine pointer", () => {
    const verdict = parseAiToolOptions(
      "ai-extract",
      AI_TOOL_OPTION_COUNTEREXAMPLES["ai-extract"],
    )!;
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    const { message, details } = verdict.error.body.error;
    // Shipped until 2026-09-28: "`schema[1].name` duplicates an earlier field name."
    expect(message).toBe(
      "Field 2 has the same name as field 1. Give each field a different name.",
    );
    expect(message).not.toMatch(/`|schema\[/);
    expect(details?.[0]?.field).toBe("schema[1].name");
  });

  it("no ai-extract contract message carries a backtick or a zero-based path", () => {
    // Every refusal the corpus below can reach, so a new message is covered by
    // construction rather than by someone remembering to add it.
    const bags: Record<string, unknown>[] = [
      [] as unknown as Record<string, unknown>,
      {},
      { mode: "prompt" },
      { mode: "prompt", prompt: "a\u0000b" },
      { mode: "prompt", prompt: "x".repeat(5000) },
      { mode: "schema" },
      {
        mode: "schema",
        schema: Array.from({ length: 60 }, (_, i) => ({ name: `f${i}` })),
      },
      { mode: "schema", schema: ["nope"] },
      { mode: "schema", schema: [{ name: "" }] },
      { mode: "schema", schema: [{ name: "a\u0001" }] },
      { mode: "schema", schema: [{ name: "x".repeat(200) }] },
      { mode: "schema", schema: [{ name: "a", type: "money" }] },
      { mode: "schema", schema: [{ name: "a", description: 7 }] },
      { mode: "schema", schema: [{ name: "a", description: "b\u0002" }] },
      { mode: "schema", schema: [{ name: "a", description: "x".repeat(500) }] },
      AI_TOOL_OPTION_COUNTEREXAMPLES["ai-extract"],
    ];
    const messages = bags.map((bag) => {
      const verdict = parseAiToolOptions("ai-extract", bag)!;
      if (verdict.ok) throw new Error(`admitted: ${JSON.stringify(bag)}`);
      return verdict.error.body.error.message;
    });
    // Health: the corpus reaches many distinct refusals, not one repeated.
    expect(new Set(messages).size).toBeGreaterThanOrEqual(12);
    expect(messages.filter((m) => /`|\[\d+\]/.test(m))).toEqual([]);
  });
});
