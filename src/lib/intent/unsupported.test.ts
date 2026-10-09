// @vitest-environment node
/**
 * "No tool here opens HEIC photos." — built for every unsupported format,
 * and held to the catalogue it reads.
 *
 * The headline is a claim about the whole catalogue, so it is checked
 * against the whole catalogue: no tool's `accept` row may take the format.
 * The alternative is derived, so it is checked to exist and to take what the
 * answer says to save the file as.
 *
 * The WORDS are checked where the reader receives them, not here:
 * `src/components/tools/tools-explorer.test.tsx` renders the explorer at
 * `/tools?q=<format>` for every unsupported format, reads the answer region's
 * text for a deferral, and holds the HEIC answer word for word. Until
 * 2026-10-09 those two checks ran in this file over `answerText()`, a
 * sentence builder nothing rendered — the explorer composed its own — so a
 * deferral in the rendered answer passed both (review of WP-03). The function
 * is deleted rather than kept beside the real sentences.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { UNSUPPORTED_ANSWERS } from "@/lib/tools/intents";
import { UNSUPPORTED_FORMATS, toolAcceptsFormat } from "./formats";
import { unsupportedAnswer } from "./unsupported";

const answers = UNSUPPORTED_FORMATS.map((format) =>
  unsupportedAnswer(format, tools),
);

describe("the answer to a format nothing opens", () => {
  it("is built for every unsupported format (health)", () => {
    expect(answers.length).toBe(UNSUPPORTED_FORMATS.length);
    expect(answers.length).toBeGreaterThanOrEqual(10);
  });

  it("is true of the catalogue: no tool takes the format it names", () => {
    const takers = answers.flatMap((answer) =>
      tools
        .filter((t) => toolAcceptsFormat(t.accept, answer.format))
        .map((t) => `${t.slug} takes ${answer.format}`),
    );
    expect(takers).toEqual([]);
  });

  it("names a real way in wherever the data offers one", () => {
    const missing = answers
      .filter((a) => UNSUPPORTED_ANSWERS[a.format].becomes !== null)
      .filter((a) => a.alternative === null)
      .map((a) => a.format);
    expect(missing).toEqual([]);
    for (const answer of answers) {
      const becomes = UNSUPPORTED_ANSWERS[answer.format].becomes;
      const alt = answer.alternative;
      if (alt?.kind === "tool") {
        // The tool takes what the answer says to save as, and makes a PDF.
        expect(toolAcceptsFormat(alt.tool.accept, becomes)).toBe(true);
        expect(alt.tool.outputs).toContain("PDF");
      }
      if (alt?.kind === "accepts") {
        expect(alt.count).toBe(
          tools.filter((t) => toolAcceptsFormat(t.accept, alt.format)).length,
        );
      }
    }
  });
});
