import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { calibrationProblem, type Calibration } from "./time-bound-calibration";
import {
  ROOT,
  e2eCorpus,
  supportCorpus,
  vitestCorpus,
  type E2eCorpus,
  type SupportCorpus,
  type VitestCorpus,
} from "./wall-clock-corpus";
import {
  keyed,
  scanSource,
  type RoutedCall,
  type SleepMember,
  type WallClockMember,
} from "./wall-clock-detector";
import { laneOf, type Lane } from "./wall-clock-lanes";
import type { SeedEntry } from "./wall-clock-seed";
import { nativeCanvasTestFiles } from "./native-canvas";

/**
 * One pass over the derived corpus, shared by the guard
 * (`wall-clock-bounds.test.ts`) and the generator that writes its debt
 * lists (`scripts/wall-clock-debt.ts`), so the two cannot disagree about
 * what is in debt.
 */

export interface Audit {
  vitest: VitestCorpus;
  e2e: E2eCorpus;
  support: SupportCorpus;
  /** Every file scanned, repo-relative, sorted. */
  files: string[];
  comparisons: (WallClockMember & { n: number })[];
  routed: RoutedCall[];
  sleeps: (SleepMember & { n: number })[];
  parseErrors: string[];
  /** Collapsed whole-file text, for seed matching. */
  text: Map<string, string>;
}

export async function runAudit(): Promise<Audit> {
  const vitest = await vitestCorpus();
  const e2e = e2eCorpus();
  const entries = [
    ...new Set([...vitest.entries, ...vitest.setupFiles, ...e2e.listed]),
  ];
  const support = supportCorpus(entries);
  const files = [...new Set([...entries, ...support.modules])].sort();
  const comparisons: WallClockMember[] = [];
  const routed: RoutedCall[] = [];
  const sleeps: SleepMember[] = [];
  const parseErrors: string[] = [];
  const text = new Map<string, string>();
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = readFileSync(path.join(ROOT, file), "utf8");
    text.set(file, source.replace(/\s+/g, " "));
    const r = scanSource(source, file);
    comparisons.push(...r.comparisons);
    routed.push(...r.routed);
    sleeps.push(...r.sleeps);
    parseErrors.push(...r.parseErrors);
  }
  return {
    vitest,
    e2e,
    support,
    files,
    comparisons: keyed(comparisons),
    routed,
    sleeps: keyed(sleeps),
    parseErrors,
    text,
  };
}

export type DebtKind = "raw" | "routed" | "seed";

export interface DebtEntry {
  lane: Lane;
  kind: DebtKind;
  file: string;
  n: number;
  snippet: string;
}

export interface SleepDebtEntry {
  lane: Lane;
  file: string;
  n: number;
  snippet: string;
}

export type ExemptReason = "config-relation" | "injected-clock" | "floor";

export interface ExemptEntry {
  file: string;
  snippet: string;
  reason: ExemptReason;
  why: string;
}

export const debtKey = (e: { file: string; snippet: string; n: number }) =>
  `${e.file}\u0000${e.snippet}\u0000${e.n}`;

export type SeedStatus =
  | { seed: SeedEntry; status: "detected" | "routed" | "undetected" }
  | { seed: SeedEntry; status: "stale"; why: string };

export function seedStatus(audit: Audit, seed: SeedEntry): SeedStatus {
  const inFile = audit.comparisons.filter((m) => m.file === seed.file);
  if (
    inFile.some(
      (m) =>
        m.snippet.includes(seed.code) ||
        seed.code.includes(m.snippet) ||
        m.lines.includes(seed.code),
    )
  )
    return { seed, status: "detected" };
  const text = audit.text.get(seed.file);
  if (text === undefined)
    return {
      seed,
      status: "stale",
      why: existsSync(path.join(ROOT, seed.file))
        ? "its file is not in the corpus"
        : "its file is gone",
    };
  if (text.includes(seed.code)) return { seed, status: "undetected" };
  if (audit.routed.some((r) => r.file === seed.file))
    return { seed, status: "routed" };
  return {
    seed,
    status: "stale",
    why: "its comparison is gone and nothing in the file is routed",
  };
}

