/**
 * Public barrel for the Phase 42 storage-artifact cleanup verifier / dry-run sweeper.
 *
 * Pure, node-free, content-free: a bounded inventory evaluator (`./evaluate`) over a
 * defensively-parsed offline inventory (`./inventory`), a closed taxonomy (`./taxonomy`),
 * a text renderer (`./render`), a receipt seam (`./receipt`), and the CLI arg parser
 * (`./args`). This layer NEVER lists a real bucket, calls a cloud API, or deletes an
 * object — production object deletion is operator-owned and out-of-band.
 */

export * from "./taxonomy";
export * from "./inventory";
export * from "./evaluate";
export * from "./render";
export * from "./receipt";
export * from "./args";
export * from "./run";
