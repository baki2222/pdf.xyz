// @vitest-environment node
/**
 * Per-tool headlines (`headline.ts`): the corpus in both directions.
 *
 * Every key must be a catalogue tool (a typo would silently fall back to
 * the short name), every headline must start with that tool's own name
 * (the H1 and the card name one thing), and every headline must add
 * something (an entry equal to the name is decoration). The rendered H1 of
 * every tool page is read against `toolHeadline` in
 * `src/app/tools/tool-page-layout.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { TOOL_HEADLINES, toolHeadline } from "./headline";

const bySlug = new Map(tools.map((t) => [t.slug, t]));

describe("tool headlines", () => {
  it("health: the catalogue and the headline list are both non-empty", () => {
    expect(tools.length).toBeGreaterThan(40);
    expect(Object.keys(TOOL_HEADLINES).length).toBeGreaterThan(0);
  });

  it("every headline belongs to a real tool, starts with its name and adds to it", () => {
    for (const [slug, headline] of Object.entries(TOOL_HEADLINES)) {
      const tool = bySlug.get(slug);
      expect(tool, `${slug} is not a catalogue tool`).toBeDefined();
      expect(headline.startsWith(tool!.name), slug).toBe(true);
      expect(headline.length, slug).toBeGreaterThan(tool!.name.length);
    }
  });

  it("PDF to PowerPoint names PPT and PPTX in its H1, and keeps its short name", () => {
    const tool = bySlug.get("pdf-to-powerpoint")!;
    expect(tool.name).toBe("PDF to PowerPoint");
    const h = toolHeadline(tool);
    expect(h).toMatch(/\bPPT\b/);
    expect(h).toMatch(/\bPPTX\b/);
  });

  it("a tool without a headline keeps its name (control)", () => {
    const plain = tools.find((t) => !(t.slug in TOOL_HEADLINES))!;
    expect(toolHeadline(plain)).toBe(plain.name);
  });
});
