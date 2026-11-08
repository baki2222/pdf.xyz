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
import { RESULT_PREFIX } from "./report";

export type BoundedOutcome =
  | { kind: "settled"; value: unknown; ms: number }
  | { kind: "hang" | "memory" | "internal"; message: string; ms: number };

const RESULT = new RegExp(`${RESULT_PREFIX}(.*)`);

export function runBounded(
  childScript: string,
  args: readonly string[],
  boundMs: number,
  options: { maxOldSpaceMb?: number } = {},
): Promise<BoundedOutcome> {
  return new Promise((resolve) => {
    const t0 = Date.now();
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
    const timer = setTimeout(() => child.kill("SIGKILL"), boundMs);
    child.on("exit", () => {
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const line = stdout.match(RESULT);
      if (line) {
        resolve({ kind: "settled", value: JSON.parse(line[1]!), ms });
        return;
      }
      const died =
        /heap out of memory|Allocation failed|Array buffer allocation/i.test(
          stderr,
        );
      resolve({
        kind: ms >= boundMs ? "hang" : died ? "memory" : "internal",
        message: ms >= boundMs ? `killed at ${boundMs} ms` : stderr.slice(-600),
        ms,
      });
    });
  });
}
