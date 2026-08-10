/**
 * The **ClamAV/clamd malware scanner** — a real {@link MalwareScanner} that streams
 * a job's input bytes to a `clamd` daemon over its INSTREAM protocol and turns the
 * daemon's reply into a content-free verdict.
 *
 * It is deliberately node-free: the socket lives behind an injected
 * {@link ClamavTransport}, so this whole module — request framing, timeout/size
 * enforcement, verdict mapping, and multi-input aggregation — is unit-tested with a
 * fake transport and NEVER touches a real daemon or the network in tests. The Node
 * socket transport that a deployed worker uses is `./clamav-transport` (imported
 * only by the Node runtime), and the wire framing/parsing is `./clamav-protocol`.
 *
 * Policy (why `required` lives here, not in the executor): the executor treats an
 * `error` verdict as a retryable failure and a `skipped` verdict as "proceed
 * unscanned". So required-ness is encoded at the scanner boundary — a REQUIRED
 * scanner that cannot reach a verdict returns `error`/`invalid` (fail/retry, never
 * bypass), while an OPTIONAL scanner degrades the same situation to `skipped`
 * (proceed, honestly not-scanned). An actual `infected` detection ALWAYS blocks,
 * required or not.
 *
 * Honesty & privacy: the daemon's reply is classified to a kind by
 * {@link parseInstreamReply} — the signature name is dropped at the protocol layer —
 * and every verdict `detail` here is a fixed, content-free sentence. No filename,
 * object key, endpoint, signature, byte, or secret is ever read or returned.
 */

import {
  scanClean,
  scanError,
  scanInfected,
  scanInvalid,
  type MalwareScanCapability,
  type MalwareScanInput,
  type MalwareScanner,
  type MalwareScanResult,
} from "./types";
import {
  buildInstreamRequest,
  isPong,
  parseInstreamReply,
  CLAMAV_DEFAULT_CHUNK_SIZE,
  CLAMAV_PING_REQUEST,
} from "./clamav-protocol";

/**
 * The single connection primitive the scanner needs: write a framed request to a
 * fresh clamd connection and resolve the daemon's reply bytes (or reject on a
 * connection/timeout failure). One round-trip per connection mirrors clamd's
 * INSTREAM/PING model. Injected so the client is tested with no socket.
 */
export interface ClamavTransport {
  roundtrip(
    request: Uint8Array,
    opts: { readonly timeoutMs: number },
  ): Promise<Uint8Array>;
}

/** Why a transport round-trip failed — content-free, for typed handling only. */
export type ClamavTransportFailure =
  | "timeout" // the daemon did not reply within the deadline
  | "unreachable" // the connection was refused/reset/could not be established
  | "closed"; // the connection ended before a complete reply arrived

/**
 * A content-free transport error. Carries only a typed {@link ClamavTransportFailure}
 * reason — never a host, port, socket path, or the underlying error's message (which
 * can embed an address). The scanner maps it to `error`/`skipped` without inspection.
 */
export class ClamavTransportError extends Error {
  readonly reason: ClamavTransportFailure;
  constructor(reason: ClamavTransportFailure) {
    super(`clamav transport ${reason}`);
    this.name = "ClamavTransportError";
    this.reason = reason;
  }
}

/** The resolved knobs the scanner enforces on every scan. Content-free. */
export interface ClamavScannerConfig {
  /** Per-scan deadline (ms). A round-trip that overruns it is a retryable `error`. */
  readonly timeoutMs: number;
  /**
   * Hard client-side size ceiling (bytes). An input larger than this is never
   * streamed — it is a terminal `invalid` in EVERY mode, because clamd would
   * reject an over-limit stream anyway, retrying cannot shrink it, and (with
   * the default derived from the upload cap) it can only mean misconfiguration.
   */
  readonly maxBytes: number;
  /** INSTREAM frame size; defaults to {@link CLAMAV_DEFAULT_CHUNK_SIZE}. */
  readonly chunkSize?: number;
  /**
   * Whether scanning is REQUIRED at the deployment level. Since the 2026-08-10
   * ruling this flag no longer changes THIS scanner's fold — an active scanner
   * that cannot clear an input refuses (`invalid`/`error`) in both modes,
   * because "optional" means a scanner need not exist, never that an existing
   * one may be bypassed. The flag's remaining meaning lives in the ops
   * guardrail layer (`--check` refuses to run unscanned when required).
   */
  readonly required: boolean;
}

