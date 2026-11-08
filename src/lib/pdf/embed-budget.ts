import { DEFAULT_DECODE_BUDGET_BYTES } from "./decode-budget";

/**
 * The total, in bytes, of page content pdf-lib may decode into ONE destination
 * document (one n-up or overlay run), across every page embedded into it.
 *
 * The patched pdf-lib (patches/pdf-lib@1.17.1.patch, PDFPageEmbedder) keeps
 * this ledger on the destination document's context, so it spans every page
 * and every /Contents entry of the operation, and repeats are charged each
 * time (each repeat really is inflated and re-deflated into the output). A
 * ledger per page let one sub-budget stream, named by every page of a 7.8 KB
 * file, cost n-up 15 GB of work and 125 s on the main thread.
 *
 * The patch carries the same number as its own constant; a test reads it back
 * out of every patched build file and compares.
 *
 * Why 4x the per-stream budget (1 GiB): it must sit above the per-stream
 * budget, or a legit document whose pages add up past 256 MiB would be refused
 * for a total no single page breaks. 1 GiB of decoded page content is about
 * 1,000 pages each as dense as the densest stream in the legit corpus
 * (1,045,278 bytes), from a file that would be tens of MB compressed. The cost
 * it bounds is time, not memory (each page's content is deflated before the
 * next is decoded): about 8 s of inflate plus re-deflate, measured at the
 * reviewer's 15 GB in 125 s, instead of time without bound.
 */
export const EMBED_TOTAL_BYTES = 4 * DEFAULT_DECODE_BUDGET_BYTES;
