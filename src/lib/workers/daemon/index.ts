/**
 * Node-free public surface of the worker-daemon foundation.
 *
 * Only the pure pieces are re-exported here — the argv parser, the injectable
 * daemon loop, and the presence-only readiness resolver — so this barrel is safe
 * to import from a status route or the `/status` page bundle. The Node-runtime
 * wiring (`./runtime`, which pulls the queue factory, the S3 signer, and the
 * native-compression probe) and the S3 executor storage are imported directly by
 * the CLI and tests, never through this barrel — mirroring how the executor barrel
 * withholds its Node-only local-dev storage.
 */

export * from "./args";
export * from "./daemon";
export * from "./readiness";
