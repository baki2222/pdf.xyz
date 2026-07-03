/**
 * The typed contract for the secure-worker **liveness heartbeat** (Phase 30).
 *
 * The worker daemon is deliberately out-of-band: the web app never becomes it, so
 * the web vantage historically could not observe whether a worker was actually
 * *running* (`daemonObserved` was always `false`). This seam closes that gap
 * **safely**: an out-of-band daemon periodically publishes a tiny, bounded,
 * content-free liveness record to a shared backend (the same Redis/Upstash broker
 * the job queue uses, when configured), and the web app reads the latest record to
 * classify liveness as observed / stale / unknown — without ever pretending a
 * worker is alive when there is no recent evidence.
 *
 * Honesty & privacy posture (identical to every other worker seam):
 *  - **Bounded by construction.** Every published field is a fixed enum, a small
 *    boolean set, a schema version, a coarse `major.minor` release, or a single
 *    publish timestamp used only to derive a coarse age bucket. There is nowhere to
 *    put — and the parser drops anything that is not — a hostname, process id,
 *    container id, IP, port, path, Redis key, object key, endpoint, secret, or any
 *    high-cardinality value. No worker id is published by default.
 *  - **No fake liveness.** A record older than the freshness window is `stale`, and
 *    a missing record (the broker's TTL swept it, or none was ever published) is
 *    `unknown` — never silently upgraded to observed. A dead daemon cannot refresh
 *    its own timestamp, and the broker key expires, so liveness can never outlive
 *    the worker by more than one freshness window.
 *  - **Disabled stays honest.** With no compatible backend, or with the feature not
 *    explicitly enabled, publication and reads are disabled no-ops; the web vantage
 *    keeps its pre-existing "confirm a worker out-of-band" honesty rather than
 *    implying a worker is down.
 *
 * Node-free: the record schema, the classification, and the Redis-backed provider
 * all build on the node-free `RedisClient` (a `fetch` transport) and the node-free
 * queue config, so this whole module is safe to import from the `/api/worker/*`
 * routes and is reused verbatim by the Node-only daemon CLI.
 */

/** The bump-on-change schema version, so a heartbeat consumer can evolve safely. */
export const WORKER_HEARTBEAT_SCHEMA_VERSION = 1 as const;

/** The one worker role that publishes liveness today. A fixed enum, never an id. */
export type HeartbeatRole = "secure-worker";

/** The single role constant. */
export const HEARTBEAT_ROLE: HeartbeatRole = "secure-worker";

/**
 * The coarse mode the worker was in when it last beat — a small fixed enum, so the
 * dashboard can say "a worker is draining" vs "a worker reported readiness" without
 * any high-cardinality detail. `starting` covers the very first beat before a mode
 * is known.
 */
export type HeartbeatMode =
  | "starting"
  | "loop"
  | "drain"
  | "once"
  | "check"
  | "dry-run";

/**
 * A coarse, fixed age ladder for the last-seen heartbeat — never a raw millisecond
 * value or wall-clock timestamp, so nothing high-cardinality is surfaced. The
 * boundaries are deliberately generous and independent of the configured interval.
 */
export type HeartbeatAgeBucket =
  | "under-30s"
  | "under-2m"
  | "under-10m"
  | "over-10m";

/**
 * Where a liveness signal came from — a safe *category*, never an endpoint, key, or
 * broker name. `queue-broker` = read from the shared job-queue broker; `self` = the
 * worker observing its own in-process liveness; `none` = no backend / disabled.
 */
export type HeartbeatSource = "queue-broker" | "self" | "none";

/**
 * The read-side liveness classification a dashboard/alert cares about:
 *  - `observed` — a heartbeat published within the freshness window is visible;
 *  - `stale`    — a heartbeat is present but older than the freshness window (the
 *                 worker may have stopped or lost connectivity);
 *  - `unknown`  — no heartbeat is visible (the broker TTL swept it, none was ever
 *                 published, or the broker was unreachable) though observation IS
 *                 enabled — a meaningful "should be beating but isn't";
 *  - `disabled` — cross-process liveness observation is not enabled/configured here,
 *                 so absence says nothing (the honest, neutral default).
 */
export type DaemonLivenessState = "observed" | "stale" | "unknown" | "disabled";

