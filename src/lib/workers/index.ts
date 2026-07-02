/**
 * Public surface of the pdf.xyz worker layer — the honest bridge between the job
 * contract in `@/lib/jobs` and whatever processing backend is active.
 *
 * Import from "@/lib/workers" for worker-mode detection, the adapter selector,
 * and the (host-agnostic) compression engine. Node-only internals (the native
 * binary layer, the in-memory dev store) are intentionally NOT re-exported here;
 * the local-dev route handlers import them directly so this entry point stays
 * free of Node built-ins.
 */

export * from "./mode";
export * from "./types";
export * from "./adapter";
export * from "./status";
export * from "./compression/engine";
