// @vitest-environment node
/**
 * The translation ZIP is a pure function of the job: the same job, packaged
 * at two different moments, is the same bytes.
 *
 * THE DEFECT (CI run 43845278036, main). `buildPackage` (./engine.ts) called
 * `zip.file()` with no date, so JSZip stamped every entry with `new Date()`
 * in DOS time, which counts in 2-second steps. Two packages of one job then
 * differed whenever their builds fell on opposite sides of a 2 s tick, and
 * `engine.reading-order.test.ts`, which compares two packages by sha256,
 * failed on main — more often the slower the runner, never on purpose. For a
 * reader the same defect is a "Generated:" line in README.txt that the
 * archive's own entry dates contradict.
 *
 * THE FIX: every entry is dated with the manifest's `createdAt`, the moment
 * the README already names.
 *
 * Not a timing test: the clock is FAKE and moved by exactly 2 s between the
 * two builds, so the old code is red on every run on every runner (each
 * build lands in its own DOS second), and the fix green on every run.
 */
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { runTranslate } from "./engine";

const CREATED_AT = "2026-11-16T09:30:00.000Z";
const text = "Bonjour. ".repeat(40);
const EXTRACTED: ExtractedPdfText = {
  pageCount: 1,
  pages: [{ pageNumber: 1, text, characterCount: text.length }],
  text,
  characterCount: text.length,
  hasText: true,
};
const provider: AiProvider = {
  id: "anthropic",
  model: "claude-sonnet-5",
  async complete(): Promise<AiCompletionResult> {
    return {
      ok: true,
      text: "## Partie 1\n\nCeci est la traduction.",
      model: "claude-sonnet-5",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
};

async function packageAt(clock: string): Promise<Uint8Array> {
  vi.setSystemTime(new Date(clock));
  const run = await runTranslate(
    new Uint8Array([1]),
    { targetLanguage: "fr", sourceLanguage: "en" },
    { extract: async () => EXTRACTED, provider, now: () => CREATED_AT },
  );
  expect(run.ok, run.ok ? "" : run.message).toBe(true);
  if (!run.ok) throw new Error(run.message);
  return run.output;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("the translation ZIP does not carry the packaging clock", () => {
  afterEach(() => vi.useRealTimers());

  it("is byte-identical when packaged 2 s apart (one DOS-time step)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Two clocks a whole DOS step apart, both unlike CREATED_AT: the old code
    // stamped them into the entries, so its two packages differed.
    const a = await packageAt("2026-11-19T12:00:00.000Z");
    const b = await packageAt("2026-11-19T12:00:02.000Z");
    expect(a.length, "health: a package was built").toBeGreaterThan(0);
    expect(sha(b), "the package moved with the clock").toBe(sha(a));
  });

  it("dates every entry with the manifest's createdAt, as a reader's unzip shows it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const zip = await JSZip.loadAsync(await packageAt("2030-01-01T00:00:00Z"));
    const entries = Object.values(zip.files);
    // Health: the four files the README lists, not a vacuous empty archive.
    expect(entries.map((e) => e.name).sort()).toEqual([
      "README.txt",
      "manifest.json",
      "translation.md",
      "translation.txt",
    ]);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    ) as { createdAt: string };
    expect(manifest.createdAt).toBe(CREATED_AT);
    // JSZip reads DOS time back as UTC at 2 s resolution; CREATED_AT is on
    // an even second, so it reads back exactly.
    for (const e of entries)
      expect(e.date.toISOString(), e.name).toBe(CREATED_AT);
  });
});
