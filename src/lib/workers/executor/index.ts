/**
 * Public surface of the worker executor.
 *
 * Only the node-free pieces are re-exported here — the pure {@link createWorkerExecutor}
 * loop and its types — so this barrel is safe to import from the eager worker
 * entry point. The local-dev {@link ExecutorStorage} implementation
 * (`./local-dev-storage`) touches the in-process store and is imported directly
 * by Node-runtime code (tests, a dev driver), never through this barrel.
 */

export * from "./types";
export * from "./executor";
