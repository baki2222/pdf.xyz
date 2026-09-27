// @vitest-environment node
/**
 * The AI input cap a page STATES is the cap the engines ENFORCE.
 *
 * Until 2026-08-11 the number 500,000 was written out eight times — four
 * engines, four `native.ts` wirings — and appeared in no user-facing sentence
 * at all. A visitor deciding whether to upload a 300-page report met the
 * file-size limit (100 MB, which that report is nowhere near) and never met the
 * limit that would actually stop them.
 *
 * Stating it creates a new obligation: a published number that the code can
 * change out from under. This guard pins the RELATIONSHIP rather than the
 * string — no copy is asserted here, only that every enforcing site derives
 * from the one constant the copy also derives from.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_INPUT_LIMITS,
  aiPagesAtDensest,
  aiPagesAtSparsest,
} from "@/lib/jobs/types";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import { CHAT_MAX_CHARACTERS_PER_QUESTION } from "@/lib/jobs/chat-with-pdf";
import { toolFaq } from "./tool-facts";
import { getToolBySlug } from "./index";

const ROOT = process.cwd();

/** Every AI tool that cuts its model input, and the two files that do the cutting. */
const AI_TOOLS = [
  "summarize",
  "translate",
  "ai-extract",
  "chat-with-pdf",
] as const;

/**
 * The tools still on the SHARED reading cap.
 *
 * INVERTED 2026-09-27 for chat-with-pdf, history kept: until then this demanded
 * that chat's engine and wiring read `AI_INPUT_LIMITS.maxInputCharacters` —
 * 500,000 characters on every question, while the route charged each question
 * a 41,032-character reservation and the chat processor never read the cap.
 * This test held that door: bounding chat's read to what it is charged turned
 * it red. Chat now has its own assertion below.
 */
const SHARED_CAP_TOOLS = AI_TOOLS.filter((tool) => tool !== "chat-with-pdf");

