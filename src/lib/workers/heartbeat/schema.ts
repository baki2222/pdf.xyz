/**
 * Pure, node-free schema + classification for the worker liveness heartbeat.
 *
 * This is the load-bearing privacy choke point of the heartbeat seam. Two halves:
 *
 *  1. **Publish side** — {@link buildHeartbeat}/{@link serializeHeartbeat} assemble
 *     ONLY the bounded fields of a {@link WorkerHeartbeat} (schema version, fixed
 *     role/mode enums, a coarsened `major.minor` release, four capability booleans,
 *     and a publish timestamp). Nothing a caller passes can smuggle a host, path,
 *     key, or value into the stored record.
 *
 *  2. **Read side** — {@link parseHeartbeat} defensively reconstructs a record from
 *     whatever the broker returns, copying only known fields and rejecting anything
 *     that fails the bounded schema (so an injected/hostile value has nowhere to
 *     land), and {@link classifyLiveness} turns a record + a clock into the
 *     observed/stale/unknown verdict using the freshness window. A dead worker
 *     cannot refresh its own `at`, so liveness can never be observed beyond one
 *     freshness window after the last real beat.
 *
 * Everything here is deterministic and takes its clock/thresholds as inputs, so the
 * whole classification is unit-tested with no real Redis, network, or timers.
 */

import { FINGERPRINT_PATTERN } from "../build-fingerprint";
import { OCR_LANGUAGE_CODES } from "@/lib/jobs/ocr";
import {
  WORKER_HEARTBEAT_SCHEMA_VERSION,
  HEARTBEAT_ROLE,
  type DaemonLivenessState,
  type HeartbeatAgeBucket,
  type HeartbeatCapabilities,
  type HeartbeatLiveness,
  type HeartbeatMode,
  type HeartbeatSource,
  type WorkerHeartbeat,
} from "./types";

/** Default publish cadence (seconds) — brisk enough to spot a stop within ~1 min. */
export const HEARTBEAT_DEFAULT_INTERVAL_SECONDS = 15;
/** Lower bound on the cadence (seconds) — no tighter, to bound broker write load. */
export const HEARTBEAT_MIN_INTERVAL_SECONDS = 5;
/** Upper bound on the cadence (seconds). */
export const HEARTBEAT_MAX_INTERVAL_SECONDS = 300;

/**
 * A heartbeat is "observed" while its age is within `interval × FRESH_MULTIPLE`,
 * tolerating a couple of missed beats before it reads as `stale`.
 */
export const HEARTBEAT_FRESH_MULTIPLE = 3;
/**
 * The broker key's TTL is `interval × TTL_MULTIPLE`. It MUST exceed the fresh
 * window so there is a real "present-but-stale" band before the key is swept and
 * liveness becomes `unknown`.
 */
export const HEARTBEAT_TTL_MULTIPLE = 8;

/** The fixed set of publishable modes, for defensive parsing. */
const HEARTBEAT_MODES: readonly HeartbeatMode[] = [
  "starting",
  "loop",
  "drain",
  "once",
  "check",
  "dry-run",
];

/** The age-bucket boundaries (ms), in ascending order. */
const AGE_BUCKET_BOUNDS: readonly [number, HeartbeatAgeBucket][] = [
  [30_000, "under-30s"],
  [120_000, "under-2m"],
  [600_000, "under-10m"],
];

/** The freshness window (ms) for a given interval. */
export function freshWindowMsFor(intervalSeconds: number): number {
  return intervalSeconds * HEARTBEAT_FRESH_MULTIPLE * 1000;
}

/** The broker-key TTL (seconds) for a given interval. */
export function ttlSecondsFor(intervalSeconds: number): number {
  return intervalSeconds * HEARTBEAT_TTL_MULTIPLE;
}

/**
 * Coarsen a raw version to `major.minor` (e.g. `1.2.3-rc.1` → `1.2`), dropping
 * anything that is not a plausible low-cardinality version. Returns `undefined`
 * when the input is absent or unparseable, so the record simply omits `release`
 * rather than carrying a high-cardinality build id.
 */
export function coarseRelease(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = /^\s*v?(\d{1,4})\.(\d{1,4})(?:\D|$)/.exec(raw);
  return match ? `${match[1]}.${match[2]}` : undefined;
}

