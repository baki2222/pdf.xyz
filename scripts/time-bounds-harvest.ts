/**
 * Harvests CI's measurements of every routed time bound into
 * `src/tests/time-bounds.calibration.json`.
 *
 *   pnpm exec tsx scripts/time-bounds-harvest.ts --last 30
 *
 * Hand-run in a PR, never on CI. It reads EVERY completed attempt of the
 * last N runs of ci.yml (`gh run list`, then `gh run view <id> --attempt
 * <a> --log` for each attempt) — never a hand-picked list of runs, and
 * never only the latest attempt: a failed first attempt that a rerun turned
 * green is exactly the value a passing-only window loses (critic P5; on
 * f8d48720 `gh run view <id> --log` read only attempt 2 of run
 * 44465012923, and its failure vanished). Each attempt is keyed
 * `<run>/<attempt>` with its own conclusion and unit-suite duration, and
 * the attempts read are recorded as the window every entry must lie in.
 *
 * A value counts only for the test body it was MEASURED on: each printed
 * record carries the hash of the test body that ran (computed by the helper
 * when it ran), which must equal the guard's hash of today's body.
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
  todayHashes,
} from "../src/tests/time-bounds-harvest-core";
import { scanSource } from "../src/tests/wall-clock-detector";

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW = "ci.yml";

function lastFrom(argv: string[]): number | undefined {
  const i = argv.indexOf("--last");
  const n = i === -1 ? NaN : Number(argv[i + 1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const gh = (args: string[]) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });

function main(): number {
  const last = lastFrom(process.argv.slice(2));
  if (last === undefined) {
    console.error("usage: tsx scripts/time-bounds-harvest.ts --last <N>");
    return 2;
  }
  const runs = JSON.parse(
    gh([
      "run",
      "list",
      "--workflow",
      WORKFLOW,
      "--status",
      "completed",
      "--limit",
      String(last),
      "--json",
      "databaseId,attempt",
    ]),
  ) as { databaseId: number; attempt: number }[];
  const todayHash = todayHashes(
    ROOT,
    (file) => readFileSync(file, "utf8"),
    scanSource,
  );
  // Every harvest starts empty: the window IS the data, so nothing from an
  // earlier, different window can survive into this one.
  let cal = { ...readCalibration(), runs: {}, entries: {} };
  const attempts: string[] = [];
  for (const run of runs) {
    for (let a = 1; a <= run.attempt; a++) {
      const key = `${run.databaseId}/${a}`;
      const conclusion = gh([
        "run",
        "view",
        String(run.databaseId),
        "--attempt",
        String(a),
        "--json",
        "conclusion",
        "-q",
        ".conclusion",
      ]).trim();
      const log = gh([
        "run",
        "view",
        String(run.databaseId),
        "--attempt",
        String(a),
        "--log",
      ]);
      const harvested = harvestLog(log);
      const { calibration, skipped } = mergeRun(
        cal,
        key,
        conclusion,
        harvested,
        todayHash,
      );
      cal = calibration;
      attempts.push(key);
      console.log(
        `attempt ${key} (${conclusion}): ${harvested.records.length} records, unit suite ${harvested.unitSuiteS ?? "?"} s`,
      );
      for (const s of skipped) console.log(`  skipped ${s}`);
    }
  }
  cal = { ...cal, window: { workflow: WORKFLOW, attempts } };
  writeFileSync(CALIBRATION_FILE, JSON.stringify(cal, null, 2) + "\n");
  console.log(
    `wrote ${path.relative(ROOT, CALIBRATION_FILE)}: ${attempts.length} attempts of the last ${runs.length} runs, ${Object.keys(cal.entries).length} entries`,
  );
  return 0;
}

process.exit(main());
