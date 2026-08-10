/**
 * Public surface of the object-storage provider contract.
 *
 * NOTE: this barrel re-exports the local-dev provider (Node in-process store) and
 * the S3 provider (`node:crypto` signer), so import it only from Node-runtime
 * code (route handlers, the adapter). Node-free consumers (the presence-only
 * status reporter) import the leaf modules `./not-configured`, `./errors`,
 * `./types`, and the node-free `./s3-config` directly.
 */

export * from "./types";
export * from "./s3-config";
export { mapStorageFailure } from "./errors";
export { createNotConfiguredStorage } from "./not-configured";
export { createLocalDevStorage, type LocalDevStorageDeps } from "./local-dev";
export { createS3Storage, type S3StorageDeps, type S3DeleteFetch } from "./s3";
export { createStorageProvider } from "./factory";
