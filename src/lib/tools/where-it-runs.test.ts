// @vitest-environment node
/**
 * The /tools "Where it runs" choices, read off the one partition.
 *
 * The filter names a PROPERTY a reader chooses by — "Never uploads" — and not
 * a mode word, so its members must be the never-upload partition itself
 * (`processingSplit().neverUploads`), never "the tools whose mode is client".
 * Those are the same set today; the day a second never-upload mode exists
 * they would not be, and only the first answer would stay true. The other
 * choices name the mode a file can leave under, each from its own catalogue
 * mode, and together the choices must cover the catalogue exactly once.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { processingMeta } from "@/lib/tools/processing";
import { processingSplit } from "@/lib/tools/processing-split";
import type { Tool } from "@/lib/tools/types";
import { RUNS_IDS, whereItRuns } from "@/lib/tools/where-it-runs";

const split = processingSplit();
const options = whereItRuns(split);
const slugs = (list: readonly Tool[]) => list.map((t) => t.slug).sort();

describe("whereItRuns", () => {
  it("leads with the never-upload partition, by that name", () => {
    expect(options[0]!.id).toBe("never-uploads");
    expect(options[0]!.label).toBe("Never uploads");
    expect(slugs(options[0]!.tools)).toEqual(slugs(split.neverUploads));
  });

  it("covers the catalogue exactly once, and offers no empty choice", () => {
    const seen = options.flatMap((o) => o.tools.map((t) => t.slug));
    expect(seen.length).toBe(tools.length);
    expect(new Set(seen).size).toBe(tools.length);
    for (const option of options)
      expect(option.tools.length, option.id).toBeGreaterThan(0);
    // Every id the URL can carry is offered, and nothing else is.
    expect(options.map((o) => o.id).sort()).toEqual([...RUNS_IDS].sort());
  });

  it("each choice is one mode — the shape it shows is its tools' own", () => {
    for (const option of options) {
      const modes = new Set(option.tools.map((t) => t.processing));
      expect([...modes], option.id).toEqual([option.mode]);
    }
  });

  it("the uploading choices are labelled with their mode's own words", () => {
    for (const option of options.slice(1)) {
      const meta = processingMeta[option.mode];
      expect([meta.label, meta.plain], option.id).toContain(option.label);
    }
  });

  it("positive control: a mode that uploads with no choice of its own is refused, not dropped", () => {
    const stray = {
      ...split.workerOnly[0]!,
      slug: "stray",
      processing: "elsewhere",
    } as unknown as Tool;
    expect(() =>
      whereItRuns({
        ...split,
        workerOnly: [...split.workerOnly, stray],
        mayUpload: [...split.mayUpload, stray],
      }),
    ).toThrow(/stray/);
  });
});
