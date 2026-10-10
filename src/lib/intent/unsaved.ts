/**
 * Unsaved work, and the question every surface asks before it throws some
 * away.
 *
 * A surface holding work a visitor would lose registers it while it is
 * there (`registerDirty`), and anything about to replace the open document
 * or leave the page — a file dropped on an editor, a launch from the ticket
 * — calls `confirmLeave()` first and does nothing when it returns false.
 *
 * The QUESTION is asked by every surface that discards: the editor's
 * "replace" target (`single-pdf-runner.tsx`) before a dropped file replaces
 * the document, the ticket and "Continue with" before they navigate, and
 * — while an editor holds edits — the page's own links and the browser's
 * `beforeunload` (`useUnsavedGuard`, `src/components/tools/runner`). The
 * editors that REGISTER are the ones whose work is more than a choice of
 * options (redesign spec D.6: edit, annotate, sign, create-forms, redact,
 * fill-forms, organize); nothing else is ever dirty, so everywhere else
 * the answer is yes without a question, as before this existed.
 *
 * ONE ANSWER PER GESTURE. A click on a Continue row is asked about by the
 * page's link guard and then by the launch it starts — the same gesture,
 * twice. A "yes" stands for the rest of the task it was given in
 * (`setTimeout 0`), so the visitor is asked once.
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
  if (question === null || agreed) return true;
  if (!ask(question)) return false;
  agreed = true;
  setTimeout(() => {
    agreed = false;
  }, 0);
  return true;
}

/** A "yes" given in this task: the same gesture is not asked twice. */
let agreed = false;

/** Forget every registration (vitest shares one module cache). */
export function resetUnsavedForTests(): void {
  dirty.length = 0;
  agreed = false;
}
