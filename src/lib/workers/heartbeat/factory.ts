/**
 * The environment-driven selector for the worker liveness **heartbeat** — the
 * counterpart of the queue's `createQueueProvider`.
 *
 * The feature is doubly gated, both for honesty and for safety:
 *  1. it must be **explicitly enabled** (`PDFXYZ_WORKER_HEARTBEAT` truthy), and
 *  2. a **compatible backend** must be configured (the same Redis/Upstash broker the
 *     job queue uses — `parseRedisQueueConfig` must succeed).
 *
 * Only when BOTH hold does this return a real Redis-backed publisher/reader; in
 * every other case it returns a disabled no-op. That gate is what keeps the web
 * vantage honest: with the feature off, an absent heartbeat means "observation not
 * enabled" (neutral), not "the worker is down". With it on, an absent heartbeat is a
 * meaningful `unknown`. The read side never touches the network when disabled, so
 * the no-config path stays offline and deterministic.
 *
 * Safe from a SERVER route — `readWorkerHeartbeatLiveness` is called by
 * `/api/worker/operations`, and `createHeartbeatPublisher` by the Node-only
 * daemon CLI — but NOT from a client bundle. This docblock used to say
 * "Node-free", and had been wrong ever since `./schema` started importing
 * `FINGERPRINT_PATTERN`: that edge reaches `../build-fingerprint`, which reads
 * `node:crypto`, `node:fs` and `node:path`. A `"use client"` module that imports
 * anything from here fails the webpack build with `UnhandledSchemeError`.
 *
 * The one thing a client tier legitimately wants from this seam is the
 * capability enumeration, so that lives in the leaf `./capabilities` and is
 * merely re-exported below.
 */

import type { FieldError } from "@/lib/jobs";
import {
  parseRedisQueueConfig,
  type RedisQueueConfig,
} from "../queue/redis-config";
import {
  HEARTBEAT_DEFAULT_INTERVAL_SECONDS,
  HEARTBEAT_MAX_INTERVAL_SECONDS,
  HEARTBEAT_MIN_INTERVAL_SECONDS,
  disabledLiveness,
  freshWindowMsFor,
  ttlSecondsFor,
} from "./schema";
import {
  createRedisHeartbeatPublisher,
  createRedisHeartbeatReader,
  type HeartbeatPublishSpec,
  type HeartbeatRedisDeps,
} from "./redis";
import { emptyCapabilities } from "./capabilities";
import { HEARTBEAT_ROLE } from "./types";
import type {
  HeartbeatCapability,
  HeartbeatLiveness,
  HeartbeatPublisher,
  HeartbeatReader,
  HeartbeatSource,
} from "./types";

/**
 * Re-exported, not defined here. It lives in the leaf `./capabilities` because
 * this module is NOT node-free — it reaches `node:crypto`/`node:fs`/`node:path`
 * through `./schema` → `../build-fingerprint` — and the operations dashboard
 * derives its capability corpus from this enumeration from inside a
 * `"use client"` bundle. See that file's header for the import chain that broke
 * the client build.
 */
export { emptyCapabilities };

type EnvSource = Record<string, string | undefined>;

/** The environment variables this seam reads (names only; never values). */
export const WORKER_HEARTBEAT_ENV = {
  /** Truthy ⇒ publish + read cross-process liveness (when a backend is configured). */
  enabled: "PDFXYZ_WORKER_HEARTBEAT",
  /** Optional publish cadence in seconds (bounded); unset ⇒ the default. */
  intervalSeconds: "PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS",
} as const;

/** Values of {@link WORKER_HEARTBEAT_ENV.enabled} that turn the feature on. */
const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);

