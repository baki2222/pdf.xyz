// @vitest-environment node
/**
 * The tool index is the catalogue, projected — every field read from the
 * module that decides it, never restated.
 *
 * The ranking that reads it (what to suggest for a dropped file) must agree
 * with what a hand-off will carry and what a tool will refuse. So each derived
 * field is checked against its source of truth for EVERY tool: the hand-off
 * mode against `handoffCapabilityFor`, the ceiling against
 * `toolFileCeilingBytes` (the figure the tool page states). A copy of either
 * would drift the day its source moved.
 */
import { describe, expect, it } from "vitest";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { tools } from "@/lib/tools";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import { buildToolIndex } from "./tool-index";

describe("buildToolIndex", () => {
  const index = buildToolIndex();

  it("has one entry per tool, in catalogue order (health)", () => {
    expect(tools.length).toBeGreaterThanOrEqual(40);
    expect(index.map((entry) => entry.slug)).toEqual(tools.map((t) => t.slug));
  });

  it("copies the catalogue's own fields unchanged", () => {
    for (const [i, tool] of tools.entries()) {
      expect(index[i]).toMatchObject({
        slug: tool.slug,
        name: tool.name,
        tagline: tool.tagline,
        category: tool.category,
        icon: tool.icon,
        processing: tool.processing,
        accept: tool.accept,
        outputs: tool.outputs,
        related: tool.related ?? [],
      });
    }
  });

  it("derives the hand-off mode and the ceiling from the modules that decide them", () => {
    const drift = index.flatMap((entry) => {
      const tool = tools.find((t) => t.slug === entry.slug)!;
      const out: string[] = [];
      if (entry.handoffMode !== handoffCapabilityFor(entry.slug).mode) {
        out.push(`${entry.slug} handoffMode`);
      }
      if (entry.ceilingBytes !== toolFileCeilingBytes(tool)) {
        out.push(`${entry.slug} ceilingBytes`);
      }
      return out;
    });
    expect(drift).toEqual([]);
  });

  it("holds both verdicts: tools that take a hand-off and tools that do not", () => {
    // Positive control for the check above: a projection that defaulted every
    // tool to one mode would pass it only if the catalogue were uniform.
    const modes = new Set(index.map((entry) => entry.handoffMode));
    expect(modes.has("none")).toBe(true);
    expect(modes.has("single")).toBe(true);
    expect(index.some((entry) => entry.ceilingBytes === null)).toBe(true);
  });
});
