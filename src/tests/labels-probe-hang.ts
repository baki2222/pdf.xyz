/**
 * `provesRequestSignatureLabels` with a placer that never settles, run in a
 * FRESH process: `tsx src/tests/labels-probe-hang.ts [timeoutMs]`. Nothing
 * else in this process holds the event loop open, so the probe's own time
 * bound is the only thing that can carry it to a verdict. Prints one line of
 * JSON, `{"verdict":false,"ms":N}`, and then `{"after":true}` once the
 * caller's await has returned.
 *
 * Added 2026-11-18 (review of the labels probe): the bound was `unref()`'d,
 * so in exactly this situation the process exited silently mid-proof, with
 * neither line printed, instead of reporting false at the bound.
 */
import { createProcessorRegistry } from "@/lib/workers/processor";
import { resolveWorkerArtifactManifest } from "@/lib/workers/artifacts";
import { resolveWorkerSoundness } from "@/lib/workers/soundness";
import type { SignatureRequestDeps } from "@/lib/workers/request-signatures/engine";
import { signatureRequestDeps } from "@/lib/workers/request-signatures/native";
import { provesRequestSignatureLabels } from "@/lib/workers/request-signatures/labels-capability";

async function main(): Promise<void> {
  const timeoutMs = Number(process.argv[2] ?? "300");
  const env = {};
  const hanging: SignatureRequestDeps = {
    ...signatureRequestDeps(),
    place: () => new Promise<Uint8Array>(() => {}),
  };
  const started = Date.now();
  const verdict = await provesRequestSignatureLabels(
    env,
    createProcessorRegistry,
    resolveWorkerSoundness(env),
    resolveWorkerArtifactManifest(env),
    hanging,
    timeoutMs,
  );
  process.stdout.write(
    `${JSON.stringify({ verdict, ms: Date.now() - started })}\n`,
  );
}

void main().then(() => {
  process.stdout.write(`${JSON.stringify({ after: true })}\n`);
});
