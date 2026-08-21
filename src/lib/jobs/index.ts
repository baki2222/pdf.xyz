/**
 * Public surface of the pdf.xyz job/worker contract layer.
 *
 * Import from "@/lib/jobs" for the types, capability metadata, validators,
 * response builders, and backend-config detection that together define the
 * honest boundary to future secure-worker and AI processing.
 */

export * from "./types";
export * from "./capabilities";
export * from "./config";
export * from "./responses";
export * from "./validation";
export * from "./filenames";
export * from "./ocr";
export * from "./pdf-security";
export * from "./results";
export * from "./delivery-cap";
