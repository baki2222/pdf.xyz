/**
 * What a suggestion's link is CALLED: the tool, and what opening it carries —
 * "Open Merge PDF with 2 files", "Open Fill forms with annex.pdf", "Open Word
 * to PDF — you'll add the file there". The name says what the click does;
 * the fact behind the suggestion is the link's description.
 *
 * One spelling for every list of suggestions (the workspace's, the ticket's),
 * so a screen-reader user hears the same promise for the same row wherever
 * it is. The count goes in the NAME, not in visible text: the visible row
 * says it with its facts, and a second visible "2 files" would collide with
 * the workspace's own (`workspace.spec`'s `getByText(/2 files/i)`).
 */
import { renderEvidence } from "./evidence";
import type { Suggestion } from "./rank";

export function suggestionName(
  row: Pick<Suggestion, "tool" | "carry" | "blocked" | "evidence" | "opens">,
  nameOf: (id: string) => string,
): string {
  const { tool, carry, blocked, evidence } = row;
  if (blocked) {
    const after = evidence.find((e) => e.kind === "after");
    return after
      ? `Open ${tool.name} — it opens these ${renderEvidence(after)}`
      : `Open ${tool.name}`;
  }
  if (carry.ids.length === 0) {
    return `Open ${tool.name} — ${renderEvidence({
      kind: "add-there",
      count: row.opens.length,
    })}`;
  }
  return carry.ids.length === 1
    ? `Open ${tool.name} with ${nameOf(carry.ids[0]!)}`
    : `Open ${tool.name} with ${carry.ids.length} files`;
}
