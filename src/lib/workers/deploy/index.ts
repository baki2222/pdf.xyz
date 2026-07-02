/**
 * Node-free public surface of the worker **deployment-hardening** layer (Phase 19).
 *
 * It composes the lifecycle tooling, the daemon readiness, and the provider config
 * parsers into three operator-facing capabilities — malware-scan honesty, the
 * composed deployment readiness, and the production guardrails — all presence-only
 * and content-free. Safe to import from the operator CLI, the runtime, and tests;
 * it never reads or returns a secret and never touches a real cloud API. The one
 * host-dependent input (native-engine availability) is injected by the Node runtime.
 */

export * from "./scanner";
export * from "./readiness";
export * from "./guardrails";