/**
 * Normalize a build fingerprint, or drop it.
 *
 * Bounded BY SHAPE, not by trimming: exactly twelve lowercase hex or nothing.
 * The field is the one high-cardinality value in this record, so the parser is
 * what keeps it from becoming somewhere to put a hostname.
 */
function fingerprintOf(value: unknown): string | undefined {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value)
    ? value
    : undefined;
}

/** Normalize a value to a strict boolean (only literal `true` is true). */
function boolOf(value: unknown): boolean {
  return value === true;
}

/**
 * Normalize an arbitrary value to the bounded set of advertised OCR language codes.
 *
 * A trust boundary, read defensively like every other field here: anything that is
 * not a string from `OCR_LANGUAGE_CODES` is dropped, so a corrupted, hostile, or
 * simply newer record can never widen the vocabulary. Emitting in menu order also
 * caps the length at 21 and makes the value stable regardless of the order the
 * worker probed its tessdata directories in.
 */
function ocrLanguagesOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const present = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string") present.add(entry);
  }
  return OCR_LANGUAGE_CODES.filter((code) => present.has(code));
}

/** Normalize an arbitrary capabilities shape to the bounded capability summary. */
function capabilitiesOf(value: unknown): HeartbeatCapabilities {
  const src =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    deepCompression: boolOf(src.deepCompression),
    ocr: boolOf(src.ocr),
    ocrLanguages: ocrLanguagesOf(src.ocrLanguages),
    malwareScan: boolOf(src.malwareScan),
    atomicQueue: boolOf(src.atomicQueue),
    // ABSENT PARSES AS FALSE, and that is the load-bearing case rather than a
    // defensive nicety: a worker image built before these capabilities existed
    // publishes no such key, and reading that absence as `false` is what makes
    // "the running image cannot do this" observable without the old image
    // knowing anything about the question.
    chunkedTranslate: boolOf(src.chunkedTranslate),
    deliveryCap: boolOf(src.deliveryCap),
  };
}

/** The fields a caller supplies to build a heartbeat; everything else is fixed. */
export interface BuildHeartbeatInput {
  readonly mode: HeartbeatMode;
  readonly capabilities: HeartbeatCapabilities;
  /** Raw release; coarsened to `major.minor` (or dropped) before storage. */
  readonly release?: string;
  /** The image's source fingerprint; dropped unless it is exactly 12 hex. */
  readonly fingerprint?: string;
  /** Publish wall-clock time (ms). */
  readonly at: number;
}

/**
 * Assemble a bounded {@link WorkerHeartbeat}. It copies ONLY the schema fields —
 * the fixed version/role, the mode enum, the four capability booleans, the
 * coarsened release, and the timestamp — so a caller can never widen the record.
 */
