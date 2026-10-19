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
  "starting" | "loop" | "drain" | "once" | "check" | "dry-run";

/**
 * A coarse, fixed age ladder for the last-seen heartbeat — never a raw millisecond
 * value or wall-clock timestamp, so nothing high-cardinality is surfaced. The
 * boundaries are deliberately generous and independent of the configured interval.
 */
export type HeartbeatAgeBucket =
  "under-30s" | "under-2m" | "under-10m" | "over-10m";

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

/**
 * The presence-only capability summary a worker publishes. Bounded enums only —
 * booleans, plus one fixed-vocabulary language list.
 */
export interface HeartbeatCapabilities {
  /** Deep image compression — a native engine is installed on the worker. */
  readonly deepCompression: boolean;
  /** OCR — a real engine + runner are wired on the worker. */
  readonly ocr: boolean;
  /**
   * The recognition languages this worker can ACTUALLY run — the `traineddata`
   * packs observed in its image, narrowed to the codes the product advertises.
   *
   * `ocr: true` says an engine exists; it says nothing about which languages that
   * engine has data for, and those are different failures. Without this the web
   * tier could only echo the advertised list back, so the status endpoint reported
   * every language the catalogue names while conceding, in its own detail string,
   * that the packs "are not observable from here". A user could pick a language the
   * running image had never installed and only find out after uploading.
   *
   * Content-free by construction: the values come from a fixed 21-code vocabulary
   * (`OCR_LANGUAGE_CODES`), never from a path, a filename, or a document.
   */
  readonly ocrLanguages: readonly string[];
  /** A malware scanner is actively inspecting bytes (not the honest no-op). */
  readonly malwareScan: boolean;
  /** The configured queue guarantees atomic, race-safe state transitions. */
  readonly atomicQueue: boolean;
  /**
   * This image can SPLIT a document too long for one provider call into
   * several — the thing the FAQ promises in the words "a longer document is
   * not refused".
   *
   * PROVEN AT START-UP by running the real planner, never declared. A boolean
   * written in `main` would have read `true` for the nine days the running
   * image had no chunking in it at all, which is exactly the period this field
   * exists to have made visible.
   *
   * An image built before the feature does not publish this key, and
   * `boolOf(undefined)` is `false` — so the old image does not have to
   * cooperate. It could not: it was built before anyone thought to ask.
   */
  readonly chunkedTranslate: boolean;
  /**
   * This image enforces the per-job delivery bound and names the bound that
   * stopped it.
   *
   * Separate from {@link chunkedTranslate} because they fail differently and
   * cost differently: without splitting a long document is refused, which is
   * visible and annoying; without the cap the character reservation is
   * decorative and a caller can declare one character and be handed a whole
   * translation, which is invisible and expensive.
   */
  readonly deliveryCap: boolean;
  /**
   * Every `per-call` AI processor in this image (summarize, chat, extract)
   * reads no more of a document than the cap it is handed, and sends the
   * provider nothing beyond that document, the job's options and
   * `AI_PER_CALL_INSTRUCTION_CHARACTERS` of its own: the three things the
   * route charges. The cap bounds the document ONLY; the options are bounded
   * by the route's byte cap and charged by the server's own measure.
   *
   * Separate from {@link deliveryCap} because that one was proved on translate
   * alone, by images that ignored the cap on the other three tools — so an old
   * image publishes `deliveryCap: true` and could not be told apart. This key
   * did not exist before those processors honoured the cap, so an image built
   * earlier publishes nothing and parses as `false`.
   *
   * It is not only reported: `POST /api/jobs` honours a declared character
   * count for those tools only while this reads `true` on a fresh heartbeat.
   */
  readonly aiReadCap: boolean;
  /**
   * This image's PDF to PowerPoint engine writes a package whose slide master
   * → layout → theme chain is present and resolves, one slide per page.
   *
   * PROVEN AT START-UP by running the real engine and inspecting its output
   * (`pdf-office-export/capability.ts`). Until 2026-09-27 the engine wrote
   * slides with no master, layout or theme, and PowerPoint for Windows refused
   * every file as corrupted while the catalogue promised editable slides. The
   * fix reaches users only in an image built after it, and this field is how
   * the web tier can tell. It does not claim PowerPoint opens the file — no
   * PowerPoint runs on the worker — only that this image's engine writes decks
   * that pass the inspection the engine measured opening on Windows passed
   * (last measured 2026-10-09; see `pdf-office-export/capability.ts`).
   */
  readonly pptxPresentationChain: boolean;
  /**
   * This image's PDF to PowerPoint engine puts a page's picture on its slide
   * AS a picture, where the page paints it, at its pixel size.
   *
   * PROVEN AT START-UP by running the real engine over a generated PDF whose
   * first page paints one picture at a known box, and finding a `p:pic` at
   * that box whose image is that picture (`pdf-office-export/capability.ts`,
   * `provesPptxPictures`). The owner reported on 2026-10-10 that production's
   * decks had no pictures at all: the engine wrote one text box per slide.
   * The engine that keeps them reaches users only in an image built after it,
   * and copy that says pictures are kept is true of a download only while
   * this reads `true`. An image built before this key publishes nothing, and
   * the absence parses as `false`.
   */
  readonly pptxPictures: boolean;
  /**
   * This image's PDF to Word engine puts a page's picture in the .docx AS a
   * picture, between the line above it and the line below it, at the size
   * the page shows it.
   *
   * PROVEN AT START-UP by running the real engine on the deps the image's
   * jobs run on (its own text extractor, page reader and limits:
   * `pdfOfficeExportDeps(env)`) over a generated PDF with a picture between
   * two lines, and reading the .docx back (`pdf-office-export/capability.ts`,
   * `provesDocxPictures`). On 2026-10-17 production returned the owner's
   * 33-page tutorial as a .docx with none of its 37 pictures. The engine that
   * keeps them reaches users only in an image built after it, and copy that
   * says pictures are kept is true of a download only while this reads
   * `true`. An image built before this key publishes nothing, and the absence
   * parses as `false`.
   */
  readonly docxPictures: boolean;
}

