import type { ProcessingMode } from "./types";

/**
 * The one hue a mode is allowed. Two consumers, two syntaxes, one row.
 *
 * `dot` is what the site paints (`processing-badge.tsx`); `card` is what
 * Satori paints on the per-tool share card, which has no Tailwind and so needs
 * the same hue as literal colour.
 *
 * WAS a `tone` field holding Tailwind chip classes that NOTHING READ — the
 * badge's own docblock said so, and named the reason ("they hardcode the
 * legacy dark palette") — while the badge kept a second table of dot classes
 * and the share card kept a third of literal hexes. Three lists, one of them
 * dead and still looking authoritative. A mode's colour is now defined here,
 * and today both consumers read it from this row.
 *
 * NOT GUARDED: this comment used to say a `processing-hue` test failed any
 * other file that maps all four modes to colours. No such test was ever
 * committed, so nothing stops a fourth table today; `card-pixels.test.ts`
 * checks only that one in-browser tool's share card paints the client
 * `card.text` hue it reads from here.
 */
export interface ProcessingHue {
  /** Tailwind utility for the site's status dot. */
  dot: string;
  /** Literal colours for the share card: Satori resolves no class names. */
  card: { text: string; border: string; background: string };
}

export interface ProcessingMeta {
  label: string;
  short: string;
  description: string;
  hue: ProcessingHue;
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
  "An optional, clearly labeled step uploads the file to an encrypted secure worker — only when you start it, and only after the page confirms a worker is available.";

/** The whole hybrid story in two sentences: the default path, then the step. */
export const HYBRID_SUMMARY = `The main work runs in your browser, and on that path the file stays on your device. ${HYBRID_WORKER_STEP}`;

/**
 * Honest, user-facing copy for each processing mode. This is what lets us tell
 * users exactly what happens to their files without over-promising.
 */
export const processingMeta: Record<ProcessingMode, ProcessingMeta> = {
  client: {
    label: "Runs in your browser",
    short: "In-browser",
    description:
      "This tool processes files entirely on your device. Nothing is uploaded to a server.",
    hue: {
      dot: "bg-emerald-600",
      card: {
        text: "#6ee7b7",
        border: "rgba(52,211,153,0.32)",
        background: "rgba(52,211,153,0.12)",
      },
    },
  },
  server: {
    label: "Secure worker",
    short: "Secure worker",
    description:
      "Files are processed on an encrypted, isolated worker and permanently deleted shortly after.",
    hue: {
      dot: "bg-blue-600",
      card: {
        text: "#93c5fd",
        border: "rgba(96,165,250,0.32)",
        background: "rgba(96,165,250,0.12)",
      },
    },
  },
  hybrid: {
    label: "Browser-first",
    short: "Hybrid",
    description: HYBRID_SUMMARY,
    hue: {
      dot: "bg-cyan-600",
      card: {
        text: "#67e8f9",
        border: "rgba(34,211,238,0.32)",
        background: "rgba(34,211,238,0.12)",
      },
    },
  },
  ai: {
    label: "AI-assisted",
    short: "AI",
    // Names the third party: the AI work is done by an outside provider, from
    // the PDF's text (privacy policy section 3). "An AI model on secure
    // infrastructure" read as if the model ran on ours.
    description:
      "Sends your PDF's selectable text — not the file — to a third-party AI provider, under terms that prohibit training on it.",
    hue: {
      dot: "bg-violet-600",
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
