// @vitest-environment node
/**
 * CHARACTERISATION: the translation ZIP's exact bytes, for five fixed shapes.
 *
 * WHY (2026-11-15). Slice 1 of the translated-PDF work moves the assembly out
 * of `engine.ts` (into `assembly.ts`) and splits it into structured parts plus
 * a Markdown renderer. The ZIP is the artifact every existing reader opens —
 * the panel, the production AI proof, the user — so the refactor must not move
 * one byte of it. These hashes were recorded on the pre-refactor code (main
 * bf742a9a plus the spend fix, which changes no success path) and must stay
 * green after it.
 *
 * The bytes are a pure function of the fixtures: the manifest's `createdAt`
 * comes from the injected `now`, and since 2026-11-19 every ZIP entry is
 * dated with that `createdAt` (`buildPackage`). WAS: a frozen `Date`, because
 * JSZip stamped each entry with `new Date()`. The freeze is gone on purpose:
 * it made this file blind to that defect coming back (with it, the old engine
 * stayed green here; without it, all six cases go red on the old engine and
 * stay green, at the SAME hashes, on the fix — NOW is the instant the freeze
 * used, so no hash moved). `package-date.test.ts` holds the 2 s case.
 *
 * HISTORY, kept on purpose (re-recorded, not deleted):
 *   1. Recorded on the pre-refactor engine, then held GREEN through the move
 *      of the assembly into `assembly.ts` — the refactor moved no byte:
 *        single       49819a24a2bb137fb19199432ff97610da6346698f4d90b40eebb4f89af1d8b9
 *        chunked      5fae6d3be1d509ab5e7dbfe661942ab77355f7efef13e7c7445ef1164d5c58ea
 *        oversize gap e05c3c7dc333ce6a7802904a85d424661db90f57d7cb64fb58ffe927fffb4974
 *        withheld     49586f980602d2d135258d3e8563a7f3b98afc4c88bc1a7b72b7b0101c3b8e9c
 *        interrupted  fb0631be538e0b45065b629b6da02ac2c88ed1722df7c406c1f818d032dfe8d9
 *   2. Re-recorded 2026-11-15 after ONE deliberate content change: the
 *      manifest/README notice now says that, where the worker can draw the
 *      target language, a reflowed PDF of the same text comes with it. That
 *      sentence is in `manifest.json`, `translation.md` and `README.txt`, so
 *      every hash moved; `translation.txt` (the translation itself) did not.
 *        single       5296d38d3f7330640836998555b8653f78d148b6c5500f28ce38d4f7817701b3
 *        chunked      c9a93777776bbd09aa8ac02008a825e3231264f0bf712bea96d8b51f695f4f60
 *        oversize gap db5d356220e9ee9a1c685ccd88f6fd6d6113fc3baf791def3b496b3471e37728
 *        withheld     ddf136f99f369b53bd8e16721b6ccd2117452d699c30346a52e2d16fd835101c
 *        interrupted  3013f180b65f663c67762430cc4f8a25e49ce3f8d7c652eba8923d776a2def47
 *   3. INVERTED back to history 1, 2026-11-15 (review r1). The exit property
 *      is that the ZIP at artifacts[0] is byte-identical to main for EVERY
 *      job, and the sentence was also false inside the ZIP of any job whose
 *      render failed, timed out or was not conserved: the package said a PDF
 *      "comes with it" where none did. The notice is main's again, and these
 *      hashes are history 1's, re-derived by running the same fixtures through
 *      main's own `engine.ts` (bf742a9a) rather than copied from this comment.
 *   4. Re-recorded 2026-11-17, `withheld` ONLY, after one deliberate change:
 *      its marker is characters-bound, and that arm no longer advises
 *      "Translate the remaining pages as a separate document." (a rerun is
 *      declared the same way and refused; `translate-withheld-remedy.chain.test.ts`).
 *      Proved to be the only moved byte: with that one sentence put back, the
 *      case reproduced history 1's hash, 49586f98…. The other four cases are
 *      unchanged.
 *        withheld     680153a9ee3dd3a8cc4edd5b4940773f869880832f309a88e5c7193a0a43c552
 *
 * Health: each case also asserts the shape it claims to be (call count, the
 * gap marker it should contain), so a fixture that silently stopped chunking
 * cannot keep a hash that happens to be stable.
 */
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { runTranslate, type TranslateLimits } from "./engine";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "en",
};
const NOW = () => "2026-11-15T00:00:00.000Z";

function pagesOf(texts: readonly string[]): ExtractedPdfText {
  const pages = texts.map((text, i) => ({
    pageNumber: i + 1,
    text,
    characterCount: text.length,
  }));
  const joined = texts.join("\n\n");
  return {
    pageCount: texts.length,
    pages,
    text: joined,
    characterCount: joined.length,
    hasText: true,
  };
}

