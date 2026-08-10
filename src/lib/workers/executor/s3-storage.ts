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
 *  - The user-facing download URL embedded in each {@link JobArtifact} is this app's
 *    OPAQUE retrieval route (`/api/artifacts/:id`), never a signed object-store URL: the
 *    route reads the bytes from the bucket server-side and streams them through the guarded
 *    access boundary, so nothing about the bucket, key, endpoint, or signature ever reaches
 *    the client. `expiresAt` is the artifact's retention / lifecycle-deletion window (the
 *    object is reaped by the bucket lifecycle then), the same figure the local path reports.
 *    The content-free provenance manifest (Phase 37) rides the object as SIGNED metadata
 *    ({@link ARTIFACT_MANIFEST_METADATA_HEADER}) so retrieval can re-validate it on download.
 *  - Object keys derive only from opaque ids via the shared {@link buildObjectKey}
 *    (never a client filename), and nothing here logs, returns, or serializes a
 *    key, URL, credential, or byte.
 *
 * Filename recovery (Phase 18): the app-server upload reservation now signs the
 * sanitized original filename as `x-amz-meta-filename` object metadata, so this
 * worker recovers a user-friendly input name from the object it reads and derives
 * the output name from it. The value is re-sanitized on read ({@link decodeFilenameMetadata}),
 * so a tampered/malformed header can only ever collapse to a safe name — and it is
 * still never part of any object key. When the header is absent (a legacy object,
 * or a deployment whose storage can't return metadata), the read falls back to a
 * neutral, content-type-derived name; the executor may then overlay the job spec's
 * display name, which is the deployment-independent source of truth. See
 * docs/WORKER_ARCHITECTURE.md.
 *
 * Node-only: it pulls the `node:crypto` signer, so it is constructed by the
 * daemon runtime (and its tests), never through the eager worker barrel.
 */

import { DEFAULT_RETENTION, type JobArtifact } from "@/lib/jobs";
import { newArtifactId } from "../ids";
import type { ProcessorInputFile } from "../processor/types";
import type { S3StorageConfig } from "../storage/s3-config";
import { buildObjectKey, signingTarget } from "../storage/s3-keys";
import {
  CONTENT_DISPOSITION_HEADER,
  FILENAME_METADATA_HEADER,
  contentDispositionAttachment,
  decodeFilenameMetadata,
} from "../storage/s3-metadata";
import {
  ARTIFACT_MANIFEST_METADATA_HEADER,
  encodeArtifactManifestMetadata,
} from "../storage/s3-manifest-metadata";
import {
  ARTIFACT_LIFECYCLE_METADATA_HEADER,
  encodeArtifactLifecycleMetadata,
} from "../storage/s3-lifecycle-metadata";
import { presignS3Url } from "../storage/s3-signer";
import type { StorageObjectKind } from "../storage/types";
import type { ExecutorStorage, WriteArtifactInput } from "./types";

const MINUTE_MS = 60_000;
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
 * Derive a safe, generic filename from a content-type. This is the FALLBACK used
 * only when an object carries no recoverable `x-amz-meta-filename` (a legacy
 * object, or a deployment whose storage can't return metadata); the primary path
 * recovers the sanitized original name from object metadata. PDFs — the
 * secure-worker's staple input — get a `.pdf` name; everything else falls back to
 * a neutral `input` name.
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
      // Recover the sanitized original filename from object metadata when present;
      // otherwise fall back to a neutral content-type-derived name. The metadata
      // value is re-sanitized, so it can never escape as a path or unsafe string.
      const recovered = decodeFilenameMetadata(
        res.headers.get(FILENAME_METADATA_HEADER),
      );
      return {
        fileId,
        filename: recovered ?? filenameForContentType(contentType),
        contentType,
        bytes,
        // `declaredBytes` is intentionally left unset here: the object's own
        // Content-Length equals the fetched size (a tautology, not the DECLARED
        // size), so it would give the soundness gate no signal. Carrying the upload
        // reservation's declared size as signed object metadata (mirroring the
        // filename header) is a forward-compatible extension; until it exists the
        // gate's `size_mismatch` check is simply inactive on S3 (every other
        // soundness check still applies). See docs/WORKER_ARCHITECTURE.md.
      };
    },

    async writeArtifact(input: WriteArtifactInput): Promise<JobArtifact> {
      const artifactId = newArtifactId();
      const key = buildObjectKey(config, "artifact", artifactId);

      // The artifact's retention / lifecycle-deletion window, resolved ONCE so the value the
      // object stores as lifecycle metadata and the value the client is told (`expiresAt`) are
      // byte-identical. Not a signed-link TTL — this is when the artifact stops being
      // downloadable, matching the local path.
      const expiresAtMs =
        now() + DEFAULT_RETENTION.outputTtlMinutes * MINUTE_MS;

      // PUT the real bytes. Sign + echo the content-type so the stored object is
      // typed correctly, plus a `Content-Disposition: attachment` carrying the safe
      // output name (defense-in-depth for any direct object access), plus — when the
      // gate produced one — the content-free provenance manifest as SIGNED object
      // metadata, so the storage-backed retrieval boundary can re-validate provenance
      // on download without a side table, plus the content-free lifecycle evidence (the
      // retention window) as SIGNED metadata, so retrieval can deny a logically-expired
      // object before the bucket lifecycle rule physically reaps it. Signing every header
      // locks the stored values to what the worker declared: the client cannot tamper them
      // on the PUT, and no control/CRLF can be injected (the header builders sanitize their
      // inputs; the manifest/lifecycle codecs emit ASCII-only tokens).
      const disposition = contentDispositionAttachment(input.filename);
      const putHeaders: Record<string, string> = {
        "content-type": input.contentType,
        [CONTENT_DISPOSITION_HEADER]: disposition,
        [ARTIFACT_LIFECYCLE_METADATA_HEADER]: encodeArtifactLifecycleMetadata({
          expiresAtMs,
          deleted: false,
        }),
        ...(input.manifest
          ? {
              [ARTIFACT_MANIFEST_METADATA_HEADER]:
                encodeArtifactManifestMetadata(input.manifest),
            }
          : {}),
      };
      const putUrl = sign("PUT", key, WORKER_OP_TTL_SECONDS, putHeaders);
      const res = await fetchImpl(putUrl, {
        method: "PUT",
        body: input.bytes,
        headers: putHeaders,
      });
      if (!res.ok) {
        // Transient: throw so the job is not completed and is redelivered. Any
        // bytes that did land are reclaimed by the bucket's lifecycle policy.
        throw new Error(
          `Object storage rejected the artifact write (${res.status}).`,
        );
      }

      // The client-facing download URL is this app's OPAQUE retrieval route — never a
      // signed object-store URL. The route reads the bytes from the bucket server-side
      // and streams them through the guarded access boundary, so nothing about the
      // bucket/key/signature is ever exposed.
      const expiresAt = new Date(expiresAtMs).toISOString();
      return {
        artifactId,
        filename: input.filename,
        contentType: input.contentType,
        bytes: input.bytes.byteLength,
        url: `/api/artifacts/${artifactId}`,
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
