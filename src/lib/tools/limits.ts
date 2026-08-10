/**
 * Client-side input ceilings, as a LEAF module: no imports, so every consumer
 * can derive from one source without a cycle — the catalogue (whose
 * descriptions state these caps), `tool-facts` (whose facts and FAQ state
 * them), the runners that gate a pick, AND the three engine modules that
 * actually refuse the work and name the figure in the error a user reads
 * (`image-to-pdf`, `markdown-to-pdf`, `text-to-pdf`).
 *
 * That last group is why this sentence is worded as it is. The engines used to
 * declare their own `25 * 1024 * 1024` / `2 * 1024 * 1024` and hand-write
 * "max 25 MB" / "max 2 MB" into their errors, and no guard walks `src/lib/pdf`
 * — so the stated cap and the enforced cap were two independent numbers that
 * merely happened to agree. Raising one would have advertised a limit the
 * engine still rejected, and the engine is the only gate for typed or pasted
 * input, which never passes a runner's file check at all.
 *
 * (These lived in `tool-facts.ts` until the catalogue needed them too:
 * catalog → tool-facts → capabilities → the tools barrel → catalog was a
 * real cycle that left `tools` undefined mid-init.)
 */

/** Per-image ceiling for image → PDF assembly. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_MB = MAX_IMAGE_BYTES / (1024 * 1024);

/** Source-text ceiling for text/markdown → PDF. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_MB = MAX_SOURCE_BYTES / (1024 * 1024);
