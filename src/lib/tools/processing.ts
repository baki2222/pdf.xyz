import type { ProcessingMode } from "./types";

/**
 * The one hue a mode is allowed. Two consumers, two syntaxes, one row.
 *
 * `ink` is what the site paints — the mode's shape, drawn in `currentColor`
 * (`processing-badge.tsx`); `card` is what Satori paints on the per-tool
 * share card, which has no Tailwind and so needs the same hue as literal
 * colour.
 *
 * The ink is the palette step that clears 3:1 (WCAG 1.4.11) on every ground
 * the badge sits on in BOTH colour schemes — canvas, panel and wash, light
 * and dark. That is why AI's ink is violet-500 and not the 600 its dot used:
 * the 600 measured 2.7:1 on the dark wash. `processing-badge.test.tsx`
 * measures each ink from Tailwind's own palette on every ground.
 *
 * WAS a `tone` field holding Tailwind chip classes that NOTHING READ — the
 * badge's own docblock said so, and named the reason ("they hardcode the
 * legacy dark palette") — while the badge kept a second table of dot classes
 * and the share card kept a third of literal hexes. Three lists, one of them
 * dead and still looking authoritative. A mode's colour is now defined here,
 * and today both consumers read it from this row.
 *
 * GUARDED since 2026-10-09 by `processing-hue-tables.test.ts`, which walks
 * every shipped source and fails any other file that maps all four modes to a
 * colour (an object or a switch; Tailwind palette or theme classes, hex, or
 * colour functions). Until then this comment named a test that was never
 * committed, so nothing stopped a fourth table. `card-pixels.test.ts` still
 * checks the other end: that one in-browser tool's share card paints the
 * client `card.text` hue it reads from here.
 */
export interface ProcessingHue {
  /**
   * Text-colour utility for the mode's shape. A TEXT colour because the
   * shape is an SVG filled with `currentColor`, which also lets forced-colours
   * mode repaint it with the system text colour.
   */
  ink: string;
  /** Literal colours for the share card: Satori resolves no class names. */
  card: { text: string; border: string; background: string };
}

/**
 * The mode's mark, so where a tool runs is never told by colour alone
 * (WCAG 1.4.1): a filled dot for in-browser, a half-filled dot for
 * browser-first, a ring for the secure worker, a diamond for AI. The fill
 * reads as "on your device" and the ring as "leaves it", with the hybrid
 * mode literally between them.
 */
export type ProcessingShape = "dot" | "half" | "ring" | "diamond";

export interface ProcessingMeta {
  label: string;
  short: string;
  /**
   * The home card's badge, in a visitor's words: no "worker", no mono caps.
   * `card-copy.test.ts` holds every one against the jargon list.
   */
  plain: string;
  description: string;
  hue: ProcessingHue;
  shape: ProcessingShape;
}

/**
 * The hybrid mode's worker step, said once — read by this table, the capability
 * descriptor (`jobs/capabilities.ts`), the tool FAQ and the compress guide.
 *
 * WAS "Runs in your browser when possible, with an encrypted server fallback for
 * large or complex files", and the descriptor said the same with "when it can".
 * Both described a mechanism that does not exist: nothing routes a file to the
 * server. Compress PDF's analysis and lossless repack always run in the browser,
 * whatever the size, and the worker pass happens only when the user presses its
 * button — which the panel offers only after `/api/worker/status` says a worker
 * can take it. `hybrid-copy.test.ts` holds the shipped sentences as its corpus.
 */
export const HYBRID_WORKER_STEP =
  "An optional, clearly labeled step uploads the file to a secure worker — only when you start it, and only after the page confirms a worker is available.";

/** The whole hybrid story in two sentences: the default path, then the step. */
export const HYBRID_SUMMARY = `The main work runs in your browser, and on that path the file stays on your device. ${HYBRID_WORKER_STEP}`;

/**
 * Honest, user-facing copy for each processing mode. This is what lets us tell
 * users exactly what happens to their files without over-promising.
 */
export const processingMeta: Record<ProcessingMode, ProcessingMeta> = {
  client: {
    plain: "In your browser",
    label: "Runs in your browser",
    short: "In-browser",
    description:
      "This tool processes files entirely on your device. Nothing is uploaded to a server.",
    shape: "dot",
    hue: {
      ink: "text-emerald-600",
      card: {
        text: "#6ee7b7",
        border: "rgba(52,211,153,0.32)",
        background: "rgba(52,211,153,0.12)",
      },
    },
  },
  server: {
    plain: "Secure server",
    label: "Secure worker",
    short: "Secure worker",
    description:
      "Files are processed on a secure worker, which deletes the upload when the job ends and serves the result for a limited time.",
    shape: "ring",
    hue: {
      ink: "text-blue-600",
      card: {
        text: "#93c5fd",
        border: "rgba(96,165,250,0.32)",
        background: "rgba(96,165,250,0.12)",
      },
    },
  },
  hybrid: {
    plain: "Browser first",
    label: "Browser-first",
    short: "Hybrid",
    description: HYBRID_SUMMARY,
    shape: "half",
    hue: {
      ink: "text-cyan-600",
      card: {
        text: "#67e8f9",
        border: "rgba(34,211,238,0.32)",
        background: "rgba(34,211,238,0.12)",
      },
    },
  },
  ai: {
    plain: "AI",
    label: "AI-assisted",
    short: "AI",
    // Names the third party: the AI work is done by an outside provider, from
    // the PDF's text (privacy policy section 3). "An AI model on secure
    // infrastructure" read as if the model ran on ours.
    description:
      "Sends your PDF's selectable text — not the file — to a third-party AI provider, under terms that prohibit training on it.",
    shape: "diamond",
    hue: {
      ink: "text-violet-500",
      card: {
        text: "#c4b5fd",
        border: "rgba(167,139,250,0.32)",
        background: "rgba(167,139,250,0.12)",
      },
    },
  },
};

export function getProcessingMeta(mode: ProcessingMode): ProcessingMeta {
  return processingMeta[mode];
}