export interface Required {
  debt: DebtEntry[];
  sleepDebt: SleepDebtEntry[];
  /** Exempt entries matching no member. */
  exemptUnmatched: ExemptEntry[];
  seeds: SeedStatus[];
}

const byKey = <T extends { file: string; snippet: string; n: number }>(
  a: T,
  b: T,
) =>
  a.file.localeCompare(b.file) ||
  a.snippet.localeCompare(b.snippet) ||
  a.n - b.n;

/** What the debt lists must contain for the tree as it is. */
export function requiredDebt(
  audit: Audit,
  exempt: readonly ExemptEntry[],
  calibration: Calibration,
  seeds: readonly SeedEntry[],
): Required {
  const native = new Set(nativeCanvasTestFiles(ROOT));
  const isNative = (f: string) => native.has(f);
  const isExempt = (m: { file: string; snippet: string }) =>
    exempt.some((e) => e.file === m.file && e.snippet === m.snippet);
  const debt: DebtEntry[] = [];
  for (const m of audit.comparisons)
    if (m.direction === "ceiling" && !isExempt(m))
      debt.push({
        lane: laneOf(m.file, "comparison", isNative),
        kind: "raw",
        file: m.file,
        n: m.n,
        snippet: m.snippet,
      });
  for (const r of keyed(audit.routed))
    if (calibrationProblem(r, calibration) !== null)
      debt.push({
        lane: laneOf(r.file, "comparison", isNative),
        kind: "routed",
        file: r.file,
        n: r.n,
        snippet: r.snippet,
      });
  const statuses = seeds.map((s) => seedStatus(audit, s));
  for (const s of statuses)
    if (s.status === "undetected")
      debt.push({
        lane: laneOf(s.seed.file, "comparison", isNative),
        kind: "seed",
        file: s.seed.file,
        n: 0,
        snippet: s.seed.code,
      });
  const sleepDebt = audit.sleeps.map((s) => ({
    lane: laneOf(s.file, "sleep", isNative),
    file: s.file,
    n: s.n,
    snippet: s.snippet,
  }));
  return {
    debt: debt.sort(byKey),
    sleepDebt: sleepDebt.sort(byKey),
    exemptUnmatched: exempt.filter(
      (e) =>
        !audit.comparisons.some(
          (m) => m.file === e.file && m.snippet === e.snippet,
        ),
    ),
    seeds: statuses,
  };
}

/** A template literal body, safe for any snippet. */
const escapeTemplate = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

/** The generated debt module: sorted, one entry per line, TAB-separated. */
export function serializeDebt(
  entries: readonly DebtEntry[],
  header: string,
): string {
  const rows = entries.map(
    (e) => `${e.lane}\t${e.kind}\t${e.file}\t${e.n}\t${e.snippet}`,
  );
  return `${header}
export const WALL_CLOCK_DEBT_CEILING = ${entries.length};

/** lane, kind, file, occurrence index, collapsed snippet — one per line. */
export const WALL_CLOCK_DEBT_TSV = \`
${rows.map(escapeTemplate).join("\n")}
\`;
`;
}

export function serializeSleepDebt(
  entries: readonly SleepDebtEntry[],
  header: string,
): string {
  const rows = entries.map((e) => `${e.lane}\t${e.file}\t${e.n}\t${e.snippet}`);
  return `${header}
export const FIXED_SLEEP_DEBT_CEILING = ${entries.length};

/** lane, file, occurrence index, collapsed snippet — one per line. */
export const FIXED_SLEEP_DEBT_TSV = \`
${rows.map(escapeTemplate).join("\n")}
\`;
`;
}

export function parseDebt(tsv: string): DebtEntry[] {
  return tsv
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const [lane, kind, file, n, ...rest] = l.split("\t");
      return {
        lane: lane as Lane,
        kind: kind as DebtKind,
        file: file!,
        n: Number(n),
        snippet: rest.join("\t"),
      };
    });
}

export function parseSleepDebt(tsv: string): SleepDebtEntry[] {
  return tsv
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const [lane, file, n, ...rest] = l.split("\t");
      return {
        lane: lane as Lane,
        file: file!,
        n: Number(n),
        snippet: rest.join("\t"),
      };
    });
}