/** Trimmed value, or `undefined` when absent/blank. */
function read(env: EnvSource, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when the heartbeat feature is explicitly enabled in this environment. */
export function isHeartbeatEnabled(env: EnvSource = process.env): boolean {
  const value = read(env, WORKER_HEARTBEAT_ENV.enabled)?.toLowerCase();
  return value !== undefined && TRUTHY.has(value);
}

/**
 * Parse the bounded publish cadence (seconds). An unset or malformed value falls
 * back to the default — a bad interval must never disable liveness or crash a run.
 * A malformed value is reported (by NAME only) for server-side diagnostics.
 */
export function resolveHeartbeatIntervalSeconds(env: EnvSource = process.env): {
  intervalSeconds: number;
  issue?: FieldError;
} {
  const raw = read(env, WORKER_HEARTBEAT_ENV.intervalSeconds);
  if (raw === undefined)
    return { intervalSeconds: HEARTBEAT_DEFAULT_INTERVAL_SECONDS };
  if (/^\d{1,7}$/.test(raw)) {
    const n = Number(raw);
    if (
      Number.isInteger(n) &&
      n >= HEARTBEAT_MIN_INTERVAL_SECONDS &&
      n <= HEARTBEAT_MAX_INTERVAL_SECONDS
    ) {
      return { intervalSeconds: n };
    }
  }
  return {
    intervalSeconds: HEARTBEAT_DEFAULT_INTERVAL_SECONDS,
    issue: {
      field: WORKER_HEARTBEAT_ENV.intervalSeconds,
      message: `Integer seconds ${HEARTBEAT_MIN_INTERVAL_SECONDS}–${HEARTBEAT_MAX_INTERVAL_SECONDS}; using the default.`,
    },
  };
}

/** The resolved heartbeat wiring for this environment. */
export interface ResolvedHeartbeat {
  /** True only when enabled AND a compatible backend is configured. */
  readonly enabled: boolean;
  readonly source: HeartbeatSource;
  readonly intervalSeconds: number;
  /** The validated broker config, or `null` when not configured. */
  readonly redis: RedisQueueConfig | null;
}

/** Resolve whether/how liveness is wired here. Presence + shape only; no network. */
export function resolveHeartbeat(
  env: EnvSource = process.env,
): ResolvedHeartbeat {
  const { intervalSeconds } = resolveHeartbeatIntervalSeconds(env);
  const enabledFlag = isHeartbeatEnabled(env);
  const parsed = parseRedisQueueConfig(env);
  const redis = parsed.ok ? parsed.config : null;
  const enabled = enabledFlag && redis !== null;
  return {
    enabled,
    source: enabled ? "queue-broker" : "none",
    intervalSeconds,
    redis,
  };
}

/** The content-free capability of a disabled heartbeat seam. */
function disabledCapability(
  intervalSeconds: number,
  enabledFlag: boolean,
): HeartbeatCapability {
  return {
    enabled: false,
    source: "none",
    role: HEARTBEAT_ROLE,
    intervalSeconds,
    freshWindowSeconds: freshWindowMsFor(intervalSeconds) / 1000,
    ttlSeconds: ttlSecondsFor(intervalSeconds),
    detail: enabledFlag
      ? "Worker liveness heartbeats are enabled but no compatible backend (a configured job-queue broker) is present, so nothing is published or observed."
      : "Worker liveness heartbeats are not enabled here, so nothing is published or observed; confirm a worker out-of-band.",
  };
}

/** Options for {@link createHeartbeatPublisher}. */
export interface HeartbeatPublisherOptions extends HeartbeatPublishSpec {
  /** Injectable Redis seams (client/fetch/clock) for deterministic tests. */
  readonly deps?: HeartbeatRedisDeps;
}

/**
 * Build the active heartbeat publisher from the environment. Returns a real
 * Redis-backed publisher only when the feature is enabled AND a broker is
 * configured; otherwise a disabled no-op whose `beat()` reports `disabled` without
 * any network call.
 */
export function createHeartbeatPublisher(
  env: EnvSource = process.env,
  opts: HeartbeatPublisherOptions = {
    mode: "starting",
    capabilities: emptyCapabilities(),
  },
): HeartbeatPublisher {
  const resolved = resolveHeartbeat(env);
  if (resolved.enabled && resolved.redis) {
    /**
     * FORWARD THE SPEC, do not rebuild it.
     *
     * This function used to name `mode`, `capabilities` and `release` and copy
     * them across — and that is precisely how the build fingerprint shipped
     * inert: it computed correctly inside the running image, the daemon passed
     * it, and this hand-copy dropped it without a word. Everything downstream
     * was correct about a field it never received.
     *
     * `deps` is the only member that is not part of the published record, so it
     * is the only one named. Anything added to `HeartbeatPublishSpec` now
     * reaches the wire by construction rather than by somebody remembering.
     */
    const { deps: _deps, ...spec } = opts;
    return createRedisHeartbeatPublisher(
      resolved.redis,
      resolved.intervalSeconds,
      spec,
      opts.deps ?? {},
    );
  }
  const capability = disabledCapability(
    resolved.intervalSeconds,
    isHeartbeatEnabled(env),
  );
  return {
    capability,
    async beat() {
      return { published: false, reason: "disabled" };
    },
  };
}

/**
 * Build the active heartbeat reader from the environment. Returns a real
 * Redis-backed reader only when the feature is enabled AND a broker is configured;
 * otherwise a disabled reader whose `read()` returns a neutral `disabled` liveness
 * without any network call.
 */
export function createHeartbeatReader(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): HeartbeatReader {
  const resolved = resolveHeartbeat(env);
  if (resolved.enabled && resolved.redis) {
    return createRedisHeartbeatReader(
      resolved.redis,
      resolved.intervalSeconds,
      deps,
    );
  }
  const capability = disabledCapability(
    resolved.intervalSeconds,
    isHeartbeatEnabled(env),
  );
  return {
    capability,
    async read() {
      return disabledLiveness("none");
    },
  };
}

/**
 * Convenience for the web route: resolve the reader and read the latest liveness in
 * one call. Never throws; a disabled seam returns a neutral `disabled` liveness and
 * an unreachable broker returns `unknown`.
 */
export function readWorkerHeartbeatLiveness(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<HeartbeatLiveness> {
  return createHeartbeatReader(env, deps).read();
}

/**
 * Does the worker that will run the next job read no more of a document than a
 * per-call AI job declared, and send the provider nothing the route's charge
 * does not count? The `readCapEnforced` witness `aiReservationFor` asks for
 * before it prices summarize, chat or extract by size.
 *
 * FRESH OR NOTHING. A stale heartbeat describes an image that may already have
 * been replaced, and an unreachable broker or a disabled seam describes no
 * image at all — each answers `false`, which charges a run what it cost before
 * the discount existed. That is the direction this may fail in: a discount
 * withheld, never a full read sold at a one-character price.
 */
export async function runningWorkerEnforcesAiReadCap(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<boolean> {
  const liveness = await readWorkerHeartbeatLiveness(env, deps);
  return liveness.observed && liveness.capabilities?.aiReadCap === true;
}

/**
 * May a translate job that asks for OCR run on the worker this liveness
 * describes (audit translate-pdf#3)? ONE pure predicate, read by BOTH the
 * panel's offer (`GET /api/worker/status`) and the admission gate
 * (`POST /api/jobs`), so the two cannot drift apart: a status that offers
 * the picker while the route refuses the job, or the reverse.
 *
 * The worker image is published separately from the web tier, and an image
 * built before the feature IGNORES the request — the translate parser there
 * never heard of it — and refuses the scan as having no text, after the
 * allowance was charged. So "the code is merged" is the mechanism, and the
 * property is "the running image proves both halves on a fresh heartbeat":
 * `translateOcr` (the chain) and `ocr` (OCR runs there). A stale, absent or
 * unreachable beat answers `not_running`.
 *
 * `languages`, when given, must ALSO be packs that beat reports installed.
 * OCR's own installed-pack check on the worker refuses any other before work,
 * and nothing gives the route's reservation back after a worker failure. An
 * EMPTY `ocrLanguages` admits none: an image new enough to publish
 * `translateOcr` publishes `probeInstalledOcrLanguages`, which always returns
 * an array, so empty there means "none installed", not "did not say" (the
 * older-image reading the status route uses for the plain OCR menu).
 */
export type TranslateScanAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not_running" }
  | {
      readonly ok: false;
      readonly reason: "missing_packs";
      readonly missing: readonly string[];
    };

export function translateScanAdmission(
  liveness: HeartbeatLiveness,
  languages: readonly string[] = [],
): TranslateScanAdmission {
  const caps = liveness.capabilities;
  if (!liveness.observed || caps?.translateOcr !== true || caps.ocr !== true)
    return { ok: false, reason: "not_running" };
  const installed = new Set(caps.ocrLanguages);
  const missing = languages.filter((code) => !installed.has(code));
  return missing.length > 0
    ? { ok: false, reason: "missing_packs", missing }
    : { ok: true };
}

/**
 * The panel's question: may it offer OCR at all? No languages are chosen yet,
 * so it also needs at least ONE installed pack — an offer of a picker every
 * choice in which the route would refuse is not an offer.
 */
export function liveWorkerTranslatesScans(
  liveness: HeartbeatLiveness,
): boolean {
  return (
    translateScanAdmission(liveness).ok &&
    (liveness.capabilities?.ocrLanguages.length ?? 0) > 0
  );
}

/**
 * `POST /api/jobs` asks this before charging a translate job that carries an
 * OCR request, with the job's parsed OCR languages. See
 * {@link translateScanAdmission}.
 */
export async function runningWorkerTranslatesScans(
  languages: readonly string[],
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<TranslateScanAdmission> {
  return translateScanAdmission(
    await readWorkerHeartbeatLiveness(env, deps),
    languages,
  );
}

/**
 * May HTML to PDF take a ZIP on the worker this liveness describes
 * (competitor audit #26)? ONE pure predicate, read by the page's offer
 * (`GET /api/worker/status`) and by both admission gates (`POST
 * /api/uploads` for a ZIP file, `POST /api/jobs` for a job naming a page of
 * one), so the three cannot drift apart.
 *
 * The property is "the running image prints a ZIP", not "the code is
 * merged": an image built before the feature renders a ZIP's bytes as if
 * they were HTML and reports success. Only a fresh, observed heartbeat
 * carrying `htmlZip: true` (proven at the daemon's start-up,
 * `html-render/zip-capability.ts`) says so; a stale, absent or unreachable
 * beat, or one from an older image (no key, parsed as false), says no.
 */
export function liveWorkerRendersHtmlZip(liveness: HeartbeatLiveness): boolean {
  return liveness.observed && liveness.capabilities?.htmlZip === true;
}

/**
 * Does the running Chat with PDF choose a longer document's pages by the
 * question (competitor audit wave 2 #30)? ONE pure predicate, read by
 * `GET /api/worker/status` for the chat panel's sentence about how pages
 * are chosen.
 *
 * The property is "the running image chooses pages by the question within
 * the charged budget", not "the code is merged": an image built before the
 * feature sends only the opening pages, and the web tier deploys first.
 * Only a fresh, observed heartbeat carrying `chatRetrieval: true` (proven at
 * the daemon's start-up, `chat-with-pdf/retrieval-capability.ts`) says so; a
 * stale, absent or unreachable beat, or an older image's record (no key,
 * parsed as false), says no.
 */
export function liveWorkerSelectsChatPages(
  liveness: HeartbeatLiveness,
): boolean {
  return liveness.observed && liveness.capabilities?.chatRetrieval === true;
}

/**
 * May Summarize PDF read only the pages a person chose (competitor audit
 * summarize-pdf#5)? ONE pure predicate, read by the page's offer (`GET
 * /api/worker/status`, which shows the "Part to summarize" control) and by
 * the admission gate (`POST /api/jobs` for a summarize job carrying
 * `pages`), so the two cannot drift apart.
 *
 * The property is "the running image slices the text by physical page
 * BEFORE the read cap", not "the code is merged": an image built before the
 * feature parses the options leniently, drops `pages` without a word, and
 * summarizes the document's opening pages under an allowance sized for the
 * selection. Only a fresh, observed heartbeat carrying `summarizePages:
 * true` (proven at the daemon's start-up, `summarize/pages-capability.ts`,
 * on the image's own pdftotext) says so; a stale, absent or unreachable
 * beat, or an older image's record (no key, parsed as false), says no.
 */
export function liveWorkerSummarizesPages(
  liveness: HeartbeatLiveness,
): boolean {
  return liveness.observed && liveness.capabilities?.summarizePages === true;
}

/** The admission gate's question, read from the broker. See {@link liveWorkerSummarizesPages}. */
export async function runningWorkerSummarizesPages(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<boolean> {
  return liveWorkerSummarizesPages(
    await readWorkerHeartbeatLiveness(env, deps),
  );
}

/**
 * May Translate PDF translate only the pages a person chose (competitor
 * audit #29, slice 6)? ONE pure predicate, read by the page's offer (`GET
 * /api/worker/status`, which shows the Pages field) and by the admission gate
 * (`POST /api/jobs` for a translate job carrying `pages`), so the two cannot
 * drift apart.
 *
 * The property is "the running image applies the selection by physical page
 * number BEFORE the reading-order gate, the planner and the delivery cap",
 * not "the code is merged": an image built before the feature parses the
 * options leniently, drops `pages` without a word, and translates the WHOLE
 * document under a delivery cap sized for the selection, which then withholds
 * most of it behind a notice about the document. Only a fresh, observed
 * heartbeat carrying `translatePageRange: true` (proven at the daemon's
 * start-up, `translate/page-range-capability.ts`, on the image's own
 * extractor) says so; a stale, absent or unreachable beat, or an older
 * image's record (no key, parsed as false), says no.
 */
export function liveWorkerTranslatesPageRanges(
  liveness: HeartbeatLiveness,
): boolean {
  return (
    liveness.observed && liveness.capabilities?.translatePageRange === true
  );
}

/** The admission gate's question, read from the broker. See {@link liveWorkerTranslatesPageRanges}. */
export async function runningWorkerTranslatesPageRanges(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<boolean> {
  return liveWorkerTranslatesPageRanges(
    await readWorkerHeartbeatLiveness(env, deps),
  );
}

/**
 * May Excel to PDF read a .csv with the delimiter and character set a person
 * chose (competitor audit #18)? ONE pure predicate, read by the page's offer
 * (`GET /api/worker/status`, which shows the two selects) and by the
 * admission gate (`POST /api/jobs` for an Excel job carrying `csvDelimiter`
 * or `csvCharset`), so the two cannot drift apart.
 *
 * The property is "the running image opens the CSV with the chosen
 * separator and character set", not "the code is merged": an image built
 * before the feature drops both keys without a word and reads the file as
 * comma separated, which is the one-column printout the choice exists to
 * fix. Only a fresh, observed heartbeat carrying `csvImportOptions: true`
 * (proven at the daemon's start-up, `office-conversion/csv-capability.ts`)
 * says so; a stale, absent or unreachable beat, or an older image's record
 * (no key, parsed as false), says no.
 */
export function liveWorkerReadsCsvImportOptions(
  liveness: HeartbeatLiveness,
): boolean {
  return liveness.observed && liveness.capabilities?.csvImportOptions === true;
}

/** The admission gate's question, read from the broker. See {@link liveWorkerReadsCsvImportOptions}. */
export async function runningWorkerReadsCsvImportOptions(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<boolean> {
  return liveWorkerReadsCsvImportOptions(
    await readWorkerHeartbeatLiveness(env, deps),
  );
}

/**
 * May OCR PDF run on a restricted PDF with the owner password a person typed
 * (competitor-audit backlog #11)? ONE pure predicate, read by the page's
 * offer (`GET /api/worker/status`, which shows the Owner password field)
 * and by the admission gate (`POST /api/jobs` for an OCR job carrying
 * `ownerPassword`), so the two cannot drift apart.
 *
 * The property is "the running image verifies the owner password and keeps
 * the author's restrictions on the result", not "the code is merged": an
 * image built before the feature drops the field without a word and refuses
 * the file as restricted. Only a fresh, observed heartbeat carrying
 * `ocrOwnerPassword: true` (proven at the daemon's start-up,
 * `ocr-owner-capability.ts`) says so; a stale, absent or unreachable beat,
 * or an older image's record (no key, parsed as false), says no.
 */
export function liveWorkerOcrsWithOwnerPassword(
  liveness: HeartbeatLiveness,
): boolean {
  return liveness.observed && liveness.capabilities?.ocrOwnerPassword === true;
}

/** The admission gate's question, read from the broker. See {@link liveWorkerOcrsWithOwnerPassword}. */
export async function runningWorkerOcrsWithOwnerPassword(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<boolean> {
  return liveWorkerOcrsWithOwnerPassword(
    await readWorkerHeartbeatLiveness(env, deps),
  );
}

/** The admission gates' question, read from the broker. See {@link liveWorkerRendersHtmlZip}. */
export async function runningWorkerRendersHtmlZip(
  env: EnvSource = process.env,
  deps: HeartbeatRedisDeps = {},
): Promise<boolean> {
  return liveWorkerRendersHtmlZip(await readWorkerHeartbeatLiveness(env, deps));
}
