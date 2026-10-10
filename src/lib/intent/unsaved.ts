/**
 * Unsaved work, and the question every surface asks before it throws some
 * away.
 *
 * A surface holding work a visitor would lose registers it while it is
 * there (`registerDirty`), and anything about to replace the open document
 * or leave the page — a file dropped on an editor, a launch from the ticket
 * — calls `confirmLeave()` first and does nothing when it returns false.
 *
 * WP-07 wires the QUESTION into the surfaces that discard: the editor's
 * "replace" target (`single-pdf-runner.tsx`) asks before a dropped file
 * replaces the document. Which editors REGISTER, and the browser's own
 * `beforeunload` and link-click guards, are WP-08's (redesign spec D.6:
 * edit, annotate, sign, create-forms, redact, fill-forms, organize). Until
 * an editor registers, nothing is dirty and the answer is yes — which is
 * what every replace did before this existed, not a new promise.
 *
 * Module-level and a list, never a single slot (two editors can be dirty at
 * once); tests start from {@link resetUnsavedForTests}.
 */

interface Dirty {
  /** What would be lost, as the question names it: "your signature in Sign PDF". */
  readonly label: string;
}

const dirty: Dirty[] = [];

/** Record work that a replace or a navigation would lose; returns the release. */
export function registerDirty(label: string): () => void {
  const entry: Dirty = { label };
  dirty.push(entry);
  return () => {
    const at = dirty.indexOf(entry);
    if (at >= 0) dirty.splice(at, 1);
  };
}

/** What is unsaved right now, oldest first. */
export function unsavedLabels(): string[] {
  return dirty.map((d) => d.label);
}

/** The question, when there is unsaved work; null when there is none. */
export function leaveQuestion(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const what =
    labels.length === 1
      ? labels[0]!
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]!}`;
  return `You have unsaved changes: ${what}. Discard them?`;
}

/**
 * True when nothing unsaved would be lost, or the visitor agreed to lose it.
 * Synchronous on purpose: every caller is mid-gesture, and a launch that
 * waited on an async answer would lose the gesture's permission to open a
 * picker or navigate.
 */
export function confirmLeave(
  ask: (question: string) => boolean = (question) => window.confirm(question),
): boolean {
  const question = leaveQuestion(unsavedLabels());
  return question === null || ask(question);
}

/** Forget every registration (vitest shares one module cache). */
export function resetUnsavedForTests(): void {
  dirty.length = 0;
}
