/**
 * Node-free public surface of the **cleanup evidence posture monitoring** layer (Phase 44) — the
 * operational bridge that reads the content-free report SUMMARIES the Phase 42/43 cleanup tools
 * write and folds them into the secure-worker operations posture.
 *
 * It composes four pure seams: the bounded vocabulary (`./types`), the env config resolver
 * (`./config`), the trust-boundary parser that accepts only recognized summaries and refuses raw
 * exports (`./parse`), the worst-wins posture fold (`./posture`), and the content-free metric
 * derivation (`./metrics`). Everything here is node-free and content-free, so it is safe to import
 * from the `/api/worker/operations` route, the `/status` dashboard bundle, the daemon/ops-check
 * CLIs, and tests without pulling a Node built-in.
 *
 * The one host-dependent seam — actually reading the configured report files — lives in the
 * separate `./read` module (it imports `node:fs`), so a node-free consumer never pulls the
 * filesystem. A route or CLI imports `./read` directly to resolve a live posture.
 */

export * from "./types";
export * from "./config";
export * from "./parse";
export * from "./posture";
export * from "./metrics";
