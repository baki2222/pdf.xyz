/**
 * The shared core of the wall-clock instrument: the record a timing check
 * leaves behind, the one line it prints, and the report both reporters
 * (vitest's `TimeoutHeadroomReporter`, Playwright's `e2e/headroom-reporter.ts`)
 * print from those records at the end of a run.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The CI flake audit of 2026-11-19 found 371 checks that can fail a test on
 * how fast the runner is, and no instrument that showed how close any of them
 * ran to its bound: a ratio at 1.34x headroom printed the same green tick as
 * one at 10x. Every check that compares a time now routes through
 * `src/tests/time-bound.ts` (vitest) or `e2e/time-bound.ts` (Playwright),
 * which record what they measured on the PASS path and the FAIL path alike —
 * CLAUDE.md rule 3: the failure shape carries the measurement, or the run
 * that most needed the number is the one without it.
 *
 * Dependency-free on purpose, and CommonJS-safe (no `import.meta`, no
 * top-level await): `vitest.config.ts` imports it through the reporter, and
 * so does Playwright's CommonJS loader through `e2e/headroom-reporter.ts`
 * (`src/tests/e2e-cjs-load.test.ts` compiles it the way that loader does).
 */

/** A bound is reported once it has used more than this share of its margin. */
export const BOUND_HEADROOM_RATIO = 0.5;

export type TimeBoundKind = "ceiling" | "ratio" | "floor";
export type TimeBoundMode = "assert" | "measure";

/** What one timing check measured, against what, in which test. */
export interface TimeBound {
  /** A string literal at the call site (the guard holds it to that). */
  id: string;
  /** Per-instance data for a check written once and run many times. */
  instance?: string;
  kind: TimeBoundKind;
  /** ms for a ceiling or floor; the numerator for a ratio. */
  measured: number;
  /** ms for a ceiling or floor; the largest ratio allowed for a ratio. */
  bound: number;
  /** The denominator of a ratio, in the same unit as `measured`. */
  control?: number;
  mode: TimeBoundMode;
  /** Measure mode only: the speed-independent assertion that still catches the defect. */
  witness?: string;
  /** Free text kept beside the numbers (e.g. both attempts of a best-of-two). */
  detail?: string;
  file: string;
  test: string;
  line: number;
}

/** One testing-library wait (`findBy*`, `waitFor`), timed by `src/tests/wait-recorder.ts`. */
export interface WaitRecord {
  ms: number;
  file: string;
  line: number;
  column: number;
  /** testing-library's `asyncUtilTimeout` when the wait ran. */
  defaultTimeoutMs: number;
  /** The wait threw (timed out, or its callback kept failing). */
  timedOut: boolean;
  test?: string;
}

/**
 * The share of its margin a bound used: measured/bound for a ceiling,
 * (a/b)/bound for a ratio, bound/measured for a floor. Over 0.5 is less than
 * the 2x margin the property (design 2) asks for; over 1 is a failure.
 */
export function shareOf(
  b: Pick<TimeBound, "kind" | "measured" | "bound" | "control">,
): number {
  if (b.kind === "ratio") return b.measured / (b.control as number) / b.bound;
  if (b.kind === "floor")
    return b.measured === 0 ? Infinity : b.bound / b.measured;
  return b.measured / b.bound;
}

/** The value a ratio record compares, or the ms of the others. */
export function observedValue(
  b: Pick<TimeBound, "kind" | "measured" | "control">,
): number {
  return b.kind === "ratio" ? b.measured / (b.control as number) : b.measured;
}

const pct = (share: number) =>
  Number.isFinite(share) ? `${Math.round(share * 100)}%` : "inf%";
const round = (n: number) =>
  Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;

/** "412 ms of 1000 ms", "1.53x of 2.2x (612 ms / 400 ms)", "floor 150 ms, measured 412 ms". */
export function describeBound(
  b: Pick<TimeBound, "kind" | "measured" | "bound" | "control">,
): string {
  if (b.kind === "ratio")
    return `${round(observedValue(b))}x of ${b.bound}x (${round(b.measured)} / ${round(b.control as number)})`;
  if (b.kind === "floor")
    return `floor ${round(b.bound)} ms, measured ${round(b.measured)} ms`;
  return `${round(b.measured)} ms of ${round(b.bound)} ms`;
}

/**
 * The line every check prints, on a pass and a failure, in the grep
 * convention the hostile suites started (`[time-bound] <what>`), with the
 * whole record after ` json=` so `scripts/time-bounds-harvest.ts` reads the
 * numbers back out of a CI log instead of re-parsing prose.
 */
