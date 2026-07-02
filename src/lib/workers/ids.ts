/**
 * Opaque, URL-safe id minting for the worker layer.
 *
 * These ids (`f_…`, `job_…`, `art_…`, `sess_…`) are the *only* identifiers a
 * client ever sees; a production storage/queue provider maps them to private
 * bucket keys and broker message ids internally, so nothing enumerable or
 * meaningful about the deployment leaks to the browser. This is a node-only leaf
 * (it uses `node:crypto`) with **no** dependency on the in-process dev store, so
 * the eager production adapter can mint a session id without pulling the dev
 * store — or its bytes — into its bundle. The dev store re-exports these for
 * back-compat.
 */

import { randomBytes } from "node:crypto";

/** URL-safe opaque id body, matching the `[A-Za-z0-9_-]` contract charset. */
export function token(): string {
  return randomBytes(16).toString("base64url");
}

export function newFileId(): string {
  return `f_${token()}`;
}
export function newJobId(): string {
  return `job_${token()}`;
}
export function newArtifactId(): string {
  return `art_${token()}`;
}
export function newSessionId(): string {
  return `sess_${token()}`;
}
