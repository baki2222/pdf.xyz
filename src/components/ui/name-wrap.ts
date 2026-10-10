/**
 * Classes for text that may hold a FILE NAME, set inside a row: it may
 * shrink below its longest word (`min-w-0` — a flex or grid item's minimum
 * width is otherwise that word), and break inside a word that has no other
 * break opportunity (`wrap-anywhere`). Ordinary words still wrap at spaces;
 * only a word wider than its line is broken.
 *
 * People name files `Quarterly_Financial_Statement_Consolidated_Final.pdf`:
 * one word, wider than a phone. Until 2026-10-10 a tool page that refused
 * such a file (or Compare PDF, that took one) put it in a flex item, and 49
 * of the 50 tool pages scrolled sideways at 390px (486-658px wide). Every
 * place a tool page prints a name it was given wraps it with this, one
 * spelling, and `e2e/tool-layout.mobile.spec.ts` holds every tool page to
 * the phone's width with such a name taken and refused.
 *
 * Wrapping, not truncating: the name is the one thing the visitor recognises
 * in a refusal, so all of it stays on screen.
 */
export const NAME_WRAP = "min-w-0 wrap-anywhere";
