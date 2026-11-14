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

/**
 * An upload's id. `zip` = the upload was DECLARED a ZIP (its type or its
 * name, `uploadIsHtmlZip`), and the id then says so: `f_zip-` and a token,
 * where every other id is `f_` and a token alone. A token is exactly 22
 * characters, so the two shapes never meet ({@link isZipFileId} reads the
 * length too), and both pass every `f_…` id check unchanged.
 *
 * Why the id carries it (hostile review round 3, 2026-11-14): `POST
 * /api/jobs` admits a ZIP job for HTML to PDF only while the running worker
 * proves `htmlZip`, and it told a ZIP job by the `entry` option or by the
 * client's display-only `inputNames` — both optional. A direct caller who
 * uploaded `x.zip` while the worker proved it, and sent the job with
 * neither after the image was rolled back, was admitted, and the old image
 * printed the archive's bytes as "Your PDF is ready". The declaration is
 * signed into the upload (its type and name are locked by the signed PUT),
 * and the id is minted by us at that moment, so the job route reads what
 * the upload WAS from the id it is given, with no storage round trip.
 */
export function newFileId(zip = false): string {
  return `f_${zip ? ZIP_FILE_ID_TAG : ""}${token()}`;
}
const ZIP_FILE_ID_TAG = "zip-";

/** True for the id of an upload declared a ZIP ({@link newFileId}). */
export function isZipFileId(fileId: string): boolean {
  return /^f_zip-[A-Za-z0-9_-]{22}$/.test(fileId);
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
