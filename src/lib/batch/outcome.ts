/**
 * The two ways one file's work can end in a batch other than "here is the
 * result" or "it failed", as values a `process` function can produce:
 *
 *   - `throw new BatchSkip(reason)`: the file was looked at and deliberately
 *     left out — there was nothing for the tool to do. Its row says the reason
 *     and is not counted as a failure, nor reported as one.
 *   - `return withNote(result, note)`: the file finished, and there is one
 *     sentence the person should read that is not a failure.
 *
 * The batch driver (`use-batch-runner.ts`) unwraps both into the machine's
 * `item-skip` event and `item-success`'s `note`.
 */

/** Thrown by a batch `process` to leave a file out, with the reason shown. */
export class BatchSkip extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BatchSkip";
  }
}

/** A finished result carrying one sentence that is not a failure. */
export class NotedResult<R> {
  constructor(
    readonly result: R,
    readonly note: string,
  ) {}
}

/** Finish a file with `result`, and show `note` on its row. */
export function withNote<R>(result: R, note: string): NotedResult<R> {
  return new NotedResult(result, note);
}
