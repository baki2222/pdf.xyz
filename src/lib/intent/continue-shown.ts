/**
 * How many targets a result's "Continue with" row shows. A leaf of its own:
 * the row (an on-demand client chunk) reads it, and `next-steps.ts` — which
 * the server page runs, and which reads every target's file ceiling from the
 * job and worker tables — must not ride into that chunk to supply a number.
 */
export const CONTINUE_SHOWN = 4;