describe("the stated AI input cap is the enforced one", () => {
  it.each(SHARED_CAP_TOOLS)(
    "%s derives its cap from the shared constant",
    (tool) => {
      for (const file of [`${tool}/engine.ts`, `${tool}/native.ts`]) {
        const source = readFileSync(
          path.join(ROOT, "src", "lib", "workers", file),
          "utf8",
        );
        expect(
          source,
          `${file} must derive its input cap from AI_INPUT_LIMITS, not restate it`,
        ).toContain("AI_INPUT_LIMITS.maxInputCharacters");
      }
    },
  );

  it("chat-with-pdf reads to its per-question charge ceiling — and never the shared one", () => {
    // The inversion of the pin above: the files that once had to say 500,000
    // must now say the number chat is charged, and must not say the other.
    expect(CHAT_MAX_CHARACTERS_PER_QUESTION).toBeLessThan(
      AI_INPUT_LIMITS.maxInputCharacters,
    );
    for (const file of ["chat-with-pdf/engine.ts", "chat-with-pdf/native.ts"]) {
      const source = readFileSync(
        path.join(ROOT, "src", "lib", "workers", file),
        "utf8",
      );
      expect(
        source,
        `${file} must bound chat's read with CHAT_MAX_CHARACTERS_PER_QUESTION`,
      ).toContain("CHAT_MAX_CHARACTERS_PER_QUESTION");
      expect(
        source,
        `${file} reads chat to the shared 500,000 cap again — twelve times ` +
          "what a question is charged",
      ).not.toContain("AI_INPUT_LIMITS.maxInputCharacters");
    }
  });

  it("no engine or wiring restates the number literally", () => {
    // The failure this prevents is silent: one engine's cap drifts, the copy
    // keeps quoting the old figure, and nothing disagrees out loud.
    const offenders: string[] = [];
    for (const tool of AI_TOOLS) {
      for (const file of [`${tool}/engine.ts`, `${tool}/native.ts`]) {
        const source = readFileSync(
          path.join(ROOT, "src", "lib", "workers", file),
          "utf8",
        );
        if (/maxInputChars\w*\s*[:=]\s*\d[\d_,]*/.test(source)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the page range in copy is derived, and survives being checked", () => {
  it("computes both ends from the measured densities", () => {
    // A reader can check these against their own file. They are floors of a
    // division, not typed figures — see AI_INPUT_LIMITS for the measurement.
    expect(aiPagesAtDensest).toBe(
      Math.floor(
        AI_INPUT_LIMITS.maxInputCharacters /
          AI_INPUT_LIMITS.densestCharactersPerPage,
      ),
    );
    expect(aiPagesAtSparsest).toBe(
      Math.floor(
        AI_INPUT_LIMITS.maxInputCharacters /
          AI_INPUT_LIMITS.sparsestCharactersPerPage,
      ),
    );
    // The dense end must be the smaller one, or the sentence reads backwards.
    expect(aiPagesAtDensest).toBeLessThan(aiPagesAtSparsest);
  });

  it("states the cap on every READ-bound AI tool page, before the upload", () => {
    // INVERTED 2026-08-21, history kept: until then this loop included
    // "translate-pdf" and demanded the SHARED figure on its page — this test
    // PINNED the 49x overstatement. Translate's FAQ said 500,000 characters
    // while its engine refuses at TRANSLATE_MAX_INPUT_CHARS, and this guard
    // held the door: fixing the copy turned this test red. Green meant the
    // test agreed with the bug. Translate now has its own assertion below;
    // `ai-ceiling-surfaces.test.ts` derives the full page-vs-engine
    // relationship for every AI tool rather than naming slugs.
    //
    // chat-with-pdf LEFT this loop 2026-09-27, for the same reason translate
    // did: its engine no longer reads to the shared cap, so demanding the
    // shared figure on its page would pin a false claim. It has its own
    // assertion below, which demands ITS figure — not an exemption.
    for (const slug of ["summarize-pdf", "ai-extract"]) {
      const tool = getToolBySlug(slug);
      expect(tool, `${slug} is missing from the catalogue`).toBeDefined();
      const answers = toolFaq(tool!).map((entry) => entry.answer);
      const stated = answers.filter((a) =>
        a.includes(AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")),
      );
      expect(
        stated.length,
        `${slug}'s page never states the input cap a reader meets before uploading`,
      ).toBeGreaterThan(0);
      // And it names pages, not only characters — a character count is not
      // something a reader can hold their own document up against.
      expect(stated.join(" ")).toContain(String(aiPagesAtDensest));
    }
  });

  it("translate's page states ITS ceiling — and never the shared one", () => {
    // The OUTPUT-bound tool: its ceiling is what the model may write, not
    // what it may read. The relationship (stated figure === the figure the
    // engine enforces, page floors re-derived from it) is guarded in
    // `ai-ceiling-surfaces.test.ts`; this assertion is the inversion of the
    // pin above, kept HERE so the file that once demanded the false figure
    // now refuses it.
    const tool = getToolBySlug("translate-pdf");
    expect(tool, "translate-pdf is missing from the catalogue").toBeDefined();
    const answers = toolFaq(tool!).map((entry) => entry.answer);
    const stated = answers.filter((a) =>
      a.includes(TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US")),
    );
    expect(
      stated.length,
      "translate-pdf's page never states the ceiling a reader meets before uploading",
    ).toBeGreaterThan(0);
    // Pages, not only characters — from ITS ceiling at the measured densities.
    expect(stated.join(" ")).toContain(
      String(
        Math.floor(
          TRANSLATE_MAX_INPUT_CHARS / AI_INPUT_LIMITS.sparsestCharactersPerPage,
        ),
      ),
    );
    expect(
      answers.join(" "),
      "translate-pdf's page states the shared READING cap, which its engine " +
        "will not honour — the 49x defect this file used to pin",
    ).not.toContain(AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US"));
  });

  it("chat's page states ITS per-question ceiling — and never the shared one", () => {
    // The PER-QUESTION tool: its engine reads at most what one question is
    // charged, CHAT_MAX_CHARACTERS_PER_QUESTION, so that is the figure its FAQ
    // (which ships as FAQPage JSON-LD) must give, with page floors from the
    // same number. Page floors are derived HERE at the measured densities,
    // independently of whatever the copy computes.
    const tool = getToolBySlug("chat-with-pdf");
    expect(tool, "chat-with-pdf is missing from the catalogue").toBeDefined();
    const answers = toolFaq(tool!).map((entry) => entry.answer);
    const stated = answers.filter((a) =>
      a.includes(CHAT_MAX_CHARACTERS_PER_QUESTION.toLocaleString("en-US")),
    );
    expect(
      stated.length,
      "chat-with-pdf's page never states the per-question ceiling its engine reads to",
    ).toBeGreaterThan(0);
    const floors = [
      AI_INPUT_LIMITS.densestCharactersPerPage,
      AI_INPUT_LIMITS.sparsestCharactersPerPage,
    ].map((perPage) =>
      String(Math.floor(CHAT_MAX_CHARACTERS_PER_QUESTION / perPage)),
    );
    for (const floor of floors) expect(stated.join(" ")).toContain(floor);
    expect(
      answers.join(" "),
      "chat-with-pdf's page states the shared 500,000 reading cap, but its " +
        "engine reads at most one question's charge",
    ).not.toContain(AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US"));
  });

  it("does not state the cap on a tool that has none", () => {
    // A limit answer on merge-pdf would be a claim about a cap that does not
    // exist there — the same class of wrongness in the opposite direction.
    const merge = getToolBySlug("merge-pdf")!;
    const answers = toolFaq(merge)
      .map((e) => e.answer)
      .join(" ");
    expect(answers).not.toContain(
      AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US"),
    );
  });
});
