/**
 * The capabilities a worker PROVES by running work — and the cache that lets
 * the container HEALTHCHECK publish them without running that work again.
 *
 * ── WHY THERE IS A CACHE ────────────────────────────────────────────────────
 *
 * The Dockerfile's HEALTHCHECK runs `pnpm worker:daemon --dry-run-status`
 * every minute under a timeout. That command used to build the heartbeat the
 * same way the long-running daemon does, awaiting every proof below — and
 * since `translatePdfLanguages` that means 21 real Chromium print jobs judged
 * by poppler (8.2 s measured with the readers stubbed; more with real ones).
 * A healthcheck that can outrun its timeout marks the container unhealthy and
 * gets the worker restarted in a loop, and it spends 21 jobs of CPU a minute
 * on the machine that is supposed to be doing the users' work.
 *
 * ── WHY "JUST SKIP THE PROOFS IN DRY-RUN" IS WRONG ──────────────────────────
 *
 * The heartbeat is ONE broker key per role (`heartbeat/redis.ts`:
 * `{prefix}:heartbeat:{role}`, written with a plain `SET`), so whichever
 * process beat last owns the record. The healthcheck's beat would overwrite
 * the daemon's with all-false proofs, the daemon's next beat would put them
 * back, and every panel that reads `translatePdfLanguages` would flap with
 * the healthcheck's cadence.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 *
 * A readiness probe publishes a proved value ONLY when it is the value THIS
 * image's code proved in THIS container run — otherwise it publishes nothing
 * and the running daemon's own beat stands. It never runs a proof itself.
 *
 * The cache key names both halves of that property:
 *   - `fingerprint` (`../build-fingerprint`) — the code that proved it;
 *   - `run` ({@link containerRunStamp}) — the container run it was proved in:
 *     the kernel boot id and PID 1's start time. A container's image cannot
 *     change under it, so "this container run" also pins the toolchain the
 *     fingerprint cannot see (Chromium, poppler, fonts — the Dockerfile is not
 *     hashed). A restart re-proves; a cache directory that outlives the
 *     container (a mounted volume) cannot carry a value across.
 * plus {@link PROOF_CACHE_VERSION}, the shape of the file itself.
 *
 * A cold probe (the daemon has not finished proving yet) publishes NOTHING
 * rather than proving or publishing a guess. Publishing nothing does not
 * flap: there is no record to overwrite yet, or the daemon's record stays.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import type { HeartbeatCapabilities } from "@/lib/workers/heartbeat";
import {
  provesChunkedTranslate,
  provesDeliveryCap,
} from "@/lib/workers/translate/capability";
import { provesTranslateOcr } from "@/lib/workers/translate/ocr-capability";
import { provesTranslateReadingOrder } from "@/lib/workers/translate/reading-order-capability";
import { provesHtmlZip } from "@/lib/workers/html-render/zip-capability";
import { provesChatRetrieval } from "@/lib/workers/chat-with-pdf/retrieval-capability";
import { provesSummarizePages } from "@/lib/workers/summarize/pages-capability";
import { translatePdfLanguages } from "@/lib/workers/translate/pdf-capability";
import { provesAiReadCap } from "@/lib/workers/processor/read-cap-proof";
import {
  provesDocxPictures,
  provesDocxRunStyles,
  provesDocxTables,
  provesDocxTableWraps,
  provesDocxTypefaces,
  provesPptxPictures,
  provesPptxPresentationChain,
} from "@/lib/workers/pdf-office-export/capability";
import { pdfOfficeExportDeps } from "@/lib/workers/pdf-office-export/native";
import type { DaemonMode } from "./args";

type Env = Record<string, string | undefined>;

/** One proved capability: how it is proven, and how a cached value is checked. */
type ProverTable<K extends keyof HeartbeatCapabilities> = {
  readonly [P in K]: {
    readonly prove: (env: Env) => Promise<HeartbeatCapabilities[P]>;
    /** The value, or `undefined` when it is not a value this key can hold. */
    readonly parse: (value: unknown) => HeartbeatCapabilities[P] | undefined;
  };
};

