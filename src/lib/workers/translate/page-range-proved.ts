/**
 * THE record of whether THIS worker process proved `translatePageRange`
 * (`./page-range-capability`), and its two readers: the heartbeat (which
 * publishes the verdict the prover returns) and the engine (which reads it
 * at job time through `translateDeps(env).pageChoice`, `./native`).
 *
 * Why the engine needs it (competitor audit #29, slice 7): the withheld-pages
 * notice may tell a reader to choose the untranslated pages next time only
 * when the panel will really offer a Pages field. The worker cannot read the
 * web tier's status; what it CAN know is its own proof, the same verdict its
 * heartbeat publishes and the panel reads. Code presence is not that
 * property (house rule 2): an image whose proof failed carries the same code
 * and publishes `false`.
 *
 * A leaf on purpose, like `./pdf-languages`: the engine must not import the
 * proof module, which builds its jobs from the engine.
 *
 * `null` until the start-up proof settles (and always, in a process that
 * never proves: a readiness probe, a test, the web tier), so nothing reads a
 * guess as a proof. The last verdict wins; the daemon proves once per
 * container run.
 */
let settled: boolean | null = null;

/** The verdict this process's proof returned, or null if none has. */
export function settledTranslatePageRange(): boolean | null {
  return settled;
}

/** Record the verdict `provesTranslatePageRange` is about to return. */
export function recordTranslatePageRange(proved: boolean): void {
  settled = proved;
}

/** Tests only: forget the verdict. */
export function resetTranslatePageRangeForTests(): void {
  settled = null;
}
