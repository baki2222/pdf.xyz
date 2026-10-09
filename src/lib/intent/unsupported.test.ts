// @vitest-environment node
/**
 * "No tool here opens HEIC photos." — rendered for every unsupported format,
 * and held to the catalogue it reads.
 *
 * The headline is a claim about the whole catalogue, so it is checked
 * against the whole catalogue: no tool's `accept` row may take the format.
 * The alternative is derived, so it is checked to exist and to take what the
 * answer says to save the file as. The rendered words are read for a
 * deferral, because "yet" would be a promise nobody made.
 */
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";
import { UNSUPPORTED_ANSWERS } from "@/lib/tools/intents";
import { UNSUPPORTED_FORMATS, toolAcceptsFormat } from "./formats";
import { answerText, unsupportedAnswer } from "./unsupported";

const answers = UNSUPPORTED_FORMATS.map((format) =>
  unsupportedAnswer(format, tools),
);

/** Words that defer a capability to an unstated future. */
const DEFERRAL = /\b(?:yet|soon|coming|planned|eventually)\b/i;

describe("the answer to a format nothing opens", () => {
  it("renders for every unsupported format (health)", () => {
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

  it("reads as the HEIC answer the explorer shows", () => {
    expect(answerText(unsupportedAnswer("HEIC", tools))).toBe(
      "No tool here opens HEIC photos. Save a JPG copy first. JPG to PDF takes JPG and PNG.",
    );
    expect(answerText(unsupportedAnswer("EPUB", tools))).toBe(
      "No tool here opens EPUB e-books.",
    );
  });

  it("never defers to a future nobody promised", () => {
    const deferring = answers
      .map((answer) => answerText(answer))
      .filter((text) => DEFERRAL.test(text));
    expect(deferring).toEqual([]);
    // Positive control: the spec's own wording would have been caught.
    expect(DEFERRAL.test("No tool here takes HEIC files yet.")).toBe(true);
  });
});
