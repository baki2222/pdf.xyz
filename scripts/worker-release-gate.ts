#!/usr/bin/env tsx
/**
 * pdf.xyz secure-worker release readiness gate — the one-command, offline pre-deploy gate.
 *
 * `pnpm worker:release-gate` RUNS the existing safe, offline worker checks as subprocesses
 * (deploy:examples:check, worker:smoke, worker:engines, worker:ops-check / worker:ops-bundle /
 * worker:cleanup-pipeline over committed fixtures, and worker:daemon --lifecycle-verify), reads ONLY
 * each one's exit code, and folds them into ONE stable PASS/WARN/FAIL release-readiness report. It is
 * deliberately a thin shell over unit-tested, node-free modules under `src/lib/workers/release-gate/`;
 * this file only reads argv, spawns the checks behind the runner's injected seam, writes the output,
 * and exits.
 *
 * Like the daemon and the other worker CLIs, it is NEVER imported by the web app (it lives outside
 * `src/` and is invoked only as `pnpm worker:release-gate`).
 *
 * Honesty & privacy:
 *  - It is a PRE-DEPLOY EVIDENCE gate, not a new proof and not the promotion. It makes NO network
 *    call, reads NO provider export/secret/bucket, and deletes/uploads/mutates nothing. Its explicit
 *    caveats say so.
 *  - Its output is content-free by construction: it reads only each check's process EXIT CODE and
 *    discards every byte of the check's stdout/stderr at the runner's trust boundary, so no filename,
 *    key, path, secret, or document content can enter a report.
 *  - It exits with the documented ladder (0 pass / 2 unknown / 3 warn / 4 fail) for the composite
 *    verdict and a distinct 1 for CLI misuse (a bad flag / unknown scope id), so a misconfigured gate
 *    is never mistaken for a ready or not-ready build.
 *
 * Run it in worker infrastructure alongside (never inside) the web app, e.g.:
 *   pnpm worker:release-gate                       # the full gate, JSON to stdout
 *   pnpm worker:release-gate --text                # an operator-friendly pre-deploy checklist
 *   pnpm worker:release-gate --json > release.json # a CI artifact / release record
 */

import {
  RELEASE_GATE_EXIT,
  RELEASE_GATE_USAGE,
  parseReleaseGateArgs,
  runReleaseGate,
  type ProbeResult,
  type ReleaseCheckSpec,
  type ReleaseGateProvider,
} from "@/lib/workers/release-gate";
import { resolvePnpmInvocation } from "@/lib/workers/exec-pnpm";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/**
 * Per-check wall-clock budget. Generous because `worker:smoke` internally spawns the daemon many
 * times; every other composed check returns in a second or two. A check that exceeds this is
 * surfaced as an indeterminate `unknown`, never a false pass.
 */
const PER_CHECK_TIMEOUT_MS = 180_000;

/** Hard cap on captured output. We discard the output regardless, so this only prevents an OOM. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Run one check's command as a subprocess and reduce it to a bounded {@link ProbeResult}. The
 * command + args come from the internal catalog (committed fixture paths / flags only). The host
 * environment is passed through UNCHANGED so `worker:engines` reflects the real engines on this
 * build host; the fixture-driven checks ignore the environment entirely.
 */
async function runCheck(spec: ReleaseCheckSpec): Promise<ProbeResult> {
  const { command, prefixArgs } = resolvePnpmInvocation();
  const r = spawnSync(
    command,
    [...prefixArgs, "-s", spec.script, ...spec.args],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: PER_CHECK_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    },
  );
  const err = r.error as (Error & { code?: string }) | undefined;
  const timedOut = err?.code === "ETIMEDOUT";
  return {
    exitCode: typeof r.status === "number" ? r.status : null,
    // Captured but never forwarded — the runner's trust boundary drops these; they exist only so a
    // check's output can be examined for a signal count (it is not) and to model a real spawn.
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" ? r.stderr : "",
    timedOut,
    // Any non-timeout spawn error (a missing binary, an output overflow) is an indeterminate check.
    spawnError: err !== undefined && !timedOut,
  };
}

const provider: ReleaseGateProvider = {
  runCheck,
  now: () => new Date().toISOString(),
};

async function main(): Promise<number> {
  const parsed = parseReleaseGateArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${RELEASE_GATE_USAGE}\n`);
    return RELEASE_GATE_EXIT.USAGE;
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${RELEASE_GATE_USAGE}\n`);
    return RELEASE_GATE_EXIT.PASS;
  }

  const { output, exitCode } = await runReleaseGate(parsed.args, provider);
  if (parsed.args.outputPath !== undefined) {
    try {
      writeFileSync(parsed.args.outputPath, output, "utf8");
    } catch {
      // Never echo the destination path: it may be an operator-local path.
      process.stderr.write(
        `Could not write release gate output.\n\n${RELEASE_GATE_USAGE}\n`,
      );
      return RELEASE_GATE_EXIT.USAGE;
    }
  } else {
    process.stdout.write(output);
  }
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    // Never print the raw error — it could carry a message we must not log. A genuine internal fault
    // means we could not complete the gate → UNKNOWN (the gate cannot certify what it could not run).
    process.exit(RELEASE_GATE_EXIT.UNKNOWN);
  });
