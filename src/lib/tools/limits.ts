/**
 * Client-side input ceilings, as a LEAF module: no imports, so both the
 * catalogue (whose descriptions state these caps) and `tool-facts` (whose
 * facts/FAQ state them) can derive from one source without a cycle. The
 * runners enforcing the caps import them back from `tool-facts`'s re-export,
 * so the stated figure and the enforced figure cannot drift apart.
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
