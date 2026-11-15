/**
 * `./capability-chain`: a probe's job meets the executor's hops in the
 * executor's order. Each hop has a negative here, and the order is observed
 * (a refused input never reaches the processor; a failed processor never
 * reaches the manifest gate).
 */
import { describe, expect, it } from "vitest";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "./artifacts";
import {
  proveThroughExecutorOrder,
  runThroughExecutorOrder,
} from "./capability-chain";
import { ProcessorRegistry } from "./processor/registry";
import { processorFail, processorOk, type Processor } from "./processor/types";
import { resolveWorkerSoundness, type SoundnessGate } from "./soundness";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function processorReturning(
  calls: string[],
  result: Awaited<ReturnType<Processor["process"]>>,
): Processor {
  return {
    id: "pdf-office-export",
    tools: ["pdf-to-word"],
    supports: () => true,
    capability: () => ({
      id: "pdf-office-export",
      tools: ["pdf-to-word"],
      ready: true,
      detail: "",
    }),
    async process() {
      calls.push("process");
      return result;
    },
  };
}

const input = {
  bytes: PDF,
  filename: "probe.pdf",
  contentType: "application/pdf",
};
const good = processorOk([
  { filename: "probe.docx", contentType: DOCX_TYPE, bytes: PDF },
]);

function watched(calls: string[]) {
  const soundness = resolveWorkerSoundness({});
  const manifest = resolveWorkerArtifactManifest({});
  const s: SoundnessGate = {
    capability: soundness.capability,
    check: (i) => {
      calls.push("soundness");
      return soundness.check(i);
    },
  };
  const m: ArtifactManifestGate = {
    capability: manifest.capability,
    validate: (i) => {
      calls.push("manifest");
      return manifest.validate(i);
    },
  };
  return { soundness: s, manifest: m };
}

