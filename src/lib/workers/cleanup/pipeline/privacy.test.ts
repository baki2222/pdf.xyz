// @vitest-environment node
/**
 * Defense-in-depth no-leak proof at the ORCHESTRATOR boundary. The real projector already strips
 * every locator/identifier before its output reaches the pipeline; this test proves the orchestrator
 * is a content-free boundary REGARDLESS of what a stage hands it. Even if a (here deliberately
 * hostile) projection stage returns a document dense with keys, buckets, URLs, and secrets, the
 * orchestrator forwards it only to the next lens and NEVER emits it — the rolled-up output and the
 * receipt carry only bounded severities, small codes, and the arm names.
 */
import { afterEach, describe, expect, it } from "vitest";
import { runPipeline, type PipelineStages } from "./run";
import { setPipelineSink, resetPipelineSink } from "./metrics";
import { setPipelineObserver, resetPipelineObserverForTests } from "./receipt";

const AT = "2026-07-03T00:00:00.000Z";

/** A projection document stuffed with everything the pipeline must never surface. */
const HOSTILE = JSON.stringify({
  objects: [
    {
      Key: "artifacts/ACME-Q3-SECRET.pdf",
      Bucket: "prod-user-uploads",
      signedUrl: "https://prod.s3.amazonaws.com/x?X-Amz-Signature=deadbeefcafe",
      region: "us-east-1",
      Metadata: {
        "ocr-text": "Account 1234 balance",
        secret: "AKIAIOSFODNN7EXAMPLE",
      },
    },
  ],
});

const NEEDLES = [
  "acme",
  "secret",
  "prod-user-uploads",
  "amazonaws",
  "deadbeef",
  "us-east-1",
  "akia",
  "://",
  ".pdf",
  "account 1234",
];

/** Stages whose projections return the hostile blob but whose lenses report bounded verdicts. */
const hostileStages: PipelineStages = {
  project: () => ({ exitCode: 0, projected: HOSTILE }),
  verify: async () => ({ exitCode: 3 }),
  sweep: () => ({ exitCode: 4 }),
};

afterEach(() => {
  resetPipelineSink();
  resetPipelineObserverForTests();
});

describe("orchestrator output is content-free regardless of stage input", () => {
  it("leaks nothing from a hostile projection into stdout or the receipt", async () => {
    let receiptText = "";
    setPipelineObserver((r) => {
      receiptText = JSON.stringify(r);
    });
    const run = await runPipeline(HOSTILE, hostileStages, AT, "json");

    for (const text of [run.output.toLowerCase(), receiptText.toLowerCase()]) {
      for (const needle of NEEDLES) {
        expect(text, `leaked ${needle}`).not.toContain(needle);
      }
    }
    // It still rolled up the arms' bounded verdicts correctly.
    expect(run.exitCode).toBe(4);
    expect(run.result.severity).toBe("breach");
  });

  it("the emitted metrics carry only the bounded arm + severity labels", async () => {
    const labels: Record<string, string>[] = [];
    setPipelineSink((s) => labels.push({ ...s.labels }));
    await runPipeline(HOSTILE, hostileStages, AT);
    expect(labels).toEqual([
      { arm: "verify", severity: "drift" },
      { arm: "sweep", severity: "breach" },
    ]);
  });

  it("the text format is likewise content-free", async () => {
    const run = await runPipeline(HOSTILE, hostileStages, AT, "text");
    const text = run.output.toLowerCase();
    for (const needle of NEEDLES)
      expect(text, `leaked ${needle}`).not.toContain(needle);
  });
});
