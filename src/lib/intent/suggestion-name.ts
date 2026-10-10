/**
 * What a suggestion's link is CALLED: the tool, and what opening it carries —
 * "Open Merge PDF with 2 files", "Open Fill forms with annex.pdf", "Open Word
 * to PDF — you'll add letter.docx there". The name says what the click does
 * — and, when it carries nothing, which files are meant — and the fact
 * behind the suggestion is the link's description.
 *
 * One spelling for every list of suggestions (the workspace's, the ticket's),
 * so a screen-reader user hears the same promise for the same row wherever
 * it is. The count goes in the NAME, not in visible text: the visible row
 * says it with its facts, and a second visible "2 files" would collide with
 * the workspace's own (`workspace.spec`'s `getByText(/2 files/i)`).
 */
import { renderEvidence, type Evidence } from "./evidence";
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
    // The row's own words for it, which name the files (WAS a fresh
    // "you'll add the file there" from the count alone: no referent for a
    // screen-reader user). A row that carries nothing for another reason
    // gets the same sentence, built from what the row has.
    const there =
      evidence.find((e) => e.kind === "add-there") ?? addThere(row, nameOf);
    return `Open ${tool.name} — ${renderEvidence(there)}`;
  }
  return carry.ids.length === 1
    ? `Open ${tool.name} with ${nameOf(carry.ids[0]!)}`
    : `Open ${tool.name} with ${carry.ids.length} files`;
}

/** "You'll add … there" for a row whose evidence does not already say it. */
function addThere(
  row: Pick<Suggestion, "evidence" | "opens">,
  nameOf: (id: string) => string,
): Extract<Evidence, { kind: "add-there" }> {
  const count = row.evidence.find((e) => e.kind === "count");
  return {
    kind: "add-there",
    count: row.opens.length,
    name: row.opens.length === 1 ? nameOf(row.opens[0]!) : null,
    noun: count?.noun ?? "file",
    format: count?.format ?? null,
    all: !row.evidence.some((e) => e.kind === "partial"),
  };
}
