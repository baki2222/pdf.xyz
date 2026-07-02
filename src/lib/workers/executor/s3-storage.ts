/**
 * The production worker-side {@link ExecutorStorage} backed by an S3-compatible
 * bucket (S3 / Cloudflare R2 / MinIO). This is the byte-I/O counterpart of the
 * app-server {@link import("../storage/s3").createS3Storage} provider: that one
 * only *mints signed targets* for the browser, whereas the deployed worker reads
 * the input objects and writes the artifact objects **itself**, using genuine
 * SigV4-signed GET / PUT / DELETE requests ({@link presignS3Url}). No bytes are
 * fabricated: an input read returns exactly the stored object, and an artifact is
 * only recorded after its bytes were really PUT to the bucket.
 *
 * Honesty / privacy guarantees:
 *  - A genuinely missing/expired input (S3 `404`) resolves to `null`, which the
 *    executor turns into a terminal `not_found` — but a *transient* failure (5xx,
 *    network error) THROWS, so the executor's tick errors out and the job's lease
 *    simply expires for at-least-once redelivery, rather than being wrongly
 *    reported as permanently gone.
 *  - The user-facing download URL embedded in each {@link JobArtifact} is a real,
 *    signed, expiring GET; nothing re-mints it downstream (the client fetches it
 *    verbatim), so `expiresAt` is set to exactly when that signed link dies.
 *  - Object keys derive only from opaque ids via the shared {@link buildObjectKey}
 *    (never a client filename), and nothing here logs, returns, or serializes a
 *    key, URL, credential, or byte.
 *
 * Known limitation (documented, not faked): the current upload contract signs an
 * object's content-type but does not persist the client's original *filename*, so
 * the worker cannot recover it. Inputs therefore surface a generic,
 * content-type-derived name; outputs are named from that. A later phase should
 * thread the filename through object metadata or the job spec. See
 * docs/WORKER_ARCHITECTURE.md.
 *
 * Node-only: it pulls the `node:crypto` signer, so it is constructed by the
 * daemon runtime (and its tests), never through the eager worker barrel.
 */

import type { JobArtifact } from "@/lib/jobs";
import { newArtifactId } from "../ids";
import type { ProcessorInputFile } from "../processor/types";
import type { S3StorageConfig } from "../storage/s3-config";
import { buildObjectKey, signingTarget } from "../storage/s3-keys";
import { presignS3Url } from "../storage/s3-signer";
import type { StorageObjectKind } from "../storage/types";
import type { ExecutorStorage, WriteArtifactInput } from "./types";

const SECOND_MS = 1000;
// A worker-side GET/PUT/DELETE is executed immediately; a small signed window
// covers clock skew without leaving a long-lived signed link lying around.
const WORKER_OP_TTL_SECONDS = 300;
const FALLBACK_CONTENT_TYPE = "application/octet-stream";

const FILE_ID = /^f_[A-Za-z0-9_-]{10,64}$/;
const ARTIFACT_ID = /^art_[A-Za-z0-9_-]{10,64}$/;

/**
 * The minimal object transport the worker needs to move bytes to/from the bucket.
 * Deliberately a narrow subset of the global `fetch`/`Response` shape (not the DOM
 * types) so a test injects a stub without the DOM lib and the module never assumes
 * a browser runtime. The global `fetch` satisfies it directly.
 */
export interface S3ObjectResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface S3ObjectRequest {
  method: "GET" | "PUT" | "DELETE";
  body?: Uint8Array;
  headers?: Record<string, string>;
}

export type S3ObjectFetch = (
  url: string,
  init: S3ObjectRequest,
) => Promise<S3ObjectResponse>;

/** Injectable seams so the storage is fully testable with a fake clock/network. */
export interface S3ExecutorStorageDeps {
  now?: () => number;
  /** Transport for signed object requests; defaults to the global `fetch`. */
  fetchImpl?: S3ObjectFetch;
}

const defaultFetch: S3ObjectFetch = (url, init) =>
  fetch(url, {
    method: init.method,
    // A Uint8Array is a valid fetch body at runtime; the cast bridges the TS 5.7+
    // `Uint8Array<ArrayBufferLike>` vs DOM `BodyInit` mismatch at this one boundary.
    ...(init.body ? { body: init.body as BodyInit } : {}),
    ...(init.headers ? { headers: init.headers } : {}),
  }) as unknown as Promise<S3ObjectResponse>;

