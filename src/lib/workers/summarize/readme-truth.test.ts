/**
 * What the Summarize package's README.txt says about summary.txt must be true
 * of the summary.txt beside it.
 *
 * Until 2026-11-18 the README listed `summary.txt   The AI summary as plain
 * text.`, set against `summary.md   The AI summary (markdown) ...`. That reads
 * as "the .txt has no Markdown in it". It does: summary.txt is the model's
 * text exactly as written (`SUMMARY_PACKAGE_FILES.text`), because the panel
 * shows that file and renders its Markdown, so a model that writes `**` and
 * `- ` puts them in the .txt as well. The panel's own words for the file
 * ("plain text", "Download TXT") name its FORMAT, which is true; the README
 * line contrasted it with Markdown, which was not.
 *
 * Judged on a real package from `runSummarize`, with a provider that answers
 * in Markdown, so the README is read beside the summary.txt it describes.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { joinPageTexts, type ExtractedPdfText } from "@/lib/pdf/text";
import type { SummarizeOptions } from "@/lib/jobs/summarize-pdf";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import { runSummarize, type PdfTextExtractor } from "./engine";

const MODEL_TEXT = [
  "## Key points",
  "",
  "- **Revenue** rose 4% in the quarter.",
  "- Costs fell, mostly in *logistics*.",
].join("\n");

const PAGE = "Revenue rose four percent. Costs fell in logistics.";

const extract: PdfTextExtractor = async (): Promise<ExtractedPdfText> => {
  const pages = [{ pageNumber: 1, text: PAGE, characterCount: PAGE.length }];
  const text = joinPageTexts(pages);
  return {
    pageCount: 1,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
};

const provider: AiProvider = {
  id: "anthropic",
  model: "probe-model",
  async complete(): Promise<AiCompletionResult> {
    return {
      ok: true,
      text: MODEL_TEXT,
      model: "probe-model",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
};

const OPTIONS: SummarizeOptions = { length: "brief", format: "bullets" };

async function packageOf() {
  const run = await runSummarize(new Uint8Array([1, 2, 3]), OPTIONS, {
    extract,
    provider,
  });
  if (!run.ok) throw new Error(`the run failed: ${run.message}`);
  const zip = await JSZip.loadAsync(run.output);
  const read = async (name: string) => {
    const entry = zip.file(name);
    if (!entry) throw new Error(`the package has no ${name}`);
    return entry.async("string");
  };
  return { txt: await read("summary.txt"), readme: await read("README.txt") };
}

/** The README's line for summary.txt (exactly one). */
function txtLine(readme: string): string {
  const lines = readme.split("\n").filter((l) => /\bsummary\.txt\b/.test(l));
  expect(lines, `README.txt lines naming summary.txt:\n${readme}`).toHaveLength(
    1,
  );
  return lines[0]!;
}

describe("README.txt describes the summary.txt beside it", () => {
  it("health: summary.txt is the model's Markdown, byte for byte", async () => {
    const { txt } = await packageOf();
    expect(txt).toBe(MODEL_TEXT);
    expect(txt).toContain("**");
  });

  it("does not promise plain text, set against Markdown, for a file that holds Markdown marks", async () => {
    const line = txtLine((await packageOf()).readme);
    expect(line).not.toMatch(/\bas plain text\b/i);
    expect(line).not.toMatch(
      /\bwithout (?:any )?(?:markdown|formatting|marks)\b/i,
    );
  });

  it("says what the file is: the model's words as written, Markdown marks kept", async () => {
    const line = txtLine((await packageOf()).readme);
    expect(line).toMatch(/\bas the model wrote it\b/i);
    expect(line).toMatch(/\bmarkdown marks\b/i);
  });
});
