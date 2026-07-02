/**
 * Public surface of the pdf.xyz worker layer — the honest bridge between the job
 * contract in `@/lib/jobs` and whatever processing backend is active.
 *
 * Import from "@/lib/workers" for worker-mode detection, the adapter selector,
 * and the (host-agnostic) compression engine. Node-only internals (the native
 * binary layer, the S3 signer, the in-memory dev store) are intentionally lazy or
 * not re-exported; route handlers that need real adapters load them through the
 * async selector.
 */

export * from "./mode";
export * from "./types";
export * from "./adapter";
export * from "./providers";
export * from "./status";
export * from "./ocr";
export * from "./compression/engine";
export * from "./processor";
export * from "./executor";
