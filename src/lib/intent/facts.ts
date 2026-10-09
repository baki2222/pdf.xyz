/**
 * A staged file's facts: what its name says at once, then what its first
 * bytes and — for a PDF — the probe say, measured one file at a time.
 *
 * WHICH EVIDENCE DECIDES WHAT. The name (then the declared type) decides
 * which tools take a file: it is what the hand-off gate, every tool's picker
 * and the upload route go by, so a suggestion that went by anything else
 * would offer a tool the file cannot reach. The bytes only take a file AWAY:
 * a "report.pdf" whose first bytes are a PNG opens nowhere under that name,
 * and is marked `contradicted` so the ranking can say why. The probe adds
 * what a PDF holds (pages, form fields, its lock, scanned pages).
 *
 * BOUNDED. At most `maxProbes` PDFs are probed (5 by default; the workspace
 * asks for more), none above the in-browser ceiling, sequentially — so one
 * dropped folder of PDFs cannot hold the tab. The probe itself is loaded on
 * first use, so a page that never measures a PDF never downloads it.
 *
 * Byte-free: facts hold names, sizes and findings, never contents.
 */
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import type { PdfProbe } from "@/lib/pdf/probe-result";
import { formatOf, type FileFormat } from "./formats";
import { formatFromBytes } from "./sniff";

/** What is known of a PDF's contents. */
export type PdfFacts =
  | { readonly state: "pending" }
  /**
   * Not probed: past the probe limit, over the in-browser ceiling, or the
   * bytes could not be read in this tab.
   */
  | {
      readonly state: "not-checked";
      readonly reason: "limit" | "too-large" | "unavailable";
    }
  | { readonly state: "checked"; readonly probe: PdfProbe };

export interface FileFacts {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  /** The type the browser declared; may be empty. */
  readonly type: string;
  /** What the name, then the declared type, says it is: what decides. */
  readonly format: FileFormat | null;
  /** What its first bytes say, once read (`undefined` until then). */
  readonly bytes: FileFormat | null | undefined;
  /** The bytes contradict the name: no tool opens it under that name. */
  readonly contradicted: boolean;
  /** For a file named as a PDF; null for anything else. */
  readonly pdf: PdfFacts | null;
}

/** How many leading bytes the format check reads. */
const HEAD_BYTES = 4096;
/** PDFs probed per measurement unless the caller asks otherwise. */
export const DEFAULT_MAX_PROBES = 5;

/** The facts a file's name and declared type give, with nothing read. */
export function quickFacts(
  file: { readonly name: string; readonly size: number; readonly type: string },
  id: string,
): FileFacts {
  const format = formatOf(file).format;
  return {
    id,
    name: file.name,
    size: file.size,
    type: file.type,
    format,
    bytes: undefined,
    contradicted: false,
    pdf: format === "PDF" ? { state: "pending" } : null,
  };
}

export interface MeasureOptions {
  /** PDFs to probe at most; the rest are reported as not checked. */
  readonly maxProbes?: number;
  /** Stop between steps once this aborts; nothing more is reported. */
  readonly signal?: AbortSignal;
}

/**
 * Read each file's first bytes, then probe its PDFs, in order, reporting each
 * file's new facts through `onUpdate` as they land. Resolves with the final
 * facts. Never throws: a file that cannot be read keeps what it had, and a
 * PDF that could not be probed says so.
 */
export async function measureFacts(
  facts: readonly FileFacts[],
  read: (id: string) => Blob | undefined,
  onUpdate: (next: FileFacts) => void,
  options: MeasureOptions = {},
): Promise<FileFacts[]> {
  const maxProbes = options.maxProbes ?? DEFAULT_MAX_PROBES;
  const stopped = () => options.signal?.aborted === true;
  const out: FileFacts[] = [];
  let probed = 0;

  for (const original of facts) {
    let current = original;
    const settle = (next: FileFacts) => {
      current = next;
      if (!stopped()) onUpdate(next);
    };
    if (stopped()) {
      out.push(current);
      continue;
    }
    const blob = read(current.id);
    if (blob) {
      try {
        const head = new Uint8Array(
          await blob.slice(0, HEAD_BYTES).arrayBuffer(),
        );
        const verdict = formatFromBytes(current, head);
        const contradicted = verdict.renamedFrom !== null;
        settle({
          ...current,
          bytes: verdict.format,
          contradicted,
          pdf: contradicted ? null : current.pdf,
        });
      } catch {
        // Unreadable now: the name's facts stand.
      }
    }

    if (current.pdf?.state === "pending" && !stopped()) {
      if (current.size > MAX_PDF_BYTES) {
        settle({
          ...current,
          pdf: { state: "not-checked", reason: "too-large" },
        });
      } else if (!blob) {
        settle({
          ...current,
          pdf: { state: "not-checked", reason: "unavailable" },
        });
      } else if (probed >= maxProbes) {
        settle({ ...current, pdf: { state: "not-checked", reason: "limit" } });
      } else {
        probed += 1;
        const probe = await probeBlob(blob);
        settle({
          ...current,
          pdf: probe
            ? { state: "checked", probe }
            : { state: "not-checked", reason: "unavailable" },
        });
      }
    }
    out.push(current);
  }
  return out;
}

async function probeBlob(blob: Blob): Promise<PdfProbe | null> {
  try {
    const [{ probePdf }, buffer] = await Promise.all([
      import("@/lib/pdf/probe"),
      blob.arrayBuffer(),
    ]);
    return await probePdf(new Uint8Array(buffer), { maxBytes: MAX_PDF_BYTES });
  } catch {
    return null;
  }
}
