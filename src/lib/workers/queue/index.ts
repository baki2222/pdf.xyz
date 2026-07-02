/**
 * Public surface of the job-queue provider contract.
 *
 * NOTE: this barrel re-exports the local-dev provider (Node in-process store) and
 * the Redis provider (`node:crypto` idempotency hashing), so import it only from
 * Node-runtime code (route handlers, the adapter). Node-free consumers (the
 * presence-only status reporter) import the leaf modules `./state`,
 * `./not-configured`, `./errors`, `./types`, and the node-free `./redis-config`
 * directly.
 */

export * from "./types";
export * from "./state";
export * from "./claim";
export * from "./redis-config";
export * from "./redis-scripts";
export { mapQueueFailure } from "./errors";
export { createNotConfiguredQueue } from "./not-configured";
export { createLocalDevQueue, type LocalDevQueueDeps } from "./local-dev";
export {
  createRedisQueue,
  type RedisQueueDeps,
} from "./redis";
export {
  createRedisClient,
  type RedisClient,
  type RedisFetch,
  type RedisArg,
  type RedisValue,
  type RedisResult,
} from "./redis-client";
export { createQueueProvider } from "./factory";
