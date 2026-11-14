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
