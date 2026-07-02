/**
 * Shared object-key derivation for the S3-compatible storage layer.
 *
 * The app-server S3 provider (which signs the browser's upload / download /
 * delete URLs) and the worker-side {@link import("../executor/s3-storage").createS3ExecutorStorage}
 * (which reads input bytes and writes artifact bytes) MUST agree, byte-for-byte,
 * on where an object lives: the worker writes an artifact to exactly the key the
 * app later signs a download GET for. This leaf is the worker side's canonical
 * derivation; the app provider derives keys identically, and a unit test pins the
 * two in lockstep so they can never silently drift apart. It derives keys from the
 * app's opaque ids only (`f_…` / `art_…`), never from a client-supplied name, so
 * nothing enumerable or sensitive ever lands in a bucket key.
 */

import type { S3StorageConfig } from "./s3-config";
import type { StorageObjectKind } from "./types";

/** Map an opaque id to its private bucket key (under the optional key prefix). */
export function buildObjectKey(
  config: Pick<S3StorageConfig, "keyPrefix">,
  kind: StorageObjectKind,
  id: string,
): string {
  const folder = kind === "input" ? "inputs" : "artifacts";
  return (
    config.keyPrefix ? [config.keyPrefix, folder, id] : [folder, id]
  ).join("/");
}

/** Resolve the signing host + request path for a key under the addressing style. */
export function signingTarget(
  config: Pick<S3StorageConfig, "host" | "bucket" | "forcePathStyle">,
  key: string,
): { host: string; path: string } {
  return config.forcePathStyle
    ? { host: config.host, path: `/${config.bucket}/${key}` }
    : { host: `${config.bucket}.${config.host}`, path: `/${key}` };
}
