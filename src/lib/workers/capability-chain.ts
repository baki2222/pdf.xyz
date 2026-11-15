/**
 * Run a start-up capability probe's job the way the EXECUTOR runs a real one,
 * in the executor's order (`./executor/executor.ts`):
 *
 *   1. the registry resolves the tool's processor (an unroutable job fails);
 *   2. the FILE-SOUNDNESS gate checks the inputs (`soundness.check`), and an
 *      `unsound` verdict fails the job before any processor runs;
 *   3. the processor runs the job (`processor.process`), on the shape the
 *      executor hands it — tool, options, inputs;
 *   4. the ARTIFACT-MANIFEST gate validates what the processor returned — its
 *      OWN content type and filename, never the engine's — with the job's
 *      retention (`DEFAULT_RETENTION`, the one policy every job carries) and
 *      the processor's bounded kind; an `invalid` verdict fails the job.
 *
 * Only then is the artifact handed back, for the probe's own independent
 * reader to judge.
 *
 * WHY (CLAUDE.md rule 5: the defects that survive are found at the point of
 * consumption). On 2026-11-14 (PR #314, fixed by #315) the HTML to PDF probe
 * called the processor directly and published `htmlZip: true` while the
 * executor's soundness gate refused every real ZIP job: the probe proved the
 * author's artifact — a processor that works — and not the consumer's — a
 * job that completes. Each gate is a hop a real job crosses, and a probe that
 * skips one can certify an image whose jobs all fail there.
 *
 * WHAT IT SKIPS, deliberately: the malware scanner. The probe's input is
 * generated in this process, so it is clean by construction, and the scanner
 * needs a clamd socket a start-up probe must not depend on. The queue,
 * storage, leases and the spend hook are likewise not hops a probe input can
 * fail at.
 *
 * Every gate defaults to the one the daemon's runtime resolves from the same
 * environment (`resolveWorkerSoundness`, `resolveWorkerArtifactManifest`), so
 * a gate an operator tuned is the gate the probe meets. Like the executor, a
 * DISABLED manifest gate (`skipped`) does not refuse.
 */
import { DEFAULT_RETENTION, type RetentionPolicy } from "@/lib/jobs/types";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "./artifacts";
import { processorKindForId } from "./observability/metrics";
import type { ProcessorRegistry } from "./processor/registry";
import type {
  ProcessorArtifact,
  ProcessorInputFile,
  ProcessorResult,
} from "./processor/types";
import { resolveWorkerSoundness, type SoundnessGate } from "./soundness";

type EnvSource = Record<string, string | undefined>;

/** One generated input file, as storage would hand it to the executor. */
export interface ProbeInput {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface ExecutorOrderJob {
  tool: string;
  input: ProbeInput;
  options?: Record<string, unknown>;
  /** The registry the probe's job is routed through: the daemon's own. */
  registry: ProcessorRegistry;
  /** Where the default gates read their policy: the daemon's environment. */
  env?: EnvSource;
  soundness?: SoundnessGate;
  manifest?: ArtifactManifestGate;
  retention?: RetentionPolicy;
}

/** Where the job stopped, and what it carried there. */
export type ExecutorOrderOutcome =
  | { stage: "unroutable" }
  | { stage: "unsound"; reason: string }
  | { stage: "failed"; result: Extract<ProcessorResult, { ok: false }> }
  | { stage: "rejected"; reason: string }
  | {
      stage: "delivered";
      result: Extract<ProcessorResult, { ok: true }>;
      artifact: ProcessorArtifact;
    };

/**
 * The job, run in the executor's order, reported by where it stopped. For a
 * probe whose steps EXPECT a refusal (the processor's own), which needs to
 * see the failure rather than a null.
 */
export async function runThroughExecutorOrder(
  job: ExecutorOrderJob,
): Promise<ExecutorOrderOutcome> {
  const processor = job.registry.resolve(job.tool);
  if (!processor) return { stage: "unroutable" };
  const inputs: ProcessorInputFile[] = [
    {
      fileId: "capability-probe",
      filename: job.input.filename,
      contentType: job.input.contentType,
      bytes: job.input.bytes,
      declaredBytes: job.input.bytes.byteLength,
    },
  ];
  const soundness = job.soundness ?? resolveWorkerSoundness(job.env);
  const sound = soundness.check({ tool: job.tool, inputs });
  if (sound.verdict === "unsound")
    return { stage: "unsound", reason: sound.reason };
  const result = await processor.process({
    tool: job.tool,
    options: job.options ?? {},
    inputs,
  });
  if (!result.ok) return { stage: "failed", result };
  const manifest = job.manifest ?? resolveWorkerArtifactManifest(job.env);
  const validation = manifest.validate({
    tool: job.tool,
    processor: processorKindForId(processor.id),
    retention: job.retention ?? DEFAULT_RETENTION,
    artifacts: result.artifacts,
  });
  if (validation.verdict === "invalid")
    return { stage: "rejected", reason: validation.reason };
  const artifact = result.artifacts[0];
  // The manifest gate refuses an empty set itself; a disabled gate does not.
  if (!artifact) return { stage: "rejected", reason: "no_artifacts" };
  return { stage: "delivered", result, artifact };
}

/**
 * The artifact a real job would deliver for this input — or null wherever
 * the executor would have failed the job (unroutable, unsound, a processor
 * failure, an invalid manifest), and on any throw.
 */
export async function proveThroughExecutorOrder(
  job: ExecutorOrderJob,
): Promise<ProcessorArtifact | null> {
  try {
    const outcome = await runThroughExecutorOrder(job);
    return outcome.stage === "delivered" ? outcome.artifact : null;
  } catch {
    return null;
  }
}
