/**
 * Does the worker image's HEALTHCHECK finish well inside its own timeout?
 * Run by `.github/workflows/container.yml` against the image it just built:
 *
 *   node scripts/healthcheck-budget.mjs --image pdfxyz-worker:ci
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The HEALTHCHECK runs `--dry-run-status` every minute under a timeout. When
 * that command built its heartbeat the way the daemon does, it awaited every
 * start-up proof — 21 Chromium print jobs since `translatePdfLanguages` — and
 * a probe that outruns its timeout gets the container marked unhealthy and
 * restarted in a loop. The probe now reads the daemon's cached proofs
 * (`src/lib/workers/daemon/proved-capabilities.ts`); this is the second,
 * independent bound on that: a real stopwatch in the real image.
 *
 * ── NOTHING HERE IS TYPED ───────────────────────────────────────────────────
 *
 *   - the TIMEOUT is read from the worker stage's HEALTHCHECK, and from every
 *     compose healthcheck that runs the same probe; the smallest wins;
 *   - the PROBE timed is that HEALTHCHECK's own CMD, exec array and all;
 *   - the WRITER that warms the cache is the worker stage's own CMD (the
 *     daemon the container runs; with nothing configured it proves, writes
 *     the cache and exits 2).
 * A missing or unparsable link is FATAL: a bound computed from nothing is a
 * pass computed from nothing.
 *
 * ── WARM MUST BE WARM ───────────────────────────────────────────────────────
 *
 * A timing is only of the thing it names if the probe's own log says so: the
 * cold run must report `heartbeat_proofs` source "none" and the warm one
 * "cache". A warm run that read no cache is a cold timing wearing the wrong
 * label, and fails as such.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The share of the timeout the probe may use. */
export const BUDGET_FRACTION = 2 / 3;

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** A Docker/compose duration ("30s", "1m30s", "500ms") in ms. Throws otherwise. */
export function parseDuration(raw) {
  const text = String(raw ?? "").trim();
  const re = /(\d+)(ms|s|m|h)/gy;
  let total = 0;
  let consumed = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    total += Number(match[1]) * UNIT_MS[match[2]];
    consumed = re.lastIndex;
  }
  if (text.length === 0 || consumed !== text.length || total <= 0)
    throw new Error(`unparsable duration: ${JSON.stringify(text)}`);
  return total;
}

/** Instructions of one stage, continuation lines joined, comments dropped. */
function instructions(lines) {
  const out = [];
  let cur = "";
  for (const line of lines) {
    if (cur === "" && /^\s*#/.test(line)) continue;
    if (/\\\s*$/.test(line)) {
      cur += line.replace(/\\\s*$/, " ");
      continue;
    }
    cur += line;
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The named stage's instructions. Throws when there is no such stage. */
export function stageInstructions(dockerfile, stage) {
  const lines = dockerfile.split(/\r?\n/);
  const starts = [];
  lines.forEach((l, i) => {
    if (/^FROM\s/i.test(l)) starts.push(i);
  });
  const at = starts.find((i) =>
    new RegExp(`\\sAS\\s+${stage}\\s*$`, "i").test(lines[i]),
  );
  if (at === undefined)
    throw new Error(`no "${stage}" stage in the Dockerfile`);
  const next = starts.find((i) => i > at) ?? lines.length;
  return instructions(lines.slice(at + 1, next));
}

function execArray(text, what) {
  let argv;
  try {
    argv = JSON.parse(text);
  } catch {
    throw new Error(`${what} is not an exec-form JSON array`);
  }
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.some((a) => typeof a !== "string")
  )
    throw new Error(`${what} is not an exec-form JSON array`);
  return argv;
}

/** The worker stage's HEALTHCHECK (timeout + CMD) and its own CMD. */
export function workerStage(dockerfile) {
  const ins = stageInstructions(dockerfile, "worker");
  const hcs = ins.filter((i) => /^HEALTHCHECK\s/i.test(i));
  if (hcs.length !== 1)
    throw new Error(`the worker stage has ${hcs.length} HEALTHCHECKs, not 1`);
  const hc = hcs[0];
  const timeout = /--timeout=(\S+)/.exec(hc)?.[1];
  if (!timeout) throw new Error("the worker HEALTHCHECK names no --timeout");
  const hcCmd = /\sCMD\s+(\[.*\])\s*$/.exec(hc)?.[1];
  if (!hcCmd) throw new Error("the worker HEALTHCHECK has no exec-form CMD");
  const cmds = ins.filter((i) => /^CMD\s/i.test(i));
  if (cmds.length === 0) throw new Error("the worker stage has no CMD");
  // Docker runs the LAST CMD of a stage.
  const daemon = cmds[cmds.length - 1].replace(/^CMD\s+/i, "");
  return {
    timeoutMs: parseDuration(timeout),
    probe: execArray(hcCmd, "the HEALTHCHECK CMD"),
    daemon: execArray(daemon, "the worker CMD"),
  };
}

/**
 * Timeouts of every compose healthcheck whose test runs `probeArg`. A
 * healthcheck that runs the probe but names no timeout is FATAL.
 */
export function composeTimeoutsMs(compose, probeArg) {
  const lines = compose.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)healthcheck:\s*$/.exec(line);
    if (!m) return;
    const indent = m[1].length;
    const block = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "" || /^\s*#/.test(l)) continue;
      if (/^(\s*)/.exec(l)[1].length <= indent) break;
      block.push(l);
    }
    const test = block.find((l) => /^\s*test:/.test(l)) ?? "";
    if (!test.includes(probeArg)) return;
    const timeout = block
      .map((l) => /^\s*timeout:\s*(\S+)/.exec(l)?.[1])
      .find(Boolean);
    if (!timeout)
      throw new Error("a compose healthcheck runs the probe with no timeout");
    out.push(parseDuration(timeout));
  });
  return out;
}

