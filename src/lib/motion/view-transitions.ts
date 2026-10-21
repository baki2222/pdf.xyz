/**
 * Is the view-transition layer built in? `PDFXYZ_VIEW_TRANSITIONS=1` at build
 * time, inlined by `next.config.mjs` (spec WP-12 "Flag"); off everywhere else,
 * vitest included. Read by `src/components/motion/vt.tsx` (the sheet travel,
 * M26) and the catalogue's refilter (M23); the hand-off launch makes the
 * same comparison inline (`handoffPush` in `@/lib/intent/launch`).
 */
export const VIEW_TRANSITIONS = process.env.PDFXYZ_VIEW_TRANSITIONS === "1";
