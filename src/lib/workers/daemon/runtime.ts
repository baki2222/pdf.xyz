/**
 * The worker-daemon runtime: wires the real providers a deployed worker drains.
 *
 * It is the Node-runtime seam the CLI (`scripts/worker-daemon.ts`) calls to turn
 * an environment into a ready-to-tick {@link WorkerExecutor}:
 *  - the job queue comes from the existing {@link createQueueProvider} factory
 *    (the real Redis/Upstash broker when configured, else the honest
 *    not-configured provider), narrowed to a {@link ClaimableQueue} — only a
 *    broker that can `claim`/`complete` is drainable;
 *  - object storage comes from {@link createS3ExecutorStorage} (genuine signed
 *    byte I/O) when S3/R2 is configured, else `null`;
 *  - the processor registry is built with a live native-engine probe, so
 *    compression's lossless repack is always available and its deep path plus OCR
 *    light up only when a real engine/runner is present — never faked.
 *
 * An executor is returned ONLY when the queue is drainable AND storage is
 * configured (a job's inputs and outputs both live in the bucket). Otherwise the
 * runtime reports honestly *why* it cannot run, so the CLI exits with a truthful
 * "not configured" status rather than pretending to process. Every dependency is
 * injectable, so the wiring is unit-tested without touching real Redis, S3, or a
 * native binary.
 *
 * Node-only: it pulls the queue factory (node:crypto), the S3 signer (node:crypto),
 * and the native-compression probe (node:child_process). It is imported by the CLI
 * and its tests only — never re-exported from an eager worker barrel.
 */

import {
  createWorkerExecutor,
  type WorkerExecutor,
} from "../executor/executor";
import type { ExecutorLogEvent, ExecutorStorage } from "../executor/types";
import { instrumentExecutorStorage } from "../observability/instrument";
import type { WorkerMetricSink } from "../observability/collector";
import {
  createS3ExecutorStorage,
  type S3ExecutorStorageDeps,
} from "../executor/s3-storage";
import { parseS3Config } from "../storage/s3-config";
import { createQueueProvider } from "../queue/factory";
import type { RedisQueueDeps } from "../queue/redis";
import type { ClaimableQueue } from "../queue/claim";
import type { QueueProvider } from "../queue/types";
import { createProcessorRegistry } from "../processor";
import type { OcrProcessorDeps } from "../processor/ocr";
import type { ProcessorRegistry } from "../processor/registry";
import type { ProcessorCapability } from "../processor/types";
import { nativeOcrDeps, probeInstalledOcrLanguages } from "../ocr-native";
import { nativeOcrCapability } from "../ocr-native-config";
import type { OcrEngine } from "../ocr";
import type {
  ClamavTransport,
  MalwareScanCapability,
  MalwareScanner,
} from "../scanner";
import { resolveWorkerScanner } from "../scanner/node";
import {
  resolveWorkerSoundness,
  type SoundnessCapability,
  type SoundnessGate,
} from "../soundness";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestCapability,
  type ArtifactManifestGate,
} from "../artifacts";
import {
  DEEP_COMPRESSION_TOOLS,
  type CompressionDeps,
  type CompressionTool,
  type ToolAvailability,
} from "../compression/engine";
import { nativeCompressionDeps } from "../compression/native";
import type { PdfSecurityDeps } from "../pdf-security/engine";
import { nativePdfSecurityDeps } from "../pdf-security/native";
import type { PdfStructureDeps } from "../pdf-structure/engine";
import { nativePdfStructureDeps } from "../pdf-structure/native";
import type { PdfArchiveDeps } from "../pdf-archive/engine";
import { nativePdfArchiveDeps } from "../pdf-archive/native";
import type { HtmlRenderDeps } from "../html-render/engine";
import { nativeHtmlRenderDeps } from "../html-render/native";
import type { OfficeConversionDeps } from "../office-conversion/engine";
import { nativeOfficeConversionDeps } from "../office-conversion/native";
import type { PdfOfficeExportDeps } from "../pdf-office-export/engine";
import { pdfOfficeExportDeps } from "../pdf-office-export/native";
import type { TableExtractDeps } from "../table-extract/engine";
import { tableExtractDeps } from "../table-extract/native";
import type { SignatureRequestDeps } from "../request-signatures/engine";
import { signatureRequestDeps } from "../request-signatures/native";
import type { SummarizeDeps } from "../summarize/engine";
import { summarizeDeps } from "../summarize/native";
import type { TranslateDeps } from "../translate/engine";
import { translateDeps } from "../translate/native";
import type { AiExtractDeps } from "../ai-extract/engine";
import { aiExtractDeps } from "../ai-extract/native";
import type { ChatWithPdfDeps } from "../chat-with-pdf/engine";
import { chatWithPdfDeps } from "../chat-with-pdf/native";
import { resolveDaemonReadiness, type DaemonReadiness } from "./readiness";
import {
  resolveDeploymentReadiness,
  evaluateGuardrails,
  type WorkerDeploymentReadiness,
  type GuardrailReport,
} from "../deploy";