/** Infers `K` from the table's own keys, so the set is written once. */
function defineProvers<K extends keyof HeartbeatCapabilities>(
  table: ProverTable<K>,
): ProverTable<K> {
  return table;
}

const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** Strict: every entry a Translate language, none twice. Anything else is corrupt. */
const languages = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const known: ReadonlySet<string> = new Set(TRANSLATE_LANGUAGES);
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !known.has(entry) || seen.has(entry))
      return undefined;
    seen.add(entry);
  }
  return [...seen];
};

/**
 * THE set of capabilities a worker proves by running work, and the one place
 * each is proven. The daemon publishes these, the cache stores these, and the
 * cache reader validates these — all by walking this table, so a proof added
 * here is cached and checked without anyone remembering to.
 *
 * `translatePdfLanguages` goes through the process-wide memo the ENGINE also
 * reads before every render (`translate/pdf-languages.ts`), so in a run-mode
 * daemon the published list is the list its jobs print.
 */
export const PROVED_CAPABILITIES = defineProvers({
  chunkedTranslate: { prove: () => provesChunkedTranslate(), parse: bool },
  deliveryCap: { prove: () => provesDeliveryCap(), parse: bool },
  aiReadCap: { prove: () => provesAiReadCap(), parse: bool },
  pptxPresentationChain: {
    prove: () => provesPptxPresentationChain(),
    parse: bool,
  },
  pptxPictures: { prove: () => provesPptxPictures(), parse: bool },
  docxPictures: {
    prove: (env) => provesDocxPictures(pdfOfficeExportDeps(env)),
    parse: bool,
  },
  docxRunStyles: {
    prove: (env) => provesDocxRunStyles(pdfOfficeExportDeps(env)),
    parse: bool,
  },
  docxTables: {
    prove: (env) => provesDocxTables(pdfOfficeExportDeps(env)),
    parse: bool,
  },
  docxTypefaces: {
    prove: (env) => provesDocxTypefaces(pdfOfficeExportDeps(env)),
    parse: bool,
  },
  docxTableWraps: {
    prove: (env) => provesDocxTableWraps(pdfOfficeExportDeps(env)),
    parse: bool,
  },
  translateOcr: { prove: () => provesTranslateOcr(), parse: bool },
  htmlZip: { prove: () => provesHtmlZip(), parse: bool },
  chatRetrieval: { prove: (env) => provesChatRetrieval(env), parse: bool },
  summarizePages: {
    prove: (env) => provesSummarizePages({ env }),
    parse: bool,
  },
  translatePdfLanguages: {
    prove: (env) => translatePdfLanguages(env),
    parse: languages,
  },
  // The image's REAL Translate extractor (`-layout`, then `-bbox-layout`)
  // on a generated two-column page, through the executor's order: the
  // model and the delivered text must get the columns one after the other.
  translateReadingOrder: {
    prove: (env) => provesTranslateReadingOrder(env),
    parse: bool,
  },
});

export type ProvedKey = keyof typeof PROVED_CAPABILITIES;
export type ProvedCapabilities = Pick<HeartbeatCapabilities, ProvedKey>;
export type Provers = ProverTable<ProvedKey>;

/** Bumped when the cache FILE's shape changes. */
export const PROOF_CACHE_VERSION = 1;
export const PROOF_CACHE_FILE = "pdfxyz-worker-proofs.json";

/** What a cached value must have been proved by. See the header. */
export interface ProofCacheKey {
  readonly fingerprint: string;
  readonly run: string | null;
}

/**
 * This container run: the kernel boot id plus PID 1's start time (clock ticks
 * since boot, field 22 of `/proc/1/stat`). Null where `/proc` is not Linux's.
 */