/** Everything the CI step needs, derived from the two files. */
export function planHealthcheckProbe(dockerfile, compose) {
  const stage = workerStage(dockerfile);
  // The probe's distinguishing flag, used to find the same probe in compose.
  const flag = stage.probe.find((a) => a.startsWith("--"));
  if (!flag) throw new Error("the HEALTHCHECK CMD passes no flag");
  const composeMs = composeTimeoutsMs(compose, flag);
  const timeoutMs = Math.min(stage.timeoutMs, ...composeMs);
  return {
    probe: stage.probe,
    daemon: stage.daemon,
    timeouts: { dockerfileMs: stage.timeoutMs, composeMs },
    timeoutMs,
    budgetMs: Math.floor(timeoutMs * BUDGET_FRACTION),
  };
}

const q = (a) => `'${a.replace(/'/g, `'\\''`)}'`;

/** The in-container sh script: optionally warm the cache, then time the probe. */
export function containerScript(plan, warm) {
  const probe = plan.probe.map(q).join(" ");
  const daemon = plan.daemon.map(q).join(" ");
  // Logs in a fresh directory: a log left by an earlier run must never be
  // read as this run's (a stale writer log once passed a warm run that had
  // skipped its writer).
  return [
    "d=$(mktemp -d) || exit 97",
    warm ? `${daemon} > "$d/writer.log" 2>&1` : ': > "$d/writer.log"',
    'echo "writer: $(grep -h \'"heartbeat_proofs"\' "$d/writer.log")"',
    "s=$(date +%s%N)",
    `${probe} > "$d/probe.log" 2>&1`,
    "c=$?",
    "e=$(date +%s%N)",
    'echo "probe_ms=$(( (e - s) / 1000000 )) probe_exit=$c"',
    'echo "probe: $(grep -h \'"heartbeat_proofs"\' "$d/probe.log")"',
  ].join("\n");
}

/** Read one container run's output. */
export function parseRun(stdout) {
  const ms = /probe_ms=(\d+)/.exec(stdout)?.[1];
  const exit = /probe_exit=(\d+)/.exec(stdout)?.[1];
  const probeLine = /^probe: (.*)$/m.exec(stdout)?.[1] ?? "";
  const source = /"source":"([a-z]+)"/.exec(probeLine)?.[1] ?? null;
  return {
    ms: ms === undefined ? null : Number(ms),
    exit: exit === undefined ? null : Number(exit),
    source,
  };
}

/** The verdict: problems, or none. Both timings must be what they claim. */
export function judge(plan, cold, warm) {
  const problems = [];
  for (const [name, run, want] of [
    ["cold", cold, "none"],
    ["warm", warm, "cache"],
  ]) {
    if (run.ms === null || run.ms <= 0)
      problems.push(`${name}: no timing was read`);
    if (run.source !== want)
      problems.push(
        `${name}: the probe reported proofs from ${JSON.stringify(run.source)}, not "${want}" — the timing is not of the ${name} path`,
      );
    if (run.ms !== null && run.ms > plan.budgetMs)
      problems.push(
        `${name}: ${run.ms} ms is over the budget of ${plan.budgetMs} ms (${Math.round(BUDGET_FRACTION * 100)}% of the ${plan.timeoutMs} ms timeout)`,
      );
  }
  return problems;
}

function runIn(image, script) {
  const r = spawnSync("docker", ["run", "--rm", image, "sh", "-c", script], {
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return r.stdout ?? "";
}

function main(argv) {
  const at = argv.indexOf("--image");
  const image = at >= 0 ? argv[at + 1] : undefined;
  const plan = planHealthcheckProbe(
    readFileSync("Dockerfile", "utf8"),
    readFileSync("docker-compose.worker.yml", "utf8"),
  );
  console.log(
    `timeout: ${plan.timeoutMs} ms (Dockerfile ${plan.timeouts.dockerfileMs} ms; compose ${plan.timeouts.composeMs.join(", ") || "none"}) -> budget ${plan.budgetMs} ms`,
  );
  console.log(`probe:  ${plan.probe.join(" ")}`);
  console.log(`writer: ${plan.daemon.join(" ")}`);
  if (!image) return 0;
  const coldOut = runIn(image, containerScript(plan, false));
  const warmOut = runIn(image, containerScript(plan, true));
  process.stdout.write(`--- cold ---\n${coldOut}--- warm ---\n${warmOut}`);
  const cold = parseRun(coldOut);
  const warm = parseRun(warmOut);
  console.log(
    `cold ${cold.ms} ms (source ${cold.source}, exit ${cold.exit}); warm ${warm.ms} ms (source ${warm.source}, exit ${warm.exit}); budget ${plan.budgetMs} ms`,
  );
  const problems = judge(plan, cold, warm);
  for (const p of problems) console.log(`::error::${p}`);
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.log(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
