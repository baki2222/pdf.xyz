/**
 * Does THIS worker image translate only the pages a person chose
 * (`translatePageRange`, competitor audit #29 slice 6)?
 *
 * ── NOT YET A PROOF (contract step) ──────────────────────────────────────────
 *
 * The slice lands in steps on one branch. The contract step puts the key on
 * the wire — types, schema, status, the route's admission gate — and the
 * daemon's proof table must publish it from a prover (`capability.test.ts`,
 * "publishes a computed value for every advertised capability"). Until the
 * proof is written here, this answers `false` on every image: the value an
 * image built before the key gives, the one value that can only REFUSE a page
 * choice (the panel shows no field, `POST /api/jobs` answers
 * `not_implemented` before anything is charged), never license one.
 *
 * The proof that replaces the body (the slice brief, section 7): a five-page
 * probe PDF whose page 1 is blank, run through `runThroughExecutorOrder` with
 * the image's REAL Translate extractor, a recording provider and a recording
 * PDF dep — chosen pages 2 and 4 must reach the model and pages 3 and 5 must
 * not, labels must name "Page 2", "Page 4" (or "Pages 2, 4"), and a page past
 * the end must fail with no provider call.
 *
 * Pinned by "the translatePageRange entry publishes false until its proof
 * exists" (`daemon/proved-capabilities.test.ts`), which the proof's commit
 * inverts rather than deletes.
 */

type Env = Record<string, string | undefined>;

/** `false` until the proof above is written. See the header. */
export async function provesTranslatePageRange(_env: Env): Promise<boolean> {
  return false;
}