export function timeBoundLine(b: TimeBound): string {
  const name = b.instance ? `${b.id} ${b.instance}` : b.id;
  const mode = b.mode === "measure" ? " [measure]" : "";
  const detail = b.detail ? ` — ${b.detail}` : "";
  return `[time-bound] ${name}: ${describeBound(b)} (${pct(shareOf(b))})${mode}${detail} json=${JSON.stringify(b)}`;
}

/** Every record printed in `text` (a log), in order; lines without a record are skipped. */
export function parseTimeBoundLines(text: string): TimeBound[] {
  const out: TimeBound[] = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("[time-bound] ");
    if (at === -1) continue;
    const j = line.indexOf(" json={", at);
    if (j === -1) continue;
    try {
      const rec = JSON.parse(line.slice(j + " json=".length)) as TimeBound;
      if (typeof rec.id === "string" && typeof rec.measured === "number")
        out.push(rec);
    } catch {
      // A line cut by the log viewer: not a record.
    }
  }
  return out;
}

/** `%`, CR and LF are the characters a workflow-command message must escape. */
export function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** One row of a headroom block. */
export interface HeadroomItem {
  share: number;
  /** "<file> > <test> > <id>: 488 ms of 800 ms" */
  text: string;
  file?: string;
  line?: number;
}

/**
 * The rows over the threshold, largest share first, then (on GitHub) one
 * warning annotation each at the file and line. Shared by both reporters so
 * the two halves of the suite read the same way.
 */
export function headroomLines(
  items: readonly HeadroomItem[],
  opts: { github: boolean; title: string; ratio?: number },
): string[] {
  const ratio = opts.ratio ?? BOUND_HEADROOM_RATIO;
  const lines: string[] = [];
  for (const item of [...items]
    .filter((i) => i.share > ratio)
    .sort((a, b) => b.share - a.share)) {
    lines.push(`  ${pct(item.share).padStart(4)}  ${item.text}`);
    if (opts.github)
      lines.push(
        `::warning ${item.file ? `file=${escapeProperty(item.file)},` : ""}${item.line ? `line=${item.line},` : ""}title=${escapeProperty(opts.title)}::${escapeData(item.text)}`,
      );
  }
  return lines;
}

const repoPath = (file: string, root: string) => {
  const f = file.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/?$/, "/");
  return f.startsWith(r) ? f.slice(r.length) : f;
};

/**
 * The time-bound block: assert-mode bounds over half their margin, then the
 * measure-mode ones (recorded, never asserted), each with its worst share.
 */
export function timeBoundReport(
  bounds: readonly TimeBound[],
  opts: { github: boolean; root: string },
): string[] {
  const asserted = bounds.filter((b) => b.mode === "assert");
  const measured = bounds.filter((b) => b.mode === "measure");
  const item = (b: TimeBound): HeadroomItem => ({
    share: shareOf(b),
    text: `${repoPath(b.file, opts.root)} > ${b.test} > ${b.instance ? `${b.id} ${b.instance}` : b.id}: ${describeBound(b)}`,
    file: repoPath(b.file, opts.root),
    line: b.line,
  });
  const worst = (list: readonly TimeBound[]) =>
    list.length === 0
      ? "none"
      : (() => {
          const w = [...list].sort((a, b) => shareOf(b) - shareOf(a))[0]!;
          return `${w.id}${w.instance ? ` ${w.instance}` : ""} ${pct(shareOf(w))}`;
        })();
  const over = asserted.filter((b) => shareOf(b) > BOUND_HEADROOM_RATIO);
  return [
    `time-bound headroom: ${over.length} of ${asserted.length} wall-clock bounds used more than ${BOUND_HEADROOM_RATIO * 100}% of their bound (worst: ${worst(asserted)})`,
    ...headroomLines(asserted.map(item), {
      github: opts.github,
      title: "Time bound near its limit",
    }),
    `time-bound measure-only: ${measured.length} bounds recorded, not asserted (worst vs proposed: ${worst(measured)})`,
    ...headroomLines(measured.map(item), {
      github: false,
      title: "Measure-only bound",
    }),
  ];
}

/** What a call site says about its own timeout, read from its source text. */
export type CallTimeout =
  | { kind: "default" }
  | { kind: "explicit"; ms: number }
  | { kind: "unresolved"; text: string };