/** Dependencies for {@link createClamavScanner}: the injected transport + config. */
export interface ClamavScannerDeps {
  readonly transport: ClamavTransport;
  readonly config: ClamavScannerConfig;
}

const CAPABILITY: MalwareScanCapability = {
  active: true,
  provider: "clamav",
  detail:
    "A ClamAV/clamd malware scanner is configured; inputs are streamed to the daemon and scanned before processing.",
};

/** How a single input resolved, before the job-level verdict is aggregated. */
type PerInput = "clean" | "infected" | "oversize" | "error";

/**
 * Build a ClamAV scanner over an injected transport. `scan` streams each input to
 * clamd (INSTREAM) and aggregates a single job-level verdict; `capability` reports
 * the presence-only `clamav` capability. Deterministic given its transport.
 */
export function createClamavScanner(deps: ClamavScannerDeps): MalwareScanner {
  const { transport, config } = deps;
  const chunkSize = config.chunkSize ?? CLAMAV_DEFAULT_CHUNK_SIZE;

  async function scanOne(bytes: Uint8Array): Promise<PerInput> {
    if (bytes.length > config.maxBytes) return "oversize";
    let reply;
    try {
      const raw = await transport.roundtrip(
        buildInstreamRequest(bytes, chunkSize),
        {
          timeoutMs: config.timeoutMs,
        },
      );
      reply = parseInstreamReply(raw);
    } catch {
      // Any transport failure (timeout/unreachable/closed) — the error is
      // content-free by construction and is not inspected here.
      return "error";
    }
    switch (reply) {
      case "clean":
        return "clean";
      case "infected":
        return "infected";
      case "size-limit":
        return "oversize";
      case "error":
      case "unparseable":
        return "error";
    }
  }

  async function scan(input: MalwareScanInput): Promise<MalwareScanResult> {
    let sawOversize = false;
    let sawError = false;
    for (const file of input.inputs) {
      const outcome = await scanOne(file.bytes);
      // A real detection wins immediately: block regardless of required-ness and
      // regardless of any other input's outcome.
      if (outcome === "infected") return scanInfected();
      if (outcome === "oversize") sawOversize = true;
      else if (outcome === "error") sawError = true;
    }

    // No detection. If every input scanned cleanly, the job is clean.
    if (!sawOversize && !sawError) return scanClean();

    // Some input could not be cleared, and a scanner is ACTIVE. "Optional"
    // means a scanner is not required to EXIST — it must never mean an
    // existing scanner may be silently bypassed (owner ruling, 2026-08-10:
    // the old fold degraded oversize to `skipped` here, and a 26–100 MB
    // upload processed unscanned under copy that says every file is scanned
    // before any processor touches it). `skipped` is honest only when
    // nothing was there to do the scanning — the no-op scanner's verdict,
    // never this one's. So the fold is mode-independent: a transport failure
    // is retryable (`error` — a clamd outage queues work instead of
    // processing it unscanned), and an oversize input is terminal
    // (`invalid` — retrying cannot shrink it, and with the ceiling derived
    // from the upload cap it can only mean misconfiguration).
    if (sawError) return scanError();
    return scanInvalid();
  }

  return { scan, capability: () => CAPABILITY };
}

/**
 * Presence-only liveness probe: send `PING` and report whether clamd answered
 * `PONG`. Content-free (no version string, host, or port). Available to operator
 * tooling; the scan path does not depend on it. Returns `false` on any transport
 * failure rather than throwing.
 */
export async function pingClamav(
  transport: ClamavTransport,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const raw = await transport.roundtrip(CLAMAV_PING_REQUEST, { timeoutMs });
    return isPong(raw);
  } catch {
    return false;
  }
}