describe("runThroughExecutorOrder", () => {
  it("POSITIVE: soundness, then the processor, then the manifest gate, and the processor's own artifact comes back", async () => {
    const calls: string[] = [];
    const registry = new ProcessorRegistry().register(
      processorReturning(calls, good),
    );
    const outcome = await runThroughExecutorOrder({
      tool: "pdf-to-word",
      input,
      registry,
      ...watched(calls),
    });
    expect(outcome.stage).toBe("delivered");
    expect(calls).toEqual(["soundness", "process", "manifest"]);
    if (outcome.stage === "delivered")
      expect(outcome.artifact.filename).toBe("probe.docx");
  });

  it("an unsound input stops BEFORE the processor", async () => {
    const calls: string[] = [];
    const registry = new ProcessorRegistry().register(
      processorReturning(calls, good),
    );
    const outcome = await runThroughExecutorOrder({
      tool: "pdf-to-word",
      // Bytes that are not the PDF the name says.
      input: { ...input, bytes: new TextEncoder().encode("not a pdf at all") },
      registry,
      ...watched(calls),
    });
    expect(outcome.stage).toBe("unsound");
    expect(calls).toEqual(["soundness"]);
  });

  it("a failed processor stops BEFORE the manifest gate", async () => {
    const calls: string[] = [];
    const registry = new ProcessorRegistry().register(
      processorReturning(
        calls,
        processorFail({ code: "failed", message: "no", retryable: false }),
      ),
    );
    const outcome = await runThroughExecutorOrder({
      tool: "pdf-to-word",
      input,
      registry,
      ...watched(calls),
    });
    expect(outcome.stage).toBe("failed");
    expect(calls).toEqual(["soundness", "process"]);
  });

  it("an artifact whose content type does not match its name is rejected by the manifest gate", async () => {
    const calls: string[] = [];
    const registry = new ProcessorRegistry().register(
      processorReturning(
        calls,
        processorOk([
          { filename: "probe.docx", contentType: "text/plain", bytes: PDF },
        ]),
      ),
    );
    const outcome = await runThroughExecutorOrder({
      tool: "pdf-to-word",
      input,
      registry,
      ...watched(calls),
    });
    expect(outcome.stage).toBe("rejected");
    expect(calls).toEqual(["soundness", "process", "manifest"]);
  });

  it("an unroutable tool, and a throw, are null to a probe", async () => {
    const registry = new ProcessorRegistry();
    expect(
      await runThroughExecutorOrder({ tool: "pdf-to-word", input, registry }),
    ).toEqual({ stage: "unroutable" });
    const throwing = new ProcessorRegistry().register({
      ...processorReturning([], good),
      process: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      proveThroughExecutorOrder({
        tool: "pdf-to-word",
        input,
        registry: throwing,
      }),
    ).resolves.toBeNull();
    await expect(
      proveThroughExecutorOrder({
        tool: "pdf-to-word",
        input,
        registry: new ProcessorRegistry().register(
          processorReturning([], good),
        ),
      }),
    ).resolves.toMatchObject({ filename: "probe.docx" });
  });
});

describe("Translate PDF's two artifacts through the executor's order (2026-11-15)", () => {
  /**
   * The ZIP then the reflowed PDF must pass the REAL manifest gate under the
   * default retention, and a probe for the PDF must read the SECOND artifact:
   * `proveThroughExecutorOrder` returns `artifacts[0]`, the ZIP, which is why
   * the language proof (`translate/pdf-capability.ts`) uses
   * `runThroughExecutorOrder` and picks the PDF by content type.
   */
  const translator = (calls: string[]): Processor => ({
    id: "translate",
    tools: ["translate-pdf"],
    supports: (tool) => tool === "translate-pdf",
    capability: () => ({
      id: "translate",
      tools: ["translate-pdf"],
      ready: true,
      detail: "",
    }),
    async process() {
      calls.push("process");
      return processorOk([
        {
          filename: "probe-translation.zip",
          contentType: "application/zip",
          bytes: new Uint8Array([80, 75, 5, 6, ...new Array(18).fill(0)]),
        },
        {
          filename: "probe-translated.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ]);
    },
  });

  it("[zip, pdf] passes the manifest gate, and the PDF is the second artifact", async () => {
    const calls: string[] = [];
    const outcome = await runThroughExecutorOrder({
      tool: "translate-pdf",
      input,
      registry: new ProcessorRegistry().register(translator(calls)),
      ...watched(calls),
    });
    expect(outcome.stage, JSON.stringify(outcome)).toBe("delivered");
    if (outcome.stage !== "delivered") return;
    expect(calls).toEqual(["soundness", "process", "manifest"]);
    expect(outcome.artifact.contentType).toBe("application/zip");
    expect(outcome.result.artifacts.map((a) => a.contentType)).toEqual([
      "application/zip",
      "application/pdf",
    ]);
  });

  it("a probe reading artifacts[0] would never see the PDF", async () => {
    const artifact = await proveThroughExecutorOrder({
      tool: "translate-pdf",
      input,
      registry: new ProcessorRegistry().register(translator([])),
    });
    expect(artifact?.contentType).toBe("application/zip");
  });
});

describe("the delivery cap reaches the processor, as the executor threads it", () => {
  /**
   * `executor.ts` hands `processor.process` the job's `delivery` cap. Before
   * 2026-11-16 this chain did not, so a probe of behaviour UNDER a cap (the
   * chat retrieval proof, `chat-with-pdf/retrieval-capability.ts`) would have
   * run uncapped while claiming the capped path.
   */
  function capturing(seen: unknown[]): Processor {
    return {
      ...processorReturning([], good),
      async process(job) {
        seen.push(job.delivery);
        return good;
      },
    };
  }

  it("a job carrying `delivery` gives the processor that very cap", async () => {
    const seen: unknown[] = [];
    const delivery = { characters: 8_000 };
    const outcome = await runThroughExecutorOrder({
      tool: "pdf-to-word",
      input,
      delivery,
      registry: new ProcessorRegistry().register(capturing(seen)),
      env: {},
    });
    expect(outcome.stage).toBe("delivered");
    expect(seen).toEqual([delivery]);
  });

  it("a job without one gives the processor no `delivery` key at all (existing callers unchanged)", async () => {
    const seen: unknown[] = [];
    const keys: string[][] = [];
    const registry = new ProcessorRegistry().register({
      ...capturing(seen),
      async process(job) {
        keys.push(Object.keys(job));
        return good;
      },
    });
    await runThroughExecutorOrder({
      tool: "pdf-to-word",
      input,
      registry,
      env: {},
    });
    expect(keys).toEqual([["tool", "options", "inputs"]]);
  });
});
