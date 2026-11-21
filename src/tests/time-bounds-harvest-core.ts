import {
  observedValue,
  parseTimeBoundLines,
  type TimeBound,
} from "./time-bound-core";
import type { Calibration, CalibrationEntry } from "./time-bound-calibration";

/**
 * The pure half of `scripts/time-bounds-harvest.ts`: read one CI run's log,
 * and fold what it measured into the calibration. Kept apart so a unit test
 * can hold it to a planted log (the script itself only adds `gh`).
 */

export interface HarvestedRun {
  records: TimeBound[];
  /** The unit suite's own `Duration` line, in seconds, when the log has one. */
  unitSuiteS?: number;
}

/**
 * Every `[time-bound]` record in a `gh run view --log` text, and the unit
 * suite's duration: the longest vitest summary line `Duration 1234.56s` in
 * the verify job ("Typecheck · Lint · Test · Build"). gh prefixes each line
 * with the job and step names but prints the step as "UNKNOWN STEP" (seen
 * on run 44418885729), and the line carries ANSI colour codes, so neither
 * the step name nor a bare regex finds it. The bundle step's own vitest run
 * (about 23 s) is the other Duration in that job, hence the longest.
 */
export function harvestLog(text: string): HarvestedRun {
  let unitSuiteS: number | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.startsWith("Typecheck")) continue;
    // gh writes the escape as the two characters "^[" when not on a TTY.
    const line = raw.replace(/(?:\u001b|\^\[)\[[0-9;]*m/g, "");
    const m = /\bDuration\s+([\d.]+)s\b/.exec(line);
    if (m) unitSuiteS = Math.max(unitSuiteS ?? 0, Number(m[1]));
  }
  return {
    records: parseTimeBoundLines(text),
    ...(unitSuiteS === undefined ? {} : { unitSuiteS }),
  };
}

/** The repo-relative path in a runner's absolute path (`/home/runner/work/x/x/src/...`). */
export function repoRelative(file: string): string {
  const f = file.replace(/\\/g, "/");
  const m = /(?:^|\/)((?:src|e2e)\/.*)$/.exec(f);
  return m ? m[1]! : f;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

type StoredEntry = CalibrationEntry & { perRun?: Record<string, number> };

/**
 * Folds one attempt (`runId` is `<run>/<attempt>`) into the calibration.
 * Per id, the attempt's worst value is kept (for a ratio, the ratio) —
 * counted ONLY when the record's own `bodyHash` (computed when the test ran)
 * equals today's (`todayHash`): a number measured on another test body
 * certifies nothing about this one. An entry whose body changed starts again.
 */
export function mergeRun(
  cal: Calibration,
  runId: string,
  conclusion: string,
  run: HarvestedRun,
  todayHash: (rec: TimeBound) => string | undefined,
): { calibration: Calibration; skipped: string[] } {
  const next: Calibration = {
    ...cal,
    runs: {
      ...cal.runs,
      [runId]: {
        conclusion,
        ...(run.unitSuiteS === undefined ? {} : { unitSuiteS: run.unitSuiteS }),
      },
    },
    entries: { ...cal.entries },
  };
  const skipped: string[] = [];
  const worst = new Map<string, { rec: TimeBound; value: number }>();
  for (const rec of run.records) {
    const value = observedValue(rec);
    const w = worst.get(rec.id);
    if (!w || value > w.value) worst.set(rec.id, { rec, value });
  }
  for (const [id, { rec, value }] of worst) {
    const bodyHash = todayHash(rec);
    if (!bodyHash) {
      skipped.push(
        `${id}: no routed call with this id in ${repoRelative(rec.file) || "(no file)"} today`,
      );
      continue;
    }
    if (!rec.bodyHash) {
      skipped.push(
        `${id}: the record printed no body hash (a helper older than the hash), so what it measured is unknown`,
      );
      continue;
    }
    if (rec.bodyHash !== bodyHash) {
      skipped.push(
        `${id}: measured on test body ${rec.bodyHash}, today's is ${bodyHash}`,
      );
      continue;
    }
    const old = next.entries[id] as StoredEntry | undefined;
    const perRun = {
      ...(old && old.bodyHash === bodyHash ? (old.perRun ?? {}) : {}),
      [runId]: value,
    };
    const values = Object.values(perRun);
    const entry: StoredEntry = {
      kind: rec.kind,
      n: values.length,
      ciMax: Math.max(...values),
      ciP50: median(values),
      runs: Object.keys(perRun).sort(),
      source: "time-bound lines",
      bodyHash,
      perRun,
    };
    next.entries[id] = entry;
  }
  return { calibration: next, skipped };
}

/**
 * The guard's body hash of each routed call, read from today's tree under
 * `root`: what the harvest compares a record's own hash against. One
 * function for the script and the chain test, so the chain proves the
 * script's own lookup.
 */
export function todayHashes(
  root: string,
  read: (file: string) => string,
  scan: (
    text: string,
    file: string,
  ) => { routed: { id: string | null; bodyHash: string }[] },
): (rec: Pick<TimeBound, "id" | "file">) => string | undefined {
  const byFile = new Map<string, Map<string, string>>();
  return (rec) => {
    const file = repoRelative(rec.file);
    if (!file) return undefined;
    if (!byFile.has(file)) {
      const byId = new Map<string, string>();
      try {
        for (const r of scan(read(`${root}/${file}`), file).routed)
          if (r.id) byId.set(r.id, r.bodyHash);
      } catch {
        // A file gone since the run: nothing to calibrate.
      }
      byFile.set(file, byId);
    }
    return byFile.get(file)!.get(rec.id);
  };
}