type EnvSource = Record<string, string | undefined>;

/** The tool slug the OCR processor owns; used to read its capability for the readout. */
const OCR_TOOL = "ocr-pdf";

/** Why no executor could be built, when the runtime is not runnable. Content-free. */
export type RuntimeBlock =
  | "not_configured" // neither a drainable queue nor storage is configured
  | "queue_not_drainable" // storage is configured, but no drainable queue is
  | "storage_not_configured"; // a drainable queue exists, but storage is not configured

/**
 * Presence-only health of the worker's compression engine — deliberately distinct
 * from daemon *drainability*. `drainable` answers "are the queue and storage wired
 * so this worker can claim and complete jobs at all?"; this answers the orthogonal
 * "will `deep` image compression actually run on THIS worker image, or only the
 * always-available lossless repack?". A deployment can be perfectly drainable and
 * still be lossless-only because no native engine is installed — an operator wants
 * to smoke-test that before advertising deep compression. Names engines by binary
 * name only (presence on PATH); never a path, version, key, or value.
 */
export interface CompressionEngineHealth {
  /** Lossless structural repack — always available (pure-JS pdf-lib repack). */
  lossless: true;
  /** Deep image compression — available only when a native engine is installed. */
  deep: boolean;
  /** Native engines detected on the host, in preference order. Names only. */
  engines: CompressionTool[];
  /** One-line, client-safe explanation. Never a path, version, key, or value. */
  detail: string;
}

/**
 * Presence-only OCR health of the worker — deliberately distinct from daemon
 * drainability, the OCR analogue of {@link CompressionEngineHealth}. It combines the
 * node-free config capability (is OCR *opted into*?) with the wired processor's
 * runtime readiness (is an engine actually *installed* here?), so `--dry-run-status`
 * can tell the four honest OCR states apart:
 *  - `enabled: false`                → `disabled`/`not-configured` (the safe default);
 *  - `enabled: true`, `ready: false` → `unavailable` (opted in, but no engine installed);
 *  - `enabled: true`, `ready: true`  → `ready` (a real engine + runner can run OCR now).
 * Presence-only: it names the engine *family* only — never a path, version, or value.
 */
export interface OcrRuntimeHealth {
  /** True when OCR is opted into via config (`PDFXYZ_OCR` enabled + shape-valid). */
  enabled: boolean;
  /** Pinned engine family (name only), or null for auto-detect / when disabled. */
  engine: OcrEngine | null;
  /** True ONLY when a real engine + runner are wired on THIS worker (can run now). */
  ready: boolean;
  /** One-line, client-safe explanation. Never a path, version, key, or value. */
  detail: string;
  /**
   * The recognition languages whose `traineddata` packs are actually present in this
   * image, narrowed to the codes the product advertises. `ready` says an engine is
   * wired; this says what that engine has data for, which is a different question and
   * a different failure. Published in the heartbeat so the web tier can offer only
   * languages that will really run. Bounded vocabulary, so content-free.
   */
  languages: readonly string[];
}

