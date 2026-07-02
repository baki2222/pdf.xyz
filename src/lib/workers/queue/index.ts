/**
 * Public surface of the job-queue provider contract.
 *
 * NOTE: this barrel re-exports the local-dev provider, which imports the
 * in-process store (a Node built-in). Import it only from Node-runtime code
 * (route handlers, the local-dev adapter). Node-free consumers import the leaf
 * modules `./state`, `./not-configured`, `./errors`, and `./types` directly.
 */

export * from "./types";
export * from "./state";
export { mapQueueFailure } from "./errors";
export { createNotConfiguredQueue } from "./not-configured";
export { createLocalDevQueue, type LocalDevQueueDeps } from "./local-dev";
