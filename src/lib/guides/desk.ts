/**
 * What a guide's desk says and takes, decided on the server from the tool
 * the guide teaches — so the desk (`@/components/intent/guide-desk`), a
 * client island, ships no catalogue.
 *
 * Shared by the guide page and by `file-ceilings.test.ts`, which renders
 * the desk for every tool: the caption is `stagingHint`, the one sentence
 * that names a tool's formats and its cap, and the test holds it to the
 * gate that enforces the cap — through the component a visitor reads it in.
 */
import type { GuideDeskProps } from "@/components/intent/guide-desk";
import { handoffCapabilityFor, takesOneFile } from "@/lib/handoff/capability";
import { acceptNoun } from "@/lib/intent/accept-noun";
import {
  EXTENSIONS_BY_FORMAT,
  MIME_BY_FORMAT,
} from "@/lib/jobs/mime-by-format";
import { stagingHint } from "@/lib/tools/file-ceilings";
import type { Tool } from "@/lib/tools/types";

/**
 * The guide's desk: a file dropped on it opens the tool the guide teaches,
 * already loaded (`GuideDesk`). Everything it says is decided here, from the
 * catalogue and the tool's live runner, so the island ships no catalogue: a
 * tool with no in-browser runner gets no "open X with it" (`opens: null`),
 * the noun is the hand-off notice's (`acceptNoun`), the caption the staging
 * hint every tool's limits are held to (`stagingHint`, `file-ceilings.test`),
 * and the picker's `accept` the same `accept` row, spelled as extensions and
 * types.
 */
export function guideDeskProps(tool: Tool): GuideDeskProps {
  const { mode } = handoffCapabilityFor(tool.slug);
  const labels = [...new Set(tool.accept.map((f) => f.toUpperCase()))];
  const accept = [
    ...new Set(
      labels.flatMap((label) => [
        ...(EXTENSIONS_BY_FORMAT[label] ?? []).map((ext) => `.${ext}`),
        ...(MIME_BY_FORMAT[label] ?? []),
      ]),
    ),
  ].join(",");
  return {
    tool: { slug: tool.slug, name: tool.name },
    opens: mode === "none" ? null : takesOneFile(mode) ? "one" : "many",
    noun: acceptNoun(tool.accept),
    accept,
    hint: stagingHint(tool),
  };
}

/**
 * Whether a guide about `tool` gets a desk at all: only when the tool takes a
 * FILE. Webpage to PDF takes an address (its `accept` is a lone `URL`), so a
 * desk on its guide could only say "Drop a URL file to see which tools open
 * it", a sentence about a file that does not exist. The rule is the one
 * `handoff/capability.ts` stages by: every format but a lone `URL`.
 */
export function guideHasDesk(tool: Tool): boolean {
  return tool.accept.some((format) => format.toUpperCase() !== "URL");
}
