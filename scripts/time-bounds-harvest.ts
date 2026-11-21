/**
 * Harvests CI's measurements of every routed time bound into
 * `src/tests/time-bounds.calibration.json`.
 *
 *   pnpm exec tsx scripts/time-bounds-harvest.ts --runs 44409912518,44418885729
 *
 * Hand-run in a PR, never on CI. It reads each run's whole log with
 * `gh run view <id> --log`, failed runs as well as passing ones (the values
 * that failed are exactly what a passing-only window leaves out: critic
 * P5), keeps each run's unit-suite duration so a window of fast runners is
 * visible, and stamps every entry with the hash of its test body today, so
 * an edited test is uncalibrated until it is harvested again.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CALIBRATION_FILE,
  readCalibration,
} from "../src/tests/time-bound-calibration";
import {
  harvestLog,
  mergeRun,
  repoRelative,
} from "../src/tests/time-bounds-harvest-core";
import { scanSource } from "../src/tests/wall-clock-detector";

const ROOT = path.resolve(__dirname, "..");

function runsFrom(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++)
    if (argv[i] === "--runs" && argv[i + 1]) out.push(...argv[++i]!.split(","));
  return out.map((r) => r.trim()).filter(Boolean);
}

function main(): number {
  const runs = runsFrom(process.argv.slice(2));
  if (runs.length === 0) {
    console.error(
      "usage: tsx scripts/time-bounds-harvest.ts --runs <id>[,<id>...]",
    );
    return 2;
  }
  const hashes = new Map<string, Map<string, string>>();
  const hashOf = (rec: { id: string; file: string }) => {
    const file = repoRelative(rec.file);
    if (!hashes.has(file)) {
      const byId = new Map<string, string>();
      try {
        const text = readFileSync(path.join(ROOT, file), "utf8");
        for (const r of scanSource(text, file).routed)
          if (r.id) byId.set(r.id, r.bodyHash);
      } catch {
        // A file gone since the run: nothing to calibrate.
      }
      hashes.set(file, byId);
    }
    return hashes.get(file)!.get(rec.id);
  };
  let cal = readCalibration();
  for (const run of runs) {
    const conclusion = execFileSync(
      "gh",
      ["run", "view", run, "--json", "conclusion", "-q", ".conclusion"],
      { encoding: "utf8" },
    ).trim();
    const log = execFileSync("gh", ["run", "view", run, "--log"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    const harvested = harvestLog(log);
    const { calibration, skipped } = mergeRun(
      cal,
      run,
      conclusion,
      harvested,
      hashOf,
    );
    cal = calibration;
    console.log(
      `run ${run} (${conclusion}): ${harvested.records.length} records, unit suite ${harvested.unitSuiteS ?? "?"} s`,
    );
    for (const s of skipped) console.log(`  skipped ${s}`);
  }
  writeFileSync(CALIBRATION_FILE, JSON.stringify(cal, null, 2) + "\n");
  console.log(
    `wrote ${path.relative(ROOT, CALIBRATION_FILE)}: ${Object.keys(cal.entries).length} entries`,
  );
  return 0;
}

process.exit(main());
