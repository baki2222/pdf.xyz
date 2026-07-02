/**
 * Node-free public surface of the lifecycle/retention policy tooling (Phase 19).
 *
 * Everything here is pure data + string parsing — retention settings, the
 * provider-agnostic policy model, provider rendering, and presence-only lifecycle
 * readiness — so it is safe to import from the operator CLI, the deploy-readiness
 * layer, tests, or any status surface without pulling a Node built-in or ever
 * touching a real cloud API. Nothing in this barrel reads or returns a secret.
 */

export * from "./retention";
export * from "./policy";
export * from "./render";
export * from "./config";
export * from "./verify";
