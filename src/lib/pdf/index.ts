/**
 * Public entry point for the PDF engine. Re-exports the pure/isomorphic pieces
 * (types, range math, engine operations, and the tool registry). Browser-only
 * helpers live in "./browser" and are imported directly by client components so
 * server code never bundles DOM APIs.
 */
export * from "./types";
export * from "./ranges";
export * from "./engine";
export * from "./registry";
