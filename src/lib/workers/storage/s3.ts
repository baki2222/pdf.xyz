/**
 * The production S3-compatible object-storage provider (S3 / Cloudflare R2 /
 * MinIO / any S3 API endpoint).
 *
 * It implements the {@link StorageProvider} contract by minting **real** AWS
 * SigV4 presigned URLs ({@link presignS3Url}): a single-use, expiring PUT for an
 * upload, a single-use, expiring GET for an artifact download, and a signed
 * DELETE it executes server-side for delete-now. The browser transfers bytes
 * directly to/from the bucket — the app server never proxies object bytes and
 * never ships a credential to the client (only the non-secret access key id and
 * the computed signature appear in a URL, exactly as any S3 presigned URL).
 *
 * Object keys are derived from the app's **opaque** ids (`f_…` / `art_…`), never
 * from a client-supplied name, so nothing enumerable or sensitive leaks into a
 * bucket key. The clock and the delete transport are injected, so the whole
 * provider is unit-testable deterministically and no test ever touches real S3.
 */

import { JOB_LIMITS } from "@/lib/jobs";
import { newFileId } from "../ids";
import type { S3StorageConfig } from "./s3-config";
import { presignS3Url } from "./s3-signer";
import type { StorageObjectKind, StorageProvider } from "./types";
import { s3StorageCapability } from "./s3-config";
import { storageFail, storageOk } from "./types";

/**
 * The minimal transport the provider needs to *execute* a signed DELETE. Kept to
 * this shape (not the DOM `fetch` type) so tests inject a stub without the DOM
 * lib and the module never assumes a browser `fetch`.
 */
export type S3DeleteFetch = (
  url: string,
  init: { method: "DELETE" },
) => Promise<{ ok: boolean; status: number }>;

/** Injectable seams so the provider is fully testable with a fake clock/network. */
export interface S3StorageDeps {
  now?: () => number;
  /** Transport for the delete-now request; defaults to the global `fetch`. */
  fetchImpl?: S3DeleteFetch;
}

const SECOND_MS = 1000;
// A signed DELETE is executed immediately server-side; a small window covers
// clock skew without leaving a long-lived signed link around.
const DELETE_TTL_SECONDS = 300;
const FILE_ID = /^f_[A-Za-z0-9_-]{10,64}$/;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{10,64}$/;

const defaultFetch: S3DeleteFetch = (url, init) =>
  fetch(url, init) as Promise<{ ok: boolean; status: number }>;

function validObjectId(kind: StorageObjectKind, id: string): boolean {
  return kind === "input" ? FILE_ID.test(id) : ARTIFACT_ID.test(id);
}

/**
 * Build the S3-compatible storage provider from a validated config. The config
 * holds the signing secret; it is captured in this closure and never logged,
 * serialized, or returned.
 */
export function createS3Storage(
  config: S3StorageConfig,
  deps: S3StorageDeps = {},
): StorageProvider {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  /** Map an opaque id to its private bucket key (with the optional prefix). */
  const buildKey = (kind: StorageObjectKind, id: string): string => {
    const folder = kind === "input" ? "inputs" : "artifacts";
    return (config.keyPrefix ? [config.keyPrefix, folder, id] : [folder, id]).join(
      "/",
    );
  };

  /** Resolve the signing host + request path for a key under the addressing style. */
  const target = (key: string): { host: string; path: string } =>
    config.forcePathStyle
      ? { host: config.host, path: `/${config.bucket}/${key}` }
      : { host: `${config.bucket}.${config.host}`, path: `/${key}` };

  const isoAfter = (seconds: number): string =>
    new Date(now() + seconds * SECOND_MS).toISOString();

  const sign = (
    method: "GET" | "PUT" | "DELETE",
    key: string,
    expiresSeconds: number,
    signedHeaders?: Record<string, string>,
  ): string => {
    const { host, path } = target(key);
    return presignS3Url({
      method,
      protocol: config.protocol,
      host,
      path,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      date: new Date(now()),
      expiresSeconds,
      ...(signedHeaders ? { signedHeaders } : {}),
    }).url;
  };

  return {
    id: "s3",

    probe() {
      // The config was validated on construction, so the provider is ready.
      return storageOk(undefined);
    },

    async reserveUpload(request) {
      if (request.declaredBytes > JOB_LIMITS.maxFileBytes) {
        return storageFail(
          "payload_too_large",
          "File exceeds the maximum secure-worker upload size.",
        );
      }

      const fileId = newFileId();
      const key = buildKey("input", fileId);
      // Sign the content-type so the stored object's type is locked to what was
      // declared; the client echoes exactly this header on its PUT.
      const url = sign("PUT", key, config.uploadTtlSeconds, {
        "content-type": request.contentType,
      });
      return storageOk({
        fileId,
        filename: request.filename,
        contentType: request.contentType,
        target: {
          url,
          method: "PUT",
          headers: { "content-type": request.contentType },
          maxBytes: JOB_LIMITS.maxFileBytes,
        },
        expiresAt: isoAfter(config.uploadTtlSeconds),
      });
    },

    async reserveDownload(request) {
      if (!validObjectId("artifact", request.artifactId)) {
        return storageFail(
          "not_found",
          "Artifact does not exist or is no longer available.",
        );
      }

      const key = buildKey("artifact", request.artifactId);
      const url = sign("GET", key, config.downloadTtlSeconds);
      const expiresAt = isoAfter(config.downloadTtlSeconds);
      return storageOk({
        artifactId: request.artifactId,
        target: { url, method: "GET", headers: {}, expiresAt },
        expiresAt,
      });
    },

    async deleteNow(kind: StorageObjectKind, id: string) {
      if (!validObjectId(kind, id)) {
        return storageOk({
          kind,
          id,
          deleted: true,
          deletedAt: new Date(now()).toISOString(),
        });
      }

      const key = buildKey(kind, id);
      const url = sign("DELETE", key, DELETE_TTL_SECONDS);
      let res: { ok: boolean; status: number };
      try {
        res = await fetchImpl(url, { method: "DELETE" });
      } catch {
        return storageFail(
          "unavailable",
          "Could not reach object storage to delete the object.",
        );
      }
      // S3/R2 return 204 for a successful delete and are idempotent; a 404 means
      // the object is already gone. Both satisfy the "object is gone" guarantee,
      // so `deleted` is true. (Unlike the in-process dev store, S3 does not report
      // whether the object had existed, and the caller only relies on it being
      // gone.)
      if (res.ok || res.status === 404) {
        return storageOk({
          kind,
          id,
          deleted: true,
          deletedAt: new Date(now()).toISOString(),
        });
      }
      return storageFail(
        "unavailable",
        "Object storage rejected the delete request.",
      );
    },

    capability() {
      return s3StorageCapability();
    },
  };
}