export function containerRunStamp(
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): string | null {
  try {
    const boot = read("/proc/sys/kernel/random/boot_id").trim();
    const stat = read("/proc/1/stat");
    // `comm` (field 2) is parenthesised and may hold spaces: count from the
    // LAST ")", after which field 3 (state) is index 0, so field 22 is 19.
    const after = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/);
    const start = after[19];
    if (!boot || !start || !/^\d+$/.test(start)) return null;
    return `${boot}:${start}`;
  } catch {
    return null;
  }
}

/** The modes that report and claim nothing — the HEALTHCHECK is one. */
export function isReadinessMode(mode: DaemonMode): boolean {
  return mode === "dry-run-status" || mode === "check";
}

/** Run every proof, in order, as the daemon always has (one at a time). */
export async function proveCapabilities(
  env: Env,
  provers: Provers = PROVED_CAPABILITIES,
): Promise<ProvedCapabilities> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(provers) as ProvedKey[]) {
    out[key] = await provers[key].prove(env);
  }
  return out as unknown as ProvedCapabilities;
}

/**
 * The cached proofs, or null: no file, unreadable, not JSON, another version,
 * another fingerprint, another container run, a key missing, or a value no
 * proof could have produced. Never throws.
 */
export function readProofCache(
  dir: string,
  key: ProofCacheKey,
  provers: Provers = PROVED_CAPABILITIES,
): ProvedCapabilities | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(dir, PROOF_CACHE_FILE), "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const file = parsed as Record<string, unknown>;
  if (
    file.v !== PROOF_CACHE_VERSION ||
    file.fingerprint !== key.fingerprint ||
    file.run !== key.run
  )
    return null;
  const caps = file.capabilities;
  if (typeof caps !== "object" || caps === null) return null;
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(provers) as ProvedKey[]) {
    const value = provers[name].parse((caps as Record<string, unknown>)[name]);
    if (value === undefined) return null;
    out[name] = value;
  }
  return out as unknown as ProvedCapabilities;
}

/**
 * Write the proofs atomically (a temp file renamed over the old one), so a
 * probe reading mid-write sees the old file or the new one, never half. A
 * failure to write is not fatal to the daemon: the probe just stays cold.
 */
export function writeProofCache(
  dir: string,
  key: ProofCacheKey,
  proved: ProvedCapabilities,
): boolean {
  const target = path.join(dir, PROOF_CACHE_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(
      temp,
      JSON.stringify({
        v: PROOF_CACHE_VERSION,
        fingerprint: key.fingerprint,
        run: key.run,
        capabilities: proved,
      }),
    );
    renameSync(temp, target);
    return true;
  } catch {
    return false;
  }
}

/** Where the proofs came from in this process. */
export type ProvedSource = "proved" | "cache" | "none";

export interface ResolvedProofs {
  readonly source: ProvedSource;
  /** Null only when `source` is "none": publish nothing. */
  readonly capabilities: ProvedCapabilities | null;
  /** Run modes: whether the cache was written for the probes to read. */
  readonly cacheWritten?: boolean;
}

export interface ResolveProofsOptions {
  readonly mode: DaemonMode;
  readonly env: Env;
  /** Null when the image has no fingerprint: nothing can be keyed. */
  readonly key: ProofCacheKey | null;
  readonly dir?: string;
  readonly provers?: Provers;
}

/**
 * A run mode PROVES and writes the cache; a readiness mode READS it and never
 * proves. See the header for why a cold readiness probe answers "none".
 */
export async function resolveProvedCapabilities(
  opts: ResolveProofsOptions,
): Promise<ResolvedProofs> {
  const dir = opts.dir ?? os.tmpdir();
  const provers = opts.provers ?? PROVED_CAPABILITIES;
  if (isReadinessMode(opts.mode)) {
    const cached = opts.key ? readProofCache(dir, opts.key, provers) : null;
    return cached
      ? { source: "cache", capabilities: cached }
      : { source: "none", capabilities: null };
  }
  const proved = await proveCapabilities(opts.env, provers);
  const cacheWritten = opts.key
    ? writeProofCache(dir, opts.key, proved)
    : false;
  return { source: "proved", capabilities: proved, cacheWritten };
}
