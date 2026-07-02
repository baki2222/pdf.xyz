import type { ProcessingMode } from "./types";

export interface ProcessingMeta {
  label: string;
  short: string;
  description: string;
  /** Tailwind classes for the chip. */
  tone: string;
}

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
    tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  server: {
    label: "Secure worker",
    short: "Secure worker",
    description:
      "Files are processed on an encrypted, isolated worker and permanently deleted shortly after.",
    tone: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  },
  hybrid: {
    label: "Browser-first",
    short: "Hybrid",
    description:
      "Runs in your browser when possible, with an encrypted server fallback for large or complex files.",
    tone: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  },
  ai: {
    label: "AI-assisted",
    short: "AI",
    description:
      "Uses an AI model on secure infrastructure. Your content is never used to train models.",
    tone: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  },
};

export function getProcessingMeta(mode: ProcessingMode): ProcessingMeta {
  return processingMeta[mode];
}