export function buildHeartbeat(input: BuildHeartbeatInput): WorkerHeartbeat {
  const release = coarseRelease(input.release);
  const fingerprint = fingerprintOf(input.fingerprint);
  return {
    v: WORKER_HEARTBEAT_SCHEMA_VERSION,
    role: HEARTBEAT_ROLE,
    ...(release ? { release } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    mode: input.mode,
    capabilities: capabilitiesOf(input.capabilities),
    at: input.at,
  };
}

/** Serialize a heartbeat for the broker. Only the bounded schema fields are emitted. */
export function serializeHeartbeat(hb: WorkerHeartbeat): string {
  return JSON.stringify({
    v: hb.v,
    role: hb.role,
    ...(hb.release ? { release: hb.release } : {}),
    ...(hb.fingerprint ? { fingerprint: hb.fingerprint } : {}),
    mode: hb.mode,
    capabilities: {
      deepCompression: hb.capabilities.deepCompression,
      ocr: hb.capabilities.ocr,
      ocrLanguages: [...hb.capabilities.ocrLanguages],
      malwareScan: hb.capabilities.malwareScan,
      atomicQueue: hb.capabilities.atomicQueue,
      chunkedTranslate: hb.capabilities.chunkedTranslate,
      deliveryCap: hb.capabilities.deliveryCap,
    },
    at: hb.at,
  });
}

/**
 * Defensively parse a stored heartbeat. Accepts a JSON string or an already-parsed
 * object and reconstructs a record from KNOWN fields only, rejecting to `null` when
 * a load-bearing field fails the bounded schema (wrong version, unknown role/mode,
 * non-finite timestamp). Unknown/extra fields are ignored, and `release` is
 * re-coarsened — so no injected value can survive into the returned record.
 */
export function parseHeartbeat(raw: unknown): WorkerHeartbeat | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const src = value as Record<string, unknown>;

  if (src.v !== WORKER_HEARTBEAT_SCHEMA_VERSION) return null;
  if (src.role !== HEARTBEAT_ROLE) return null;
  if (
    typeof src.mode !== "string" ||
    !HEARTBEAT_MODES.includes(src.mode as HeartbeatMode)
  ) {
    return null;
  }
  if (typeof src.at !== "number" || !Number.isFinite(src.at)) return null;

  const release = coarseRelease(
    typeof src.release === "string" ? src.release : undefined,
  );
  const fingerprint = fingerprintOf(src.fingerprint);
  return {
    v: WORKER_HEARTBEAT_SCHEMA_VERSION,
    role: HEARTBEAT_ROLE,
    ...(release ? { release } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    mode: src.mode as HeartbeatMode,
    capabilities: capabilitiesOf(src.capabilities),
    at: src.at,
  };
}

/** Map a non-negative age (ms) to its coarse bucket. */
export function ageBucket(ageMs: number): HeartbeatAgeBucket {
  for (const [bound, bucket] of AGE_BUCKET_BOUNDS) {
    if (ageMs < bound) return bucket;
  }
  return "over-10m";
}

/** Content-free copy for each classified state (the UI re-authors regardless). */
const LIVENESS_DETAIL: Record<DaemonLivenessState, string> = {
  observed:
    "A worker daemon published a liveness heartbeat within the freshness window, so a worker is observably running and draining.",
  stale:
    "A worker heartbeat is present but older than the freshness window; the worker may have stopped or lost connectivity. Confirm it out-of-band.",
  unknown:
    "Liveness observation is enabled, but no recent heartbeat is visible (it expired or none was published). A worker may not be deployed or beating.",
  disabled:
    "Cross-process worker liveness observation is not enabled here, so the absence of a heartbeat says nothing. Confirm a worker out-of-band.",
};

/** Build a `disabled` liveness (the honest, neutral default). */
export function disabledLiveness(
  source: HeartbeatSource = "none",
): HeartbeatLiveness {
  return {
    state: "disabled",
    observed: false,
    source,
    lastSeen: null,
    mode: null,
    capabilities: null,
    fingerprint: null,
    detail: LIVENESS_DETAIL.disabled,
  };
}

/** Inputs to {@link classifyLiveness}. */
export interface ClassifyLivenessOptions {
  /** The reader's clock (ms). Injected for deterministic tests. */
  readonly now: number;
  /** The freshness window (ms) beyond which a present record is `stale`. */
  readonly freshWindowMs: number;
  /** The source category to report. */
  readonly source: HeartbeatSource;
}

/**
 * Classify a (possibly missing) heartbeat into observed / stale / unknown. A `null`
 * record is `unknown` (swept by TTL, never published, or the broker was
 * unreachable). A present record is `observed` while its age is within the
 * freshness window and `stale` beyond it. The age is clamped to `≥ 0`, so a reader
 * clock that lags the writer can only ever be conservative (never over-claims).
 * This never produces `disabled`; a disabled reader returns {@link disabledLiveness}.
 */
export function classifyLiveness(
  record: WorkerHeartbeat | null,
  opts: ClassifyLivenessOptions,
): HeartbeatLiveness {
  if (record === null) {
    return {
      state: "unknown",
      observed: false,
      source: opts.source,
      lastSeen: null,
      mode: null,
      capabilities: null,
      fingerprint: null,
      detail: LIVENESS_DETAIL.unknown,
    };
  }
  const ageMs = Math.max(0, opts.now - record.at);
  const state: DaemonLivenessState =
    ageMs <= opts.freshWindowMs ? "observed" : "stale";
  return {
    state,
    observed: state === "observed",
    source: opts.source,
    lastSeen: ageBucket(ageMs),
    mode: record.mode,
    capabilities: record.capabilities,
    fingerprint: record.fingerprint ?? null,
    detail: LIVENESS_DETAIL[state],
  };
}
