// Run one hostile case in a CHILD PROCESS with a hard wall-clock kill.
//
// pdf-lib (and our own parsers) work synchronously inside a promise, so a
// parser that loops forever blocks the event loop: a vitest per-test timeout
// can never fire, and a regressed hang would stall the whole CI job instead of
// failing one test. A child process can always be killed, so a hang becomes an
// ordinary red result ("hang", with the bound it exceeded).
//
// Protocol: the child script prints exactly one line `@@RESULT <json>` when it
// settles, through `reportResult` in ./report (never imported from here: a
// child that imported this spawner would join the Node-only closure). No such
// line before the bound is a hang; a heap/allocation failure on stderr is
// "memory"; any other exit without the line is "internal".
//
// The child runs under `node --import tsx`, the same loader the matrix used
// (src/tests/hostile on test/hostile-matrix). Keep child scripts tiny: import
// the engine, build the fixture, call ONE entry point, print the line.
import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { RESULT_PREFIX } from "./report";

export type BoundedOutcome =
  | { kind: "settled"; value: unknown; ms: number }
  | { kind: "hang" | "memory" | "internal"; message: string; ms: number };

const RESULT = new RegExp(`${RESULT_PREFIX}(.*)`);

/** The share of its kill a child may use before the line becomes a warning. */
export const KILL_HEADROOM_SHARE = 0.5;

/**
 * The `[kill-headroom]` line for one child (lane 2 of the CI-flake audit,
 * pdfjs-guard-bounds L215). The kill is the bound that binds every child
 * test, and the vitest reporter (`timeout-headroom.ts`) reads only vitest's
 * own timeout, which every hostile test sets ABOVE its kills: a child at
 * 46% of its kill read 12-37% there, so a kill drifting toward red gave no
 * warning. Printed for every child, so the harvest has the spread and not
 * only the tail; `warn` when a child that was NOT killed used more than
 * {@link KILL_HEADROOM_SHARE} of its kill (a hang is at 100% by definition
 * and is red on its own).
 */
export function killHeadroom(
  label: string,
  outcome: Pick<BoundedOutcome, "kind" | "ms">,
  boundMs: number,
): { line: string; warn: boolean } {
  const share = outcome.ms / boundMs;
  const warn = outcome.kind !== "hang" && share > KILL_HEADROOM_SHARE;
  return {
    line: `[kill-headroom] ${label}: ${outcome.kind} in ${Math.round(outcome.ms)} ms of a ${boundMs} ms kill (${Math.round(share * 100)}%)`,
    warn,
  };
}

/** The child and its arguments, without the temp directories of fixture paths. */
const labelOf = (childScript: string, args: readonly string[]) =>
  [childScript, ...args]
    .map((a) => (/[\\/]/.test(a) ? path.basename(a) : a))
    .join(" ")
    .slice(0, 160);

export function runBounded(
  childScript: string,
  args: readonly string[],
  boundMs: number,
  options: { maxOldSpaceMb?: number } = {},
): Promise<BoundedOutcome> {
  return new Promise((resolve) => {
    // performance.now(), monotonic like the kill timer below: a wall-clock
    // step (NTP slew) can no longer move a child across its own bound.
    const t0 = performance.now();
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${options.maxOldSpaceMb ?? 1024}`,
        "--import",
        "tsx",
        childScript,
        ...args,
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    // A hang is "the kill fired", recorded where it fires: classifying it
    // by elapsed time let a slow OOM or crash that ended near the bound
    // read as a hang (bounded.test L27).
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, boundMs);
    const settle = (outcome: BoundedOutcome) => {
      const { line, warn } = killHeadroom(
        labelOf(childScript, args),
        outcome,
        boundMs,
      );
      console.log(line);
      if (warn && process.env.CI)
        console.log(`::warning title=kill headroom::${line}`);
      resolve(outcome);
    };
    child.on("exit", () => {
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      const line = stdout.match(RESULT);
      if (line) {
        settle({ kind: "settled", value: JSON.parse(line[1]!), ms });
        return;
      }
      const died =
        /heap out of memory|Allocation failed|Array buffer allocation/i.test(
          stderr,
        );
      settle({
        kind: killed ? "hang" : died ? "memory" : "internal",
        message: killed ? `killed at ${boundMs} ms` : stderr.slice(-600),
        ms,
      });
    });
  });
}
