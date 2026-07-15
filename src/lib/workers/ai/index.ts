/**
 * Public surface of the pdf.xyz **AI provider foundation** — the vendor-neutral
 * {@link AiProvider} abstraction, the node-free env config detection, and the
 * Anthropic reference implementation.
 *
 * The node-free modules (`./provider`, `./config`) are safe to import anywhere,
 * including status/UI code that must reason about AI readiness without touching a
 * secret. The provider constructors (`./anthropic`) and the key-reading resolver
 * (`./native`) are server-only and imported by the worker runtime and its tests.
 */

export * from "./provider";
export * from "./config";
export * from "./anthropic";
export * from "./native";