/** The resolved runtime: readiness + processor capabilities, and an executor iff runnable. */
export interface WorkerRuntime {
  /** Presence-only provider/daemon readiness for logging and `--dry-run-status`. */
  readiness: DaemonReadiness;
  /**
   * Presence-only compression-engine health (lossless always; deep only with a
   * native engine). Reported even when the runtime is not drainable, so a smoke
   * check can distinguish "no queue/storage" from "no deep engine".
   */
  compression: CompressionEngineHealth;
  /**
   * Composed, presence-only deployment readiness (Phase 19): storage/queue/engine
   * plus the lifecycle backstop, and the honest not-implemented facets for malware
   * scanning and OCR. Content-free; drives `--dry-run-status`.
   */
  deployment: WorkerDeploymentReadiness;
  /**
   * The production guardrail report (Phase 19): typed, content-free violations for
   * dangerous or invalid deployment configuration. `ok: false` fails a run fast and
   * drives the `--check` exit code. Evaluated with the same probed engine health as
   * the deployment readiness, so the two never disagree.
   */
  guardrails: GuardrailReport;
  /**
   * Presence-only capability of the wired malware-scan gate. `active: true` only
   * when a real scanner (ClamAV) is configured with a usable endpoint; otherwise
   * the honest no-op is wired (`active: false`), distinguishing `disabled` /
   * `not-configured` / `unavailable`. It can never be mistaken for scanning when it
   * is not. Reported even when the runtime is not drainable. Content-free.
   */
  scanner: MalwareScanCapability;
  /**
   * Presence-only capability of the wired file-soundness gate (Phase 36). The gate
   * ships ENABLED by default (a bounded structural preflight that needs no backend
   * and makes no security claim), so `active: true` unless an operator disables it.
   * Reported even when the runtime is not drainable. Content-free — never a value.
   */
  soundness: SoundnessCapability;
  /**
   * Presence-only capability of the wired artifact-manifest gate (Phase 37). The gate
   * ships ENABLED by default (a bounded structural provenance check that needs no
   * backend and makes no security claim), so `active: true` unless an operator
   * disables it. Reported even when the runtime is not drainable. Content-free.
   */
  artifact: ArtifactManifestCapability;
  /**
   * Presence-only OCR health (Phase 23): whether OCR is opted into (config) and
   * whether a real engine + runner are wired here (runtime). Reported even when the
   * runtime is not drainable, so a smoke check can distinguish `disabled` /
   * `not-configured` / `unavailable` / `ready`. Content-free.
   */
  ocr: OcrRuntimeHealth;
  /** Honest, presence-only capability of every registered processor. */
  processors: ProcessorCapability[];
  /** The executor to tick — present ONLY when the queue is drainable and storage is ready. */
  executor?: WorkerExecutor;
  /** Why `executor` is absent (content-free). Present iff `executor` is undefined. */
  blocked?: RuntimeBlock;
}

/**
 * Derive the presence-only {@link CompressionEngineHealth} from the compression
 * dependencies the runtime wired. Pure and deterministic — it reads only the
 * already-probed tool availability, never re-touching the host — so the readout
 * always matches the engine the executor will actually run.
 */
export function deriveCompressionHealth(
  tools: ToolAvailability,
): CompressionEngineHealth {
  const engines = DEEP_COMPRESSION_TOOLS.filter((tool) => tools[tool]);
  const deep = engines.length > 0;
  return {
    lossless: true,
    deep,
    engines,
    detail: deep
      ? `Lossless structural repack and deep image compression are available (deep runs on ${engines[0]}).`
      : "Lossless structural repack is available; deep image compression is not — no native engine (Ghostscript, qpdf, or mutool) is installed on this worker, so `deep` jobs fail honestly as not_implemented.",
  };
}

