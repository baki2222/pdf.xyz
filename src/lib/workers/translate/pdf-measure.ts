/**
 * The reflowed PDF's render cost, measured the same way on any host: three
 * chunks at the per-call ceiling (about 10,258 characters each, the most one
 * provider call returns) in a set of scripts, printed and read back through
 * the job's own per-job conservation check. A refusal on this corpus is a
 * FALSE DROP — a bug to fix, not a rate to accept.
 *
 * Shared by `pdf-capability.chromium.test.ts` (any desktop) and
 * `scripts/worker-translate-pdf-proof.ts` (inside the worker image), so the
 * two measurements are of one corpus.
 */
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import type { TranslateLanguage } from "@/lib/jobs/translate-pdf";
import type { TranslationPart } from "./assembly";
import type { TranslatePdfDeps } from "./engine";
import { LANGUAGE_SAMPLES } from "./pdf-capability";

/** About `chars` characters of Markdown in the sample's script. */
export function syntheticTranslation(
  sample: string,
  chars: number,
  chunk: number,
): string {
  const lines: string[] = [`## ${sample} ${chunk}`];
  let size = lines[0]!.length;
  let n = 0;
  while (size < chars) {
    n += 1;
    const line =
      n % 9 === 0
        ? `- ${sample} ${n}`
        : n % 13 === 0
          ? `### ${sample}`
          : [sample, `${sample},`, sample, `${n}.`, `${sample}.`].join(" ");
    lines.push(line, "");
    size += line.length + 2;
  }
  return lines.join("\n");
}

/** Three chunks at the per-call ceiling, as the assembly would hand them over. */
export function deliverySizeParts(
  language: TranslateLanguage,
): TranslationPart[] {
  return [1, 2, 3].map((chunk) => ({
    kind: "body" as const,
    pages: [chunk * 4 - 3, chunk * 4],
    chosen: null,
    text: syntheticTranslation(
      LANGUAGE_SAMPLES[language],
      TRANSLATE_MAX_INPUT_CHARS,
      chunk,
    ),
  }));
}

export interface RenderMeasurement {
  language: TranslateLanguage;
  ms: number;
  ok: boolean;
  reason?: string;
  bytes?: number;
  pages?: number;
  characters: number;
}

export interface RenderSummary {
  runs: RenderMeasurement[];
  p50Ms: number;
  maxMs: number;
  falseDrops: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};

export async function measureDeliverySizeRenders(
  render: TranslatePdfDeps["render"],
  languages: readonly TranslateLanguage[],
  repeats = 3,
  now: () => number = Date.now,
): Promise<RenderSummary> {
  const runs: RenderMeasurement[] = [];
  for (let r = 0; r < repeats; r++) {
    for (const language of languages) {
      const parts = deliverySizeParts(language);
      const characters = parts.reduce(
        (n, p) => n + (p.kind === "body" ? p.text.length : 0),
        0,
      );
      const t0 = now();
      const result = await render({
        input: { parts, target: language, sourceName: "synthetic.pdf" },
      });
      runs.push({
        language,
        ms: now() - t0,
        ok: result.ok,
        characters,
        ...(result.ok
          ? { bytes: result.bytes.byteLength, pages: result.pages }
          : { reason: result.reason }),
      });
    }
  }
  const times = runs.map((r) => r.ms);
  return {
    runs,
    p50Ms: median(times),
    maxMs: times.length ? Math.max(...times) : 0,
    falseDrops: runs.filter((r) => !r.ok).length,
  };
}
