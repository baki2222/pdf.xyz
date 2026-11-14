/**
 * A computation written as a generator that `yield`s between pieces of work,
 * so a caller on the main thread can let the browser paint and take input
 * between them (`compareInSteps`), while every other caller runs it straight
 * through ({@link drain}). A `yield` is a place it MAY pause, not a promise
 * that it will: the driver pauses only once a time slice is used up.
 *
 * Added 2026-11-14 (second review of audit compare-pdf#4): the comparison,
 * its word marks and its report ran as one task, and on two 99-page files
 * whose every line changed by one word that task blocked the page about
 * twice as long as main's whole comparison did.
 */
export type Steps<T> = Generator<Pause | void, T, void>;

/**
 * Yielded right before a piece that cannot be split — a diff — so the page
 * pauses there whatever is left of its slice: the piece then runs in a task
 * of its own instead of on the end of the click that started it.
 */
export const PAUSE = true;
export type Pause = typeof PAUSE;

/** Run `steps` to the end, with no pause, and return what it returns. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