/** Injectable seams so the whole wiring is testable without real Redis/S3/binaries. */
export interface WorkerRuntimeDeps {
  /** Override the queue provider (tests inject a fake `ClaimableQueue`/`QueueProvider`). */
  queue?: QueueProvider;
  /** Injectable provider deps for the real queue factory (clock/transport/client). */
  queueDeps?: RedisQueueDeps;
  /**
   * Override the executor storage. `undefined` → resolve from S3 config;
   * `null` → force "no storage configured".
   */
  storage?: ExecutorStorage | null;
  /** Injectable seams (clock/transport) for the real S3 executor storage. */
  storageDeps?: S3ExecutorStorageDeps;
  /** Override the processor registry entirely. */
  registry?: ProcessorRegistry;
  /**
   * Override the malware scanner. Tests inject a fake (clean/infected/error); the
   * shipped runtime resolves the real ClamAV scanner (when configured) or the honest
   * no-op via {@link resolveWorkerScanner}, which never claims a file was scanned.
   */
  scanner?: MalwareScanner;
  /**
   * Override the clamd transport used when a scanner is configured. Tests inject a
   * fake so a clamav-configured environment is wired WITHOUT opening a socket; the
   * shipped runtime uses the real Node socket transport.
   */
  scannerTransport?: ClamavTransport;
  /**
   * Override the file-soundness gate. Tests inject a disabled or custom-policy gate;
   * the shipped runtime resolves it from the environment via
   * {@link resolveWorkerSoundness} (enabled by default). Threaded into the executor.
   */
  soundness?: SoundnessGate;
  /**
   * Override the artifact-manifest / provenance gate (Phase 37). Tests inject a
   * disabled or custom-policy gate; the shipped runtime resolves it from the
   * environment via {@link resolveWorkerArtifactManifest} (enabled by default).
   * Threaded into the executor so a malformed output fails the job before publication.
   */
  artifactManifest?: ArtifactManifestGate;
  /** Override the compression deps (tests avoid probing the host PATH / shelling out). */
  compression?: CompressionDeps;
  /**
   * Override the OCR deps (engine availability + native runner). Tests inject a fake
   * runner so OCR completes without a real engine; the shipped runtime resolves them
   * from the environment via {@link nativeOcrDeps} — empty (honestly not-implemented)
   * unless an operator has opted in with `PDFXYZ_OCR` and installed an engine.
   */
  ocr?: OcrProcessorDeps;
  /**
   * Override the PDF security (protect/unlock) deps. Tests inject a fake qpdf runner
   * so protect/unlock complete without a real binary; the shipped runtime resolves
   * them from the environment via {@link nativePdfSecurityDeps} — the qpdf runner is
   * wired whenever qpdf is installed (it ships in the worker image) and left off
   * (honestly not-implemented) otherwise.
   */
  pdfSecurity?: PdfSecurityDeps;
  /** PDF structure (repair/linearize) deps; defaults to qpdf auto-detection. */
  pdfStructure?: PdfStructureDeps;
  /** PDF/A archive deps; defaults to Ghostscript auto-detection. */
  pdfArchive?: PdfArchiveDeps;
  /** HTML/Webpage rendering deps; defaults to Chromium auto-detection. */
  htmlRender?: HtmlRenderDeps;
  /** Office conversion deps; defaults to LibreOffice auto-detection. */
  officeConversion?: OfficeConversionDeps;
  /** PDF to Office export deps; defaults to pdfjs text extraction. */
  pdfOfficeExport?: PdfOfficeExportDeps;
  /** Table extraction deps; defaults to pdfjs positioned-text layout. */
  tableExtract?: TableExtractDeps;
  /** Request-signatures deps; defaults to the pdf-lib field preparer. */
  requestSignatures?: SignatureRequestDeps;
  /**
   * Summarize deps (selectable-text extractor + AI provider). Defaults to the pdfjs
   * extractor plus a live AI provider resolved from the environment via
   * {@link summarizeDeps} — the provider is present only when an operator configured
   * one (`PDFXYZ_AI_PROVIDER` + key), else summarize fails honestly as not-implemented.
   * Tests inject a fake provider to exercise the ready path without a real key.
   */
  summarize?: SummarizeDeps;
  /**
   * Translate deps (selectable-text extractor + AI provider). Defaults to the pdfjs
   * extractor plus a live AI provider resolved from the environment via
   * {@link translateDeps} — the provider is present only when an operator configured
   * one (`PDFXYZ_AI_PROVIDER` + key), else translate fails honestly as not-implemented.
   * Tests inject a fake provider to exercise the ready path without a real key.
   */
  translate?: TranslateDeps;
  /**
   * AI Data Extraction deps (selectable-text extractor + AI provider). Defaults to
   * the pdfjs extractor plus a live AI provider resolved from the environment via
   * {@link aiExtractDeps} — the provider is present only when an operator configured
   * one (`PDFXYZ_AI_PROVIDER` + key), else ai-extract fails honestly as not-implemented.
   * Tests inject a fake provider to exercise the ready path without a real key.
   */
  aiExtract?: AiExtractDeps;
  /**
   * Chat with PDF deps (selectable-text extractor + AI provider). Defaults to the
   * pdfjs extractor plus a live AI provider resolved from the environment via
   * {@link chatWithPdfDeps} — the provider is present only when an operator configured
   * one (`PDFXYZ_AI_PROVIDER` + key), else chat-with-pdf fails honestly as
   * not-implemented. Tests inject a fake provider to exercise the ready path.
   */
  chatWithPdf?: ChatWithPdfDeps;
  /** Lease each claimed job for this long (ms); forwarded to the executor. */
  leaseMs?: number;
  /** Max delivery attempts before a retryable failure becomes terminal. */
  maxAttempts?: number;
  /** Content-free executor log sink (claimed/scanning/…); forwarded to the executor. */
  log?: (event: ExecutorLogEvent) => void;
  /**
   * Optional content-free metrics sink (Phase 28). When present, the resolved executor
   * storage is wrapped to emit `worker_storage_ops_total{op,result}`, and the sink is
   * forwarded to the executor for scan/processor/terminal/redelivery metrics. Absent ⇒
   * no metrics are emitted and the wiring is byte-for-byte unchanged.
   */
  metrics?: WorkerMetricSink;
  /** Metrics-only clock forwarded to the executor for latency buckets (defaults to Date.now). */
  now?: () => number;
}