/**
 * The `timeout:` a call passes, read from the source at (line, column):
 * from there to the end of the call's statement, with brackets balanced.
 * A numeric literal is read as is; an identifier is resolved to a numeric
 * `const` in the same file; anything else is "unresolved" and is reported
 * as such — never silently compared against the default (critic P6: a
 * recorder that drops the calls with explicit timeouts leaves every one of
 * them with no headroom check at all).
 */
export function callTimeoutAt(
  source: string,
  line: number,
  column = 1,
  opts: { backToExpect?: boolean } = {},
): CallTimeout {
  const lines = source.split(/\r?\n/);
  if (line < 1 || line > lines.length) return { kind: "default" };
  let at = 0;
  for (let i = 0; i < line - 1; i++) at += lines[i]!.length + 1;
  // Normalise CRLF offsets by working on the LF-joined text.
  const text = lines.join("\n");
  at += Math.max(0, column - 1);
  // Playwright places an expect step at its MATCHER, which may sit lines
  // below the `expect.poll(fn, { timeout })` that carries the timeout.
  if (opts.backToExpect) {
    const back = text.lastIndexOf("expect", at);
    if (back !== -1 && at - back < 800) at = back;
  }
  let depth = 0;
  let end = text.length;
  let opened = false;
  for (let i = at; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const close = text.indexOf(ch, i + 1);
      if (close === -1) break;
      i = close;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      opened = true;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      // The call ends where its brackets close and no `.next(` chain follows.
      if (
        depth < 0 ||
        (opened &&
          depth === 0 &&
          !/^\s*[.?([]/.test(text.slice(i + 1, i + 200)))
      ) {
        end = i + 1;
        break;
      }
    } else if (ch === ";" && depth <= 0) {
      end = i;
      break;
    }
  }
  const call = text.slice(at, end);
  const m = /\btimeout\s*:\s*([A-Za-z_$][\w$.]*|[\d_]+(?:\.\d+)?)/.exec(call);
  if (!m) {
    if (/\btimeout\b/.test(call))
      return { kind: "unresolved", text: "timeout (shorthand)" };
    return { kind: "default" };
  }
  const value = m[1]!;
  if (/^[\d_.]+$/.test(value))
    return { kind: "explicit", ms: Number(value.replace(/_/g, "")) };
  const decl = new RegExp(
    `\\b(?:const|let)\\s+${value.replace(/[$.]/g, "\\$&")}\\s*(?::\\s*\\w+\\s*)?=\\s*([\\d_]+)\\s*[;,\\n]`,
  ).exec(text);
  if (decl) return { kind: "explicit", ms: Number(decl[1]!.replace(/_/g, "")) };
  return { kind: "unresolved", text: `timeout: ${value}` };
}

/**
 * The wait block (testing-library on the vitest side). Each wait is held to
 * the timeout it RAN under: its own `timeout:` when the call site passes
 * one, testing-library's default otherwise. The worst five are always
 * printed, over the threshold or not, so creep under a raised default stays
 * visible (design 3c).
 */
export function waitReport(
  waits: readonly WaitRecord[],
  opts: {
    github: boolean;
    root: string;
    source: (file: string) => string | undefined;
  },
): string[] {
  const defaultMs = waits[0]?.defaultTimeoutMs ?? 1000;
  const judged = waits.map((w) => {
    const src = opts.source(w.file);
    const t =
      src === undefined
        ? ({ kind: "default" } as CallTimeout)
        : callTimeoutAt(src, w.line, w.column);
    const budget =
      t.kind === "explicit"
        ? t.ms
        : t.kind === "default"
          ? w.defaultTimeoutMs
          : undefined;
    return { w, t, budget, share: budget ? w.ms / budget : NaN };
  });
  const site = (w: WaitRecord) => `${repoPath(w.file, opts.root)}:${w.line}`;
  const label = (j: (typeof judged)[number]) =>
    `${site(j.w)}${j.w.test ? ` > ${j.w.test}` : ""}: ${Math.round(j.w.ms)} ms of ${j.budget ?? "?"} ms (${j.t.kind === "explicit" ? "its own timeout" : j.t.kind === "default" ? "default" : j.t.text}${j.w.timedOut ? "; TIMED OUT" : ""})`;
  const resolved = judged.filter((j) => j.budget !== undefined);
  const over = resolved.filter((j) => j.share > BOUND_HEADROOM_RATIO);
  const unresolved = judged.filter(
    (j) => j.budget === undefined && j.w.ms > defaultMs * BOUND_HEADROOM_RATIO,
  );
  const timedOut = judged.filter((j) => j.w.timedOut);
  const lines = [
    `wait headroom: ${over.length} of ${waits.length} testing-library waits took more than ${BOUND_HEADROOM_RATIO * 100}% of their timeout (default asyncUtilTimeout ${defaultMs} ms; ${timedOut.length} timed out)`,
    ...headroomLines(
      over.map((j) => ({
        share: j.share,
        text: label(j),
        file: repoPath(j.w.file, opts.root),
        line: j.w.line,
      })),
      { github: opts.github, title: "Wait near its timeout" },
    ),
  ];
  if (unresolved.length > 0) {
    lines.push(
      `wait headroom: ${unresolved.length} slow waits pass a timeout this report could not read from source:`,
    );
    for (const j of unresolved) lines.push(`        ${label(j)}`);
  }
  const worst = [...resolved].sort((a, b) => b.share - a.share).slice(0, 5);
  if (worst.length > 0) {
    lines.push("wait headroom, worst five whatever their share:");
    for (const j of worst)
      lines.push(`  ${pct(j.share).padStart(4)}  ${label(j)}`);
  }
  return lines;
}

/** A measure-mode id with no witness yet, and why (`src/tests/wall-clock-pending.ts`). */
export interface PendingEntry {
  id: string;
  file: string;
  reason: string;
}

/** Every pending entry, on every CI run: a list nobody reads is a list that only grows. */
export function pendingReport(
  pending: readonly PendingEntry[],
  cap: number,
): string[] {
  return [
    `time-bound pending: ${pending.length} of at most ${cap} measure-only bounds have no speed-independent witness yet`,
    ...pending.map((p) => `  ${p.id} (${p.file}): ${p.reason}`),
  ];
}

/**
 * The hook line. Vitest 4.1 reports no per-hook duration: `onHookEnd` carries
 * only the hook's name and its entity, and is batched to the main process,
 * so timing it there measures the batching. What it does expose is each
 * module's `diagnostic().duration` ("all tests and hooks") and each test's
 * duration (which includes its beforeEach/afterEach), so the difference is
 * the time a file spent in beforeAll/afterAll — an UPPER bound on any single
 * such hook, compared here against `hookTimeout`.
 */
export function hookReport(
  modules: readonly { file: string; moduleMs: number; testsMs: number }[],
  hookTimeoutMs: number,
  opts: { github: boolean; root: string },
): string[] {
  const items = modules.map((m) => {
    const hooks = Math.max(0, m.moduleMs - m.testsMs);
    return {
      share: hooks / hookTimeoutMs,
      text: `${repoPath(m.file, opts.root)}: ${Math.round(hooks)} ms in beforeAll/afterAll (module total less its tests; an upper bound on any one hook) of hookTimeout ${hookTimeoutMs} ms`,
      file: repoPath(m.file, opts.root),
    };
  });
  const over = items.filter((i) => i.share > BOUND_HEADROOM_RATIO);
  return [
    `hook headroom: ${over.length} of ${modules.length} files spent more than ${BOUND_HEADROOM_RATIO * 100}% of hookTimeout in beforeAll/afterAll (vitest 4.1 exposes no per-hook duration; this is the per-file sum)`,
    ...headroomLines(items, {
      github: opts.github,
      title: "Hooks near hookTimeout",
    }),
  ];
}

/**
 * The broken-pipe health check, by relation rather than by size: every
 * `[time-bound]` line a test printed is a record that must have reached the
 * reporter through the test's meta. More lines than records means the meta
 * pipe dropped some — and a report of "0 of 0 bounds near their limit" would
 * be the strongest possible pass for the wrong reason. A size fallback
 * catches a run in which no line was captured either.
 */
export function brokenPipeLines(opts: {
  printed: number;
  recorded: number;
  testsSeen: number;
  github: boolean;
  minTests?: number;
}): string[] {
  const min = opts.minTests ?? 5000;
  const msgs: string[] = [];
  if (opts.printed > opts.recorded)
    msgs.push(
      `time-bound pipe broken: ${opts.printed} [time-bound] lines were printed but only ${opts.recorded} records reached the reporter`,
    );
  else if (opts.testsSeen > min && opts.recorded === 0)
    msgs.push(
      `time-bound pipe broken: ${opts.testsSeen} tests ran and no time-bound record reached the reporter`,
    );
  return msgs.map((m) =>
    opts.github ? `::warning title=time-bound pipe::${escapeData(m)}` : m,
  );
}
