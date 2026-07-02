/**
 * Public surface of the object-storage provider contract.
 *
 * NOTE: this barrel re-exports the local-dev provider, which imports the
 * in-process store (a Node built-in). Import it only from Node-runtime code
 * (route handlers, the local-dev adapter). Node-free consumers (the eager
 * adapter selector, the presence-only status reporter) import the leaf modules
 * `./not-configured`, `./errors`, and `./types` directly.
 */

export * from "./types";
export { mapStorageFailure } from "./errors";
export { createNotConfiguredStorage } from "./not-configured";
export { createLocalDevStorage, type LocalDevStorageDeps } from "./local-dev";