/** A queue that can also `submit`/`claim` (store execution specs) is drainable. */
function isClaimableQueue(queue: QueueProvider): queue is ClaimableQueue {
  return (
    typeof (queue as Partial<ClaimableQueue>).claim === "function" &&
    typeof (queue as Partial<ClaimableQueue>).complete === "function"
  );
}

/**
 * Resolve the worker-side {@link ExecutorStorage} from the environment: a genuine
 * S3/R2 byte-I/O storage when S3 is configured, else `null` (honest "no storage").
 * The counterpart of {@link createQueueProvider} for the executor's byte seam.
 */
export function resolveExecutorStorage(
  env: EnvSource = process.env,
  deps: S3ExecutorStorageDeps = {},
): ExecutorStorage | null {
  const parsed = parseS3Config(env);
  return parsed.ok ? createS3ExecutorStorage(parsed.config, deps) : null;
}

/**
 * Build the daemon runtime from an environment. Deterministic given its injected
 * deps; with none, it reads real provider config from `env` and probes the host
 * for native engines. Returns an executor only when the queue is drainable AND
 * storage is configured; otherwise `blocked` says honestly why not.
 */
export function resolveWorkerRuntime(
  env: EnvSource = process.env,
  deps: WorkerRuntimeDeps = {},
): WorkerRuntime {
  const readiness = resolveDaemonReadiness(env);

  // Resolve the compression dependencies ONCE so the wired processor and the
  // health readout can never disagree about which native engines are present.
  // The host PATH probe (`nativeCompressionDeps`) runs only when neither explicit
  // compression deps nor a full registry override was supplied — tests inject one
  // of those, so they never touch the host.
  const compressionDeps = deps.compression ?? nativeCompressionDeps();
  // OCR is opt-in: with `PDFXYZ_OCR` unset, `nativeOcrDeps(env)` returns empty deps
  // (a disabled config touches no host), so the OCR processor is honestly not-ready
  // and `ocr-pdf` fails as `not_implemented` — no host probe, no runner. A test
  // injects a fake runner to exercise the ready path.
  const ocrDeps = deps.ocr ?? nativeOcrDeps(env);
  // PDF security auto-detects qpdf (it ships in the worker image), honoring the
  // `PDFXYZ_PDF_SECURITY` kill switch and binary override. When qpdf is absent the
  // runner is left off and protect/unlock fail honestly as `not_implemented`. Tests
  // inject a fake runner to exercise the ready path without a real binary.
  const pdfSecurityDeps = deps.pdfSecurity ?? nativePdfSecurityDeps(env);
  const pdfStructureDeps = deps.pdfStructure ?? nativePdfStructureDeps(env);
  const pdfArchiveDeps = deps.pdfArchive ?? nativePdfArchiveDeps(env);
  const htmlRenderDeps = deps.htmlRender ?? nativeHtmlRenderDeps(env);
  const officeConversionDeps =
    deps.officeConversion ?? nativeOfficeConversionDeps(env);
  const pdfOfficeExport = deps.pdfOfficeExport ?? pdfOfficeExportDeps();
  const tableExtract = deps.tableExtract ?? tableExtractDeps();
  const requestSignatures = deps.requestSignatures ?? signatureRequestDeps();
  // Summarize auto-resolves its AI provider from the env (absent unless an operator
  // opted in). The extractor is always wired; with no provider the processor is
  // registered but honestly not-ready and fails as not_implemented — never faked.
  const summarize = deps.summarize ?? summarizeDeps(env);
  // Translate mirrors summarize: the extractor is always wired; the AI provider is
  // auto-resolved from the env (absent unless an operator opted in). With no provider
  // the processor is registered but honestly not-ready and fails as not_implemented.
  const translate = deps.translate ?? translateDeps(env);
  // AI Data Extraction mirrors summarize/translate: the extractor is always wired; the
  // AI provider is auto-resolved from the env (absent unless an operator opted in). With
  // no provider the processor is registered but honestly not-ready and fails as
  // not_implemented — never a fabricated extraction.
  const aiExtract = deps.aiExtract ?? aiExtractDeps(env);
  // Chat with PDF mirrors summarize/translate/ai-extract: the extractor is always
  // wired; the AI provider is auto-resolved from the env (absent unless an operator
  // opted in). With no provider the processor is registered but honestly not-ready and
  // fails as not_implemented — never a fabricated answer.
  const chatWithPdf = deps.chatWithPdf ?? chatWithPdfDeps(env);
  const registry =
    deps.registry ??
    createProcessorRegistry({
      compression: compressionDeps,
      ocr: ocrDeps,
      pdfSecurity: pdfSecurityDeps,
      pdfStructure: pdfStructureDeps,
      pdfArchive: pdfArchiveDeps,
      htmlRender: htmlRenderDeps,
      officeConversion: officeConversionDeps,
      pdfOfficeExport,
      tableExtract,
      requestSignatures,
      summarize,
      translate,
      aiExtract,
      chatWithPdf,
    });
  const processors = registry.capabilities();
  const compression = deriveCompressionHealth(compressionDeps.tools);

  // Derive the presence-only OCR health from the actually-registered processor, so
  // the deployment facet and the `--dry-run-status` processor readout can never
  // disagree about whether THIS worker can genuinely run OCR. Absent (a test wired a
  // bare registry) ⇒ the facet stays honestly not-implemented.
  const ocrCapability = registry.resolve(OCR_TOOL)?.capability();

  // Presence-only OCR health: the node-free config capability (opted in? which engine
  // family?) fused with the wired processor's runtime readiness (engine installed?).
  // When ready, the processor's own detail is the most precise ("OCR ready on
  // <engine>"); otherwise the config capability's detail honestly explains whether OCR
  // is disabled/not-configured or opted-into-but-engine-missing. Content-free.
  const ocrConfigCapability = nativeOcrCapability(env);
  const ocr: OcrRuntimeHealth = {
    enabled: ocrConfigCapability.enabled,
    engine: ocrConfigCapability.engine,
    ready: ocrCapability?.ready ?? false,
    // Read from the image's tessdata directories, never from the advertised list —
    // the whole point is to report what is installed rather than what is promised.
    languages: probeInstalledOcrLanguages(env),
    detail:
      ocrCapability?.ready === true
        ? ocrCapability.detail
        : ocrConfigCapability.detail,
  };

  // Compose the operator-facing deployment readiness and evaluate the production
  // guardrails with the SAME probed engine health, so the readout and the pass/fail
  // gate can never disagree about which engines this worker actually has.
  const deployment = resolveDeploymentReadiness(readiness, env, {
    engine: compression,
    ...(ocrCapability
      ? { ocr: { ready: ocrCapability.ready, detail: ocrCapability.detail } }
      : {}),
  });
  const guardrails = evaluateGuardrails(env, {
    engine: compression,
    // Gate `require-ocr` on the SAME wired OCR processor the readiness facet uses, so
    // the pass/fail check and the readout can never disagree about OCR runnability.
    ...(ocrCapability ? { ocr: { ready: ocrCapability.ready } } : {}),
  });

  // Wire the malware-scan gate. When a usable clamd endpoint is configured this
  // resolves the real ClamAV scanner over a socket transport; otherwise the honest
  // no-op (never claims a file was scanned). A test can inject a scanner or a fake
  // transport. Its presence-only capability is reported even when not drainable.
  const scanner = resolveWorkerScanner(env, {
    ...(deps.scanner ? { scanner: deps.scanner } : {}),
    ...(deps.scannerTransport ? { transport: deps.scannerTransport } : {}),
  });
  const scannerCapability = scanner.capability();

  // Wire the file-soundness gate (Phase 36). Unlike the scanner it needs no backend
  // and makes no security claim, so it ships ENABLED by default; an operator can
  // disable it or tune the knobs via env. A test can inject a gate. Its presence-only
  // capability is reported even when the runtime is not drainable.
  const soundness = deps.soundness ?? resolveWorkerSoundness(env);
  const soundnessCapability = soundness.capability();

  // Wire the artifact-manifest / provenance gate (Phase 37). Like soundness it needs
  // no backend and makes no security claim (structural metadata validation only), so
  // it ships ENABLED by default; an operator can disable it or tune the knobs via env.
  // A test can inject a gate. Its presence-only capability is reported even when the
  // runtime is not drainable.
  const artifactManifest =
    deps.artifactManifest ?? resolveWorkerArtifactManifest(env);
  const artifactCapability = artifactManifest.capability();

  const queue = deps.queue ?? createQueueProvider(env, deps.queueDeps);
  const storage =
    deps.storage !== undefined
      ? deps.storage
      : resolveExecutorStorage(env, deps.storageDeps);

  const drainable = isClaimableQueue(queue);
  const hasStorage = storage !== null;

  if (drainable && hasStorage) {
    // When a metrics sink is wired, observe storage at the exact seam that touches the
    // bucket (content-free op/result categories only); otherwise pass storage through.
    const executorStorage = deps.metrics
      ? instrumentExecutorStorage(storage, deps.metrics)
      : storage;
    const executor = createWorkerExecutor({
      queue,
      storage: executorStorage,
      registry,
      scanner,
      soundness,
      artifactManifest,
      ...(deps.leaseMs !== undefined ? { leaseMs: deps.leaseMs } : {}),
      ...(deps.maxAttempts !== undefined
        ? { maxAttempts: deps.maxAttempts }
        : {}),
      ...(deps.log ? { log: deps.log } : {}),
      ...(deps.metrics ? { metrics: deps.metrics } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    return {
      readiness,
      compression,
      deployment,
      guardrails,
      scanner: scannerCapability,
      soundness: soundnessCapability,
      artifact: artifactCapability,
      ocr,
      processors,
      executor,
    };
  }

  const blocked: RuntimeBlock =
    !drainable && !hasStorage
      ? "not_configured"
      : !drainable
        ? "queue_not_drainable"
        : "storage_not_configured";
  return {
    readiness,
    compression,
    deployment,
    guardrails,
    scanner: scannerCapability,
    soundness: soundnessCapability,
    artifact: artifactCapability,
    ocr,
    processors,
    blocked,
  };
}