/**
 * Derive a safe, generic filename from a content-type. The original client
 * filename is not recoverable from a stored S3 object under the current upload
 * contract (see the module header), so outputs are named from this rather than
 * from a fabricated original. PDFs — the secure-worker's staple input — get a
 * `.pdf` name; everything else falls back to a neutral `input` name.
 */
export function filenameForContentType(contentType: string): string {
  const base = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (base === "application/pdf") return "document.pdf";
  return "input";
}

/**
 * Build the worker-side S3 {@link ExecutorStorage} from a validated config. The
 * config holds the signing secret; it is captured in this closure and never
 * logged, serialized, or returned.
 */
export function createS3ExecutorStorage(
  config: S3StorageConfig,
  deps: S3ExecutorStorageDeps = {},
): ExecutorStorage {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? defaultFetch;

  const sign = (
    method: "GET" | "PUT" | "DELETE",
    key: string,
    expiresSeconds: number,
    signedHeaders?: Record<string, string>,
  ): string => {
    const { host, path } = signingTarget(config, key);
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
    async readInput(fileId): Promise<ProcessorInputFile | null> {
      // A claimed job's inputs are opaque ids the app minted; validate defensively
      // so a malformed id can never be shaped into an unexpected bucket key.
      if (!FILE_ID.test(fileId)) return null;

      const key = buildObjectKey(config, "input", fileId);
      const url = sign("GET", key, WORKER_OP_TTL_SECONDS);
      const res = await fetchImpl(url, { method: "GET" });

      // A genuine 404 means the object is gone/expired → honest `null` (the
      // executor fails the job terminally). Any other non-2xx is transient: throw
      // so the tick errors and the lease expires for redelivery — never a false
      // "not found".
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`Object storage returned status ${res.status}.`);
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType =
        res.headers.get("content-type")?.trim() || FALLBACK_CONTENT_TYPE;
      return {
        fileId,
        filename: filenameForContentType(contentType),
        contentType,
        bytes,
      };
    },

    async writeArtifact(input: WriteArtifactInput): Promise<JobArtifact> {
      const artifactId = newArtifactId();
      const key = buildObjectKey(config, "artifact", artifactId);

      // PUT the real bytes. Sign + echo the content-type so the stored object is
      // typed correctly and a later signed GET serves it back as-is.
      const putUrl = sign("PUT", key, WORKER_OP_TTL_SECONDS, {
        "content-type": input.contentType,
      });
      const res = await fetchImpl(putUrl, {
        method: "PUT",
        body: input.bytes,
        headers: { "content-type": input.contentType },
      });
      if (!res.ok) {
        // Transient: throw so the job is not completed and is redelivered. Any
        // bytes that did land are reclaimed by the bucket's lifecycle policy.
        throw new Error(`Object storage rejected the artifact write (${res.status}).`);
      }

      // Embed a real, signed, expiring download GET — the client fetches this URL
      // verbatim (nothing re-mints it), so `expiresAt` is exactly when it dies.
      const downloadUrl = sign("GET", key, config.downloadTtlSeconds);
      const expiresAt = new Date(
        now() + config.downloadTtlSeconds * SECOND_MS,
      ).toISOString();
      return {
        artifactId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes.byteLength,
        url: downloadUrl,
        expiresAt,
      };
    },

    async deleteInput(fileId): Promise<void> {
      await bestEffortDelete(fileId, FILE_ID, "input");
    },

    async deleteArtifact(artifactId): Promise<void> {
      await bestEffortDelete(artifactId, ARTIFACT_ID, "artifact");
    },
  };

  /**
   * Idempotent, best-effort delete-now. A cleanup delete runs after a job has
   * already reached its terminal state, so a storage hiccup here must NOT throw
   * and crash the tick — the object is reclaimed by the bucket lifecycle anyway.
   * Mirrors the local-dev storage, whose deletes never throw.
   */
  async function bestEffortDelete(
    id: string,
    pattern: RegExp,
    kind: StorageObjectKind,
  ): Promise<void> {
    if (!pattern.test(id)) return;
    const key = buildObjectKey(config, kind, id);
    const url = sign("DELETE", key, WORKER_OP_TTL_SECONDS);
    try {
      await fetchImpl(url, { method: "DELETE" });
    } catch {
      // Swallow: idempotent cleanup, lifecycle deletion is the backstop.
    }
  }
}