/** Answers call N with `Partie N` (or the scripted failure), recording the count. */
function numbered(
  failAt?: number,
  emptyAt?: number,
): AiProvider & { count: () => number } {
  let n = 0;
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    count: () => n,
    async complete(): Promise<AiCompletionResult> {
      n += 1;
      if (failAt !== undefined && n === failAt) {
        return {
          ok: false,
          kind: "provider_error",
          retryable: true,
          message: "upstream 500",
        };
      }
      if (emptyAt !== undefined && n === emptyAt) {
        return {
          ok: true,
          text: "  ",
          model: "claude-sonnet-5",
          usage: { inputTokens: 10, outputTokens: 0 },
        };
      }
      return {
        ok: true,
        text: `## Partie ${n}\n\nCeci est la partie ${n}, avec une liste :\n\n- un\n- deux`,
        model: "claude-sonnet-5",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

const PAGE = (c: string) => c.repeat(2000);

interface Case {
  name: string;
  extracted: ExtractedPdfText;
  failAt?: number;
  emptyAt?: number;
  limits?: TranslateLimits;
  calls: number;
  marker: RegExp | null;
  sha256: string;
}

const CASES: Case[] = [
  {
    name: "single",
    extracted: {
      pageCount: 2,
      pages: [],
      text: "A short document.",
      characterCount: 17,
      hasText: true,
    },
    calls: 1,
    marker: null,
    sha256: "49819a24a2bb137fb19199432ff97610da6346698f4d90b40eebb4f89af1d8b9",
  },
  {
    name: "chunked",
    extracted: pagesOf(
      Array.from({ length: 12 }, (_, i) => PAGE("abcdefghijkl"[i]!)),
    ),
    calls: 3,
    marker: null,
    sha256: "5fae6d3be1d509ab5e7dbfe661942ab77355f7efef13e7c7445ef1164d5c58ea",
  },
  {
    name: "oversize gap",
    extracted: pagesOf([
      PAGE("a"),
      "b".repeat(TRANSLATE_MAX_INPUT_CHARS + 10),
      PAGE("c"),
    ]),
    calls: 2,
    marker: /Page 2 is not translated/,
    sha256: "e05c3c7dc333ce6a7802904a85d424661db90f57d7cb64fb58ffe927fffb4974",
  },
  {
    name: "withheld",
    extracted: pagesOf([PAGE("a"), PAGE("b"), PAGE("c"), PAGE("d")]),
    limits: { delivery: { characters: 4_100 } },
    calls: 1,
    marker: /withheld|reserved|not translated/i,
    sha256: "680153a9ee3dd3a8cc4edd5b4940773f869880832f309a88e5c7193a0a43c552",
  },
  {
    name: "interrupted",
    extracted: pagesOf(
      Array.from({ length: 12 }, (_, i) => PAGE("abcdefghijkl"[i]!)),
    ),
    failAt: 2,
    calls: 2,
    marker: /could not be translated/,
    sha256: "fb0631be538e0b45065b629b6da02ac2c88ed1722df7c406c1f818d032dfe8d9",
  },
  // Added 2026-11-15 (review r1): the one shape where the branch's assembly
  // placed bodies differently from main (an empty EARLY chunk). The hash was
  // derived by running this fixture through main's own engine.ts (bf742a9a);
  // the branch was red against it until the ZIP kept main's placement.
  {
    name: "empty early chunk",
    extracted: pagesOf(
      Array.from({ length: 12 }, (_, i) => PAGE("abcdefghijkl"[i]!)),
    ),
    emptyAt: 1,
    calls: 3,
    marker: /could not be translated/,
    sha256: "6a0c8cdac67f09721efd7197985be753f2894519454458e4a14008cd9a2a6916",
  },
];

describe("the translation ZIP's bytes do not move", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_, c) => {
    const provider = numbered(c.failAt, c.emptyAt);
    const run = await runTranslate(new Uint8Array([1]), OPTIONS, {
      extract: async () => c.extracted,
      provider,
      now: NOW,
      ...(c.limits ? { limits: c.limits } : {}),
    });
    expect(run.ok, run.ok ? "" : run.message).toBe(true);
    if (!run.ok) return;
    expect(provider.count(), "the fixture lost its shape").toBe(c.calls);
    const md = await (
      await JSZip.loadAsync(run.output)
    )
      .file("translation.md")!
      .async("string");
    if (c.marker) expect(md).toMatch(c.marker);
    const digest = createHash("sha256").update(run.output).digest("hex");
    expect(digest).toBe(c.sha256);
  });
});
