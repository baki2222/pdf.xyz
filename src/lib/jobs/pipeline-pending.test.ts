import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { workerPipelineStages } from "./capabilities";
import { pipelineStagesForStatus } from "./pipeline-pending";

/**
 * HISTORY. Written on the wave-1 L03 branch against its own neutral stage
 * (`UNCONFIRMED_CHECKS_STAGE`, "File checks"), with a one-argument
 * `workerPipelineStages`. At the merge with the integration branch
 * (2026-09-28) that stage was retired in favour of the integration branch's
 * tri-state, per-tool `workerPipelineStages(null, tool)`, whose unknown-state
 * copy is held to the code by `pipeline-honesty.test.ts`. The properties
 * below are the same four, asked of what ships now:
 *  - known states pass straight through;
 *  - an unknown state claims neither answer (was also `not /malware/i`: the
 *    kept stage says a malware scan "is reported by the live worker", which
 *    names the question without answering it, so the ban is now on both
 *    answers in any tense rather than on the word);
 *  - exactly the scanner-dependent stage changes, in place;
 *  - the withheld claims are real and differ.
 */

/** A tool that uploads a PDF: the pipeline with a scan stage. */
const TOOL = getToolBySlug("pdf-to-word")!;

/** Both answers a scan stage can give, derived from the lists themselves. */
const CLAIMS = [true, false].map((active) => {
  const on = workerPipelineStages(true, TOOL);
  const off = workerPipelineStages(false, TOOL);
  const i = off.findIndex((s, k) => s.description !== on[k]?.description);
  return (active ? on : off)[i]!.description;
});

describe("pipelineStagesForStatus", () => {
  it("passes a KNOWN scan state straight through", () => {
    expect(pipelineStagesForStatus(true, TOOL)).toEqual(
      workerPipelineStages(true, TOOL),
    );
    expect(pipelineStagesForStatus(false, TOOL)).toEqual(
      workerPipelineStages(false, TOOL),
    );
  });

  it.each([null, undefined])(
    "claims neither answer while the state is %s",
    (unknown) => {
      const stages = pipelineStagesForStatus(unknown, TOOL);
      // `undefined` is "unknown" too, never "no".
      expect(stages).toEqual(workerPipelineStages(null, TOOL));
      const text = stages.map((s) => `${s.title} ${s.description}`).join(" ");
      for (const claim of CLAIMS) expect(text).not.toContain(claim);
      expect(text).not.toMatch(/(?:not |are |is |be )scanned for malware/i);
    },
  );

  it("replaces exactly the stage that depends on the scanner, in place", () => {
    const known = workerPipelineStages(false, TOOL);
    const pending = pipelineStagesForStatus(null, TOOL);
    expect(pending).toHaveLength(known.length);
    const changed = pending.filter(
      (s, i) => JSON.stringify(s) !== JSON.stringify(known[i]),
    );
    expect(changed.map((s) => s.id)).toEqual(["checks"]);
  });

  it("POSITIVE CONTROL: the claims it withholds are real, and differ", () => {
    expect(CLAIMS[0]).toMatch(/scanned for malware/);
    expect(CLAIMS[1]).toMatch(/not scanned for malware/);
    expect(CLAIMS[0]).not.toBe(CLAIMS[1]);
    // …and the tense-agnostic ban above does catch both of them.
    for (const claim of CLAIMS)
      expect(claim).toMatch(/(?:not |are |is |be )scanned for malware/i);
  });
});