/**
 * The bounded, content-free heartbeat record a worker publishes. Every field is a
 * schema version, a fixed enum, a coarse release, a small boolean set, or the
 * publish timestamp (used only to derive a coarse age — never surfaced raw).
 */
export interface WorkerHeartbeat {
  readonly v: typeof WORKER_HEARTBEAT_SCHEMA_VERSION;
  readonly role: HeartbeatRole;
  /**
   * Coarse `major.minor` release only (never a full build id); omitted if unknown.
   *
   * ⚠️ AND IT HAS NEVER MOVED. It is `coarseRelease(npm_package_version)`, and
   * `package.json` has been `0.1.0` since the beginning — so every worker image
   * ever built has published `"0.1"`, including the 2026-08-12 one that could
   * not chunk and the one that replaced it. It LOOKS like a build identity and
   * is a constant. See {@link fingerprint} for the field that actually
   * distinguishes builds.
   */
  readonly release?: string;
  /**
   * Twelve hex characters identifying the SOURCE this image carries.
   *
   * Diagnostic, deliberately not an alarm — see `../build-fingerprint`. It
   * turns "which build is running?" from an ssh session and a grep inside the
   * container into a value on the posture endpoint, which is the question you
   * ask once the capability probes have already fired.
   *
   * ON THE PRIVACY POSTURE, because this module's header says there is nowhere
   * to put a high-cardinality value and this is one. It is a hash of source
   * code that is not secret, computed from files the image ships; it names no
   * host, container, path, key or endpoint, and reveals nothing an attacker
   * could not get by reading the product. It is bounded by shape — exactly
   * twelve lowercase hex, enforced by the parser — so there is nowhere to smuggle
   * anything else through it.
   *
   * Omitted by any image built before this field existed, which reads as "did
   * not say" rather than as a mismatch.
   */
  readonly fingerprint?: string;
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
  /**
   * The source fingerprint from the last heartbeat, or `null`.
   *
   * `null` covers both "no beat visible" and "the beat carried none" — an image
   * built before the field existed. Diagnostic only; nothing classifies on it.
   */
  readonly fingerprint: string | null;
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
