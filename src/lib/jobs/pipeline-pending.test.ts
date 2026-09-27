import { describe, expect, it } from "vitest";
import { workerPipelineStages } from "./capabilities";
import {
  pipelineStagesForStatus,
  UNCONFIRMED_CHECKS_STAGE,
} from "./pipeline-pending";

/** Both answers a scan stage can give, derived from the lists themselves. */
const CLAIMS = [true, false].map((active) => {
  const on = workerPipelineStages(true);
  const off = workerPipelineStages(false);
  const i = off.findIndex((s, k) => s.description !== on[k]?.description);
  return (active ? on : off)[i]!.description;
});

describe("pipelineStagesForStatus", () => {
  it("passes a KNOWN scan state straight through", () => {
    expect(pipelineStagesForStatus(true)).toEqual(workerPipelineStages(true));
    expect(pipelineStagesForStatus(false)).toEqual(workerPipelineStages(false));
  });

  it.each([null, undefined])(
    "claims neither answer while the state is %s",
    (unknown) => {
      const text = pipelineStagesForStatus(unknown)
        .map((s) => `${s.title} ${s.description}`)
        .join(" ");
      for (const claim of CLAIMS) expect(text).not.toContain(claim);
      expect(text).not.toMatch(/malware/i);
    },
  );

  it("replaces exactly the stage that depends on the scanner, in place", () => {
    const known = workerPipelineStages(false);
    const pending = pipelineStagesForStatus(null);
    expect(pending).toHaveLength(known.length);
    const changed = pending.filter(
      (s, i) => JSON.stringify(s) !== JSON.stringify(known[i]),
    );
    expect(changed).toEqual([UNCONFIRMED_CHECKS_STAGE]);
  });

  it("POSITIVE CONTROL: the claims it withholds are real, and differ", () => {
    expect(CLAIMS[0]).toMatch(/scanned for malware/);
    expect(CLAIMS[1]).toMatch(/not scanned for malware/);
    expect(CLAIMS[0]).not.toBe(CLAIMS[1]);
  });
});