/** The presence-only capability summary a worker publishes. Booleans only. */
export interface HeartbeatCapabilities {
  /** Deep image compression — a native engine is installed on the worker. */
  readonly deepCompression: boolean;
  /** OCR — a real engine + runner are wired on the worker. */
  readonly ocr: boolean;
  /** A malware scanner is actively inspecting bytes (not the honest no-op). */
  readonly malwareScan: boolean;
  /** The configured queue guarantees atomic, race-safe state transitions. */
  readonly atomicQueue: boolean;
}

/**
 * The bounded, content-free heartbeat record a worker publishes. Every field is a
 * schema version, a fixed enum, a coarse release, a small boolean set, or the
 * publish timestamp (used only to derive a coarse age — never surfaced raw).
 */
export interface WorkerHeartbeat {
  readonly v: typeof WORKER_HEARTBEAT_SCHEMA_VERSION;
  readonly role: HeartbeatRole;
  /** Coarse `major.minor` release only (never a full build id); omitted if unknown. */
  readonly release?: string;
  readonly mode: HeartbeatMode;
  readonly capabilities: HeartbeatCapabilities;
  /**
   * The publish wall-clock time in ms. Used ONLY to derive a coarse age bucket and
   * the fresh/stale line on the read side; it is never surfaced raw to a client.
   */
  readonly at: number;
}

/**
 * The classified liveness a reader returns — the content-free projection the
 * operations snapshot folds in. Bounded enums, one coarse bucket, and a
 * client-safe detail (the UI re-authors all copy regardless).
 */
export interface HeartbeatLiveness {
  readonly state: DaemonLivenessState;
  /** Convenience: `true` iff `state === "observed"`. */
  readonly observed: boolean;
  readonly source: HeartbeatSource;
  /** Coarse age of the last heartbeat, or `null` when none is visible. */
  readonly lastSeen: HeartbeatAgeBucket | null;
  /** The coarse mode from the last heartbeat, or `null` when none is visible. */
  readonly mode: HeartbeatMode | null;
  /** The capability summary from the last heartbeat, or `null` when none is visible. */
  readonly capabilities: HeartbeatCapabilities | null;
  /** One-line, content-free explanation. Never names an endpoint, key, or value. */
  readonly detail: string;
}

/**
 * The honest, presence-only capability of the heartbeat seam in this environment —
 * the heartbeat analogue of {@link QueueCapability}. Content-free: it carries the
 * bounded timing windows and the source *category*, never an endpoint, token, key
 * prefix, or variable name.
 */
export interface HeartbeatCapability {
  /** True only when the feature is explicitly enabled AND a compatible backend is present. */
  readonly enabled: boolean;
  /** The source category a read/publish would use. */
  readonly source: HeartbeatSource;
  readonly role: HeartbeatRole;
  /** How often the daemon beats (seconds). */
  readonly intervalSeconds: number;
  /** Age (seconds) under which a heartbeat is still "observed"; beyond it, "stale". */
  readonly freshWindowSeconds: number;
  /** TTL (seconds) applied to the broker key; after it, the record vanishes → "unknown". */
  readonly ttlSeconds: number;
  /** One-line, content-free explanation. */
  readonly detail: string;
}

/** Why a publish attempt did (or did not) happen. Content-free. */
export type HeartbeatPublishReason =
  | "published" // a fresh heartbeat was written
  | "throttled" // within the interval since the last write; skipped (a no-op)
  | "disabled" // the feature is not enabled / no backend configured
  | "unavailable"; // the backend errored or was unreachable (swallowed, never thrown)

/** The outcome of a publish attempt. Never throws; failures are typed. */
export interface HeartbeatPublishResult {
  readonly published: boolean;
  readonly reason: HeartbeatPublishReason;
}

/** Publishes bounded liveness. Self-throttling and self-guarding; `beat` never throws. */
export interface HeartbeatPublisher {
  readonly capability: HeartbeatCapability;
  /** Publish a heartbeat now, or skip if throttled/disabled. Never throws. */
  beat(): Promise<HeartbeatPublishResult>;
}

/** Reads the latest liveness. `read` never throws; a failure classifies as `unknown`. */
export interface HeartbeatReader {
  readonly capability: HeartbeatCapability;
  /** Read + classify the latest heartbeat. Never throws. */
  read(): Promise<HeartbeatLiveness>;
}
