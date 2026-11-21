// @vitest-environment node
/**
 * THE WALL-CLOCK GUARD.
 *
 * Property (design 2, CLAUDE.md rule 2): every comparison that can fail a
 * test on wall-clock time has CI-measured headroom of at least 2x over at
 * least 5 CI runs (one of them on a slow runner, against the test body as it
 * is today) — or it cannot fail: measure mode, which is allowed only beside
 * a speed-independent witness in the same test, or on the capped pending
 * list (critic P6). "Uses the helper" is the mechanism, not the exit. This
 * guard is permanent; only its debt lists have an exit, and they end empty.
 *
 * The set it searches is DERIVED (rule 4): vitest's own file list and setup
 * files, Playwright's own `--list`, the runtime imports of both into
 * `src/tests` and `e2e`, every `*.child.ts`, and the scripts the CI
 * workflows run. Each set has FATAL size bounds both ways and is printed
 * member by member. The detector (`wall-clock-detector.ts`) is pure, and
 * its planted controls run through the same function as the corpus.
 *
 * `scripts/wall-clock-debt.mjs` runs the one test here that writes the debt
 * lists (only when WALL_CLOCK_DEBT_MODE is set).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readCalibration } from "./time-bound-calibration";
import {
  debtKey,
  debtTsvFromModule,
  parseDebt,
  parseSleepDebt,
  ratchet,
  requiredDebt,
  runAudit,
  type Audit,
  type Required,
} from "./wall-clock-audit";
import { ROOT, workflowScripts } from "./wall-clock-corpus";
import { regenerate } from "./wall-clock-debt-writer";
import {
  WALL_CLOCK_RULES,
  findTimeComparisonsAnywhere,
  findWallClockComparisons,
  scanSource,
  type WallClockRule,
} from "./wall-clock-detector";
import {
  FIXED_SLEEP_DEBT_CEILING,
  FIXED_SLEEP_DEBT_TSV,
} from "./fixed-sleep-debt";
import {
  WALL_CLOCK_DEBT_CEILING,
  WALL_CLOCK_DEBT_TSV,
} from "./wall-clock-debt";
import { WALL_CLOCK_EXEMPT } from "./wall-clock-exempt";
import { LANES } from "./wall-clock-lanes";
import { PENDING_CAP, WALL_CLOCK_PENDING } from "./wall-clock-pending";
import { WALL_CLOCK_SEED } from "./wall-clock-seed";

const MODE = process.env.WALL_CLOCK_DEBT_MODE;

/**
 * CI scripts that bound a time, and why each is outside this guard. Held
 * both ways: every workflow-run script with a time comparison is here, and
 * every entry is still run by a workflow and still compares a time.
 */
const WORKFLOW_NAMED_OUT: readonly { file: string; reason: string }[] = [
  {
    file: "scripts/healthcheck-budget.mjs",
    reason:
      "container.yml's HEALTHCHECK budget (probe <= 2/3 of the Dockerfile/compose timeout, cold and warm) is a property of production, not of the runner: the same probe runs under the same timeout in the deployed worker, so a CI run over budget is a real finding. It reads its numbers from the Dockerfile and compose, and has its own unit test (src/deploy/healthcheck-budget.test.ts).",
  },
  {
    file: "scripts/check-backup-freshness.mjs",
    reason:
      "posture-watch.yml's backup check compares the age of the newest production backup (hours since its LastModified, read through `new Date()`) with MAX_AGE_HOURS: a property of the backup schedule, which no runner speed can move by an hour. Found on 2026-11-21 once the detector learned `new Date()` as a clock read.",
  },
];

/**
 * Detector rules with no member in the real corpus today, and why each is
 * kept (CLAUDE.md rule 1, the reverse direction: a pattern nothing shipped
 * exercises is decoration unless it says what it is waiting for). Held both
 * ways: a rule with zero real members must be here, and an entry here must
 * still have zero — the day a real member appears it is promoted out.
 */
const ANTICIPATED_RULES: readonly { rule: WallClockRule; why: string }[] = [
  {
    rule: "R4",
    why: "a boolean comparison handed to an assertion (`expect(t < 200).toBe(true)`, `assert(t < 500)`, `toSatisfy`) evades every matcher rule; the audit's corpus had none and neither does the tree, so it waits for its first member (reviewer's attack, 2026-11-21).",
  },
  {
    rule: "R8",
    why: "chai's order assertions (`.below`, `assert.isBelow`) ship with vitest and were walked straight past by a reviewer's attack file on 2026-11-21; nothing in the tree uses them yet.",
  },
];

/**
 * Size bounds for every derived set, FATAL both ways (CLAUDE.md rule 4): a
 * set that quietly shrinks reports the strongest pass, and one that quietly
 * grows (a widened folder filter took support modules 178 -> 1453 on
 * f8d48720 with every check green) answers an easier question. Measured
 * 2026-11-21; each bound leaves room for ordinary growth, not for an order
 * of magnitude.
 */
const BOUNDS = {
  vitest: [1200, 2000],
  e2e: [80, 200],
  support: [150, 450],
  // 27 on 2026-11-21 (fakes, corpora, probe builders): a module only the
  // corpus imports. Zero would mean the reverse index went blind.
  testOnly: [10, 80],
  workflowScripts: [20, 60],
  sleeps: [100, 400],
  comparisons: [100, 500],
  routedDebtExempt: [100, 500],
} as const;

const within = (what: keyof typeof BOUNDS, n: number) => {
  const [lo, hi] = BOUNDS[what];
  expect(
    n,
    `${what}: ${n} is under ${lo}, the set went blind`,
  ).toBeGreaterThanOrEqual(lo);
  expect(n, `${what}: ${n} is over ${hi}, the set widened`).toBeLessThanOrEqual(
    hi,
  );
};

let audit: Audit;
let req: Required;

beforeAll(async () => {
  audit = await runAudit();
  req = requiredDebt(
    audit,
    WALL_CLOCK_EXEMPT,
    readCalibration(),
    WALL_CLOCK_SEED,
  );
}, 300_000);

describe("debt generator", () => {
  it.runIf(MODE)(
    "debt generator: regenerates the lists",
    async () => {
      const code = await regenerate({
        write: MODE !== "check",
        acceptNew: MODE === "write-accept-new",
        audit,
      });
      expect(code).toBe(0);
    },
    60_000,
  );
});

describe.skipIf(MODE)("the corpus is derived, plausible, and printed", () => {
  it("vitest's own file list, between 1,200 and 2,000 entries, with the setup files every project runs", () => {
    console.log(
      `vitest entries (${audit.vitest.entries.length}; ${JSON.stringify(audit.vitest.byProject)}):\n  ${audit.vitest.entries.join("\n  ")}`,
    );
    console.log(`setup files:\n  ${audit.vitest.setupFiles.join("\n  ")}`);
    within("vitest", audit.vitest.entries.length);
    expect(audit.vitest.entries).toContain(
      "src/tests/wall-clock-bounds.test.ts",
    );
    expect(audit.vitest.setupFiles).toContain("src/tests/setup.ts");
  });

  it("Playwright's own --list, between 80 and 200 specs, equal both ways to a readdir by the default testMatch", () => {
    console.log(
      `e2e specs (${audit.e2e.listed.length}):\n  ${audit.e2e.listed.join("\n  ")}`,
    );
    within("e2e", audit.e2e.listed.length);
    expect(
      audit.e2e.listed.filter((f) => !audit.e2e.readdir.includes(f)),
    ).toEqual([]);
    expect(
      audit.e2e.readdir.filter((f) => !audit.e2e.listed.includes(f)),
    ).toEqual([]);
  });

  it("support modules by runtime import and by name, bounded both ways, every test-side file reached, no broken link", () => {
    console.log(
      `support modules (${audit.support.modules.length}):\n  ${audit.support.modules.join("\n  ")}`,
    );
    console.log(
      `  of which named by a string literal (children, configs, fixtures) (${audit.support.children.length}):\n  ${audit.support.children.join("\n  ")}`,
    );
    console.log(
      `  of which outside src/tests and e2e, calling the test framework (${audit.support.outside.length}):\n  ${audit.support.outside.join("\n  ")}`,
    );
    console.log(
      `  of which outside src/tests and e2e, imported only by the corpus (${audit.support.testOnly.length}):\n  ${audit.support.testOnly.join("\n  ")}`,
    );
    console.log(
      `test-side files reached only from outside the suite, not scanned (${audit.support.external.length}):\n  ${audit.support.external.join("\n  ")}`,
    );
    expect(audit.support.broken).toEqual([]);
    expect(
      audit.support.unreached,
      "a test-side script nothing in the corpus imports or names: reference it, or delete it",
    ).toEqual([]);
    within("support", audit.support.modules.length);
    within("testOnly", audit.support.testOnly.length);
    // A fake no product code loads: the testOnly reach's standing member.
    expect(audit.support.testOnly).toContain(
      "src/lib/workers/queue/redis-fake.ts",
    );
    // The hook layer is in: setup.ts imports the poll-leak guard (critic P7).
    expect(audit.support.modules).toContain("src/tests/poll-leak-guard.ts");
    // Spawned children, child configs and their fixtures are in (the chain
    // fixtures were outside the set on f8d48720).
    for (const child of [
      "src/tests/labels-probe-hang.ts",
      "src/tests/time-bound-chain.fixture.ts",
      "e2e/headroom-chain/headroom.chain.ts",
    ])
      expect(audit.support.children).toContain(child);
  });

  it("parses every file (a parse error is fatal)", () => {
    expect(audit.parseErrors).toEqual([]);
    expect(audit.files.length).toBeGreaterThan(audit.vitest.entries.length);
  });
});

describe.skipIf(MODE)(
  "every wall-clock comparison is routed, exempt, or in debt",
  () => {
    it("the debt list equals what the tree needs, both ways, lane-tagged", () => {
      const listed = parseDebt(WALL_CLOCK_DEBT_TSV);
      const want = new Map(req.debt.map((e) => [debtKey(e), e]));
      const have = new Map(listed.map((e) => [debtKey(e), e]));
      const missing = req.debt
        .filter((e) => !have.has(debtKey(e)))
        .map((e) => `[${e.lane}] ${e.kind} ${e.file}#${e.n}: ${e.snippet}`);
      const stale = listed
        .filter((e) => !want.has(debtKey(e)))
        .map((e) => `[${e.lane}] ${e.kind} ${e.file}#${e.n}: ${e.snippet}`);
      console.log(
        `comparisons (${audit.comparisons.length}):\n  ${audit.comparisons.map((m) => `${m.rule} ${m.file}:${m.line} ${m.snippet}`).join("\n  ")}`,
      );
      expect(
        missing,
        "a wall-clock comparison that is not routed, exempt or in debt: route it through src/tests/time-bound.ts or e2e/time-bound.ts, starting in measure mode with a witness",
      ).toEqual([]);
      expect(
        stale,
        "a debt entry the tree no longer needs: run node scripts/wall-clock-debt.mjs --write",
      ).toEqual([]);
      const lanes = listed.filter((e) => want.get(debtKey(e))?.lane !== e.lane);
      expect(lanes.map((e) => `${e.file}: ${e.lane}`)).toEqual([]);
      for (const e of listed) expect(LANES).toContain(e.lane);
    });

    // HISTORY: on f8d48720 this test was titled "the debt list only
    // shrinks" and checked only that the list's length equals the ceiling
    // the generator writes from that same length — self-referential, so
    // `--write --accept-new` grew the list and every check stayed green. It
    // now says what it checks; the ratchet itself is the next test.
    it("the generated ceiling equals the list's length (a hand edit shows)", () => {
      expect(parseDebt(WALL_CLOCK_DEBT_TSV).length).toBe(
        WALL_CLOCK_DEBT_CEILING,
      );
      expect(parseSleepDebt(FIXED_SLEEP_DEBT_TSV).length).toBe(
        FIXED_SLEEP_DEBT_CEILING,
      );
    });

    it("the debt lists only shrink against origin/main's, and only by changed code", () => {
      // The base is origin/main; WALL_CLOCK_RATCHET_BASE names another ref
      // only for a mutation proof of this very test.
      const base = process.env.WALL_CLOCK_RATCHET_BASE ?? "origin/main";
      if (process.env.GITHUB_ACTIONS === "true")
        expect(base, "CI compares against origin/main, nothing else").toBe(
          "origin/main",
        );
      const show = (file: string): string | null => {
        try {
          return execFileSync("git", ["show", `${base}:${file}`], {
            cwd: ROOT,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 64 * 1024 * 1024,
          });
        } catch (e) {
          const msg = String((e as { stderr?: string }).stderr ?? e);
          // The ref must exist (CI fetches it); only the FILE may be
          // absent, on the PR that introduces the lists.
          if (/exists on disk, but not in|does not exist in/.test(msg))
            return null;
          throw new Error(
            `cannot read ${base} (${msg.trim()}): the ratchet has nothing to compare against — run git fetch origin main`,
          );
        }
      };
      const debtBase = show("src/tests/wall-clock-debt.ts");
      const sleepBase = show("src/tests/fixed-sleep-debt.ts");
      if (debtBase === null || sleepBase === null) {
        console.log(
          `ratchet: ${base} has no debt lists yet (this is the PR that introduces them); every later PR is compared against them`,
        );
        return;
      }
      const debt = ratchet(
        parseDebt(debtTsvFromModule(debtBase, "WALL_CLOCK_DEBT_TSV")),
        parseDebt(WALL_CLOCK_DEBT_TSV),
        audit.keys,
      );
      const sleeps = ratchet(
        parseSleepDebt(debtTsvFromModule(sleepBase, "FIXED_SLEEP_DEBT_TSV")),
        parseSleepDebt(FIXED_SLEEP_DEBT_TSV),
        audit.keys,
      );
      const label = (e: { file: string; n: number; snippet: string }) =>
        `${e.file}#${e.n}: ${e.snippet}`;
      expect(
        [...debt.grown, ...sleeps.grown].map(label),
        "debt that origin/main does not have: route the new check through the time-bound helpers (measure mode first), or make the sleep event-driven",
      ).toEqual([]);
      expect(
        [...debt.lostButPresent, ...sleeps.lostButPresent].map(label),
        "debt that left the list while its code is still in the file: the detector went blind",
      ).toEqual([]);
    });

    it("every exempt entry matches a member, for a stated reason", () => {
      expect(req.exemptUnmatched).toEqual([]);
      for (const e of WALL_CLOCK_EXEMPT) {
        expect(["config-relation", "injected-clock", "floor"]).toContain(
          e.reason,
        );
        expect(e.why.length).toBeGreaterThan(20);
      }
    });

    it("every audit seed is detected, routed, or held as seed debt; none is stale", () => {
      const counts: Record<string, number> = {};
      for (const s of req.seeds) counts[s.status] = (counts[s.status] ?? 0) + 1;
      console.log(
        `audit seeds (${req.seeds.length}): ${JSON.stringify(counts)}\n  ${req.seeds.map((s) => `${s.status} ${s.seed.file}: ${s.seed.code}`).join("\n  ")}`,
      );
      expect(req.seeds.length).toBe(WALL_CLOCK_SEED.length);
      expect(
        req.seeds
          .filter((s) => s.status === "stale")
          .map(
            (s) =>
              `${s.seed.file}: ${s.seed.code} (${"why" in s ? s.why : ""})`,
          ),
      ).toEqual([]);
    });

    it("health: routed + debt + exempt is at least 100 (a drop means the detector went blind)", () => {
      const total =
        audit.routed.length +
        parseDebt(WALL_CLOCK_DEBT_TSV).length +
        WALL_CLOCK_EXEMPT.length;
      console.log(
        `routed ${audit.routed.length}, debt ${parseDebt(WALL_CLOCK_DEBT_TSV).length}, exempt ${WALL_CLOCK_EXEMPT.length}, comparisons ${audit.comparisons.length}`,
      );
      within("routedDebtExempt", total);
      // Raw comparisons AND routed calls: routing a comparison moves it from
      // the first set to the second, so a lane that fixes its debt shrinks
      // the raw count by design (lane 1b took it from 102 to 79 on
      // 2026-11-22) and the raw count alone would read that as blindness.
      // The raw recognizer's own sight is held by wall-clock-detector.test.ts.
      within("comparisons", audit.comparisons.length + audit.routed.length);
    });

    it("every rule catches a real member, or says what it is waiting for (rule 1, both directions)", () => {
      const counts = Object.fromEntries(
        WALL_CLOCK_RULES.map((r) => [
          r,
          audit.comparisons.filter((m) => m.rule === r).length,
        ]),
      ) as Record<WallClockRule, number>;
      console.log(`real members by rule: ${JSON.stringify(counts)}`);
      const anticipated = new Set(ANTICIPATED_RULES.map((a) => a.rule));
      expect(
        WALL_CLOCK_RULES.filter((r) => counts[r] === 0 && !anticipated.has(r)),
        "a rule with no real member: give a reason in ANTICIPATED_RULES, or remove the rule",
      ).toEqual([]);
      expect(
        ANTICIPATED_RULES.filter((a) => counts[a.rule] > 0).map((a) => a.rule),
        "an anticipated rule now has real members: remove it from ANTICIPATED_RULES",
      ).toEqual([]);
      for (const a of ANTICIPATED_RULES)
        expect(a.why.length).toBeGreaterThan(40);
    });
  },
);

describe.skipIf(MODE)("routed calls", () => {
  it("each id is a string literal, used at one call site", () => {
    console.log(
      `routed calls (${audit.routed.length}):\n  ${audit.routed.map((r) => `${r.helper} ${r.file}:${r.line} ${r.id} [${r.mode}] bound ${r.boundText}`).join("\n  ")}`,
    );
    expect(
      audit.routed
        .filter((r) => r.id === null)
        .map((r) => `${r.file}:${r.line}`),
    ).toEqual([]);
    const sites = new Map<string, Set<string>>();
    for (const r of audit.routed) {
      const s = sites.get(r.id!) ?? new Set<string>();
      s.add(`${r.file}:${r.line}`);
      sites.set(r.id!, s);
    }
    expect(
      [...sites]
        .filter(([, s]) => s.size > 1)
        .map(([id, s]) => `${id}: ${[...s].join(", ")}`),
    ).toEqual([]);
  });

  it("every use of a time-bound helper is a call the routed scan reads (no alias, object, re-export or dynamic import)", () => {
    expect(
      audit.timeBoundRefs.map((r) => `${r.file}:${r.line} ${r.text}`),
      "call the helpers directly, or through a named or namespace import: any other use runs a check no list carries",
    ).toEqual([]);
  });

  it("every routed call passes its options as a literal object, so what the guard reads is what runs", () => {
    expect(
      audit.routed
        .filter((r) => !r.optionsLiteral)
        .map((r) => `${r.file}:${r.line} ${r.snippet}`),
    ).toEqual([]);
  });

  it("a measure-mode call names a witness asserted in the same test, or is pending", () => {
    const pendingIds = new Set(WALL_CLOCK_PENDING.map((p) => p.id));
    const blind = audit.routed.filter(
      (r) =>
        r.mode === "measure" &&
        !r.measuredLiteral &&
        !r.witnessAsserted &&
        !pendingIds.has(r.id!),
    );
    expect(
      blind.map(
        (r) =>
          `${r.file}:${r.line} ${r.id}${r.witnessProblem ? ` (${r.witnessProblem})` : ""}`,
      ),
      "measure mode switches detection off: assert a speed-independent count, size or shape in the same test and name it as the witness",
    ).toEqual([]);
  });

  it("the pending list is capped at 25, and each entry names a measure-mode call with no witness", () => {
    expect(WALL_CLOCK_PENDING.length).toBeLessThanOrEqual(PENDING_CAP);
    expect(PENDING_CAP).toBe(25);
    for (const p of WALL_CLOCK_PENDING) {
      const call = audit.routed.find((r) => r.id === p.id);
      expect(call, p.id).toBeDefined();
      expect(call!.mode, p.id).toBe("measure");
      expect(call!.witnessAsserted, p.id).toBe(false);
      expect(call!.file).toBe(p.file);
      expect(p.reason.length).toBeGreaterThan(20);
    }
  });
});

describe.skipIf(MODE)("fixed sleeps (class b): ratcheted, both ways", () => {
  it("the sleep debt equals the tree's fixed sleeps", () => {
    const listed = parseSleepDebt(FIXED_SLEEP_DEBT_TSV);
    const want = new Set(req.sleepDebt.map(debtKey));
    const have = new Set(listed.map(debtKey));
    console.log(
      `fixed sleeps (${audit.sleeps.length}):\n  ${audit.sleeps.map((s) => `${s.file}:${s.line} ${s.ms} ms ${s.snippet}`).join("\n  ")}`,
    );
    expect(
      req.sleepDebt
        .filter((e) => !have.has(debtKey(e)))
        .map((e) => `${e.file}#${e.n}: ${e.snippet}`),
      "a new fixed sleep: wait for the event instead, or declare the window with observeFor(id, ms, reason)",
    ).toEqual([]);
    expect(
      listed
        .filter((e) => !want.has(debtKey(e)))
        .map((e) => `${e.file}#${e.n}: ${e.snippet}`),
    ).toEqual([]);
    const laneOfKey = new Map(req.sleepDebt.map((e) => [debtKey(e), e.lane]));
    expect(
      listed
        .filter(
          (e) => want.has(debtKey(e)) && laneOfKey.get(debtKey(e)) !== e.lane,
        )
        .map((e) => `${e.file}: ${e.lane}`),
    ).toEqual([]);
    // Health: the family is neither blind nor widened (150 sites at the
    // audit, 2026-11-19).
    within("sleeps", audit.sleeps.length);
  });
});

describe.skipIf(MODE)("CI itself", () => {
  it("every workflow-run script that compares a time is named out with a reason, and every entry still is one", () => {
    const scripts = workflowScripts();
    console.log(
      `workflow scripts (${scripts.length}):\n  ${scripts.map((s) => `${s.workflow}: ${s.run} -> ${s.file}`).join("\n  ")}`,
    );
    within("workflowScripts", scripts.length);
    const bounding = [
      ...new Set(
        scripts
          .filter((s) => !s.file.endsWith(".sh"))
          .filter(
            (s) =>
              findTimeComparisonsAnywhere(
                readFileSync(path.join(ROOT, s.file), "utf8"),
                s.file,
              ).length > 0,
          )
          .map((s) => s.file),
      ),
    ].sort();
    expect(bounding).toEqual(WORKFLOW_NAMED_OUT.map((n) => n.file).sort());
  });

  it("both CI jobs have a timeout-minutes, and each job prints its own share line against that same number", () => {
    const yml = readFileSync(
      path.join(ROOT, ".github/workflows/ci.yml"),
      "utf8",
    );
    const jobs = yml
      .slice(yml.indexOf("\njobs:\n"))
      .split(/\n {2}(?=[\w-]+:\n)/)
      .slice(1);
    expect(jobs.length).toBe(2);
    for (const job of jobs) {
      const name = /^[\w-]+/.exec(job)![0];
      const minutes = /\n    timeout-minutes: (\d+)\n/.exec(job)?.[1];
      expect(minutes, `${name} has timeout-minutes`).toBeDefined();
      // One number spread two ways: the share step reads JOB_TIMEOUT_MINUTES.
      expect(
        /\n      JOB_TIMEOUT_MINUTES: "?(\d+)"?\n/.exec(job)?.[1],
        name,
      ).toBe(minutes);
      expect(job, name).toMatch(
        /- name: Job time against its timeout-minutes\n\s+if: \$\{\{ always\(\) \}\}/,
      );
      expect(job, name).toContain("JOB_STARTED_AT");
    }
  });
});

describe("the detector (controls through the same function)", () => {
  const one = (snippet: string) =>
    findWallClockComparisons(snippet, "control.ts");

  it.each([
    [
      "R1",
      `const t0 = performance.now(); work(); expect(performance.now() - t0).toBeLessThan(500);`,
    ],
    ["R2", `expect(got.ms, s).toBeLessThan(10_000);`],
    [
      "R3",
      `const p95 = pct(await page.evaluate(f)); expect(p95).toBeLessThan(B.frameMs);`,
    ],
    [
      "R4 (a < b)",
      `const elapsed = Date.now() - t0; expect(elapsed < 200).toBe(true);`,
    ],
    [
      "R4 (helper)",
      `const withinBound = (took: number, bound: number) => took < bound * 2;\nexpect(withinBound(a, b)).toBe(true);`,
    ],
    ["R5", `const slow = evs.filter((e) => e.duration >= BUDGET_MS);`],
    ["R6 (multi-line soft)", `expect\n  .soft(ms)\n  .toBeLessThanOrEqual(x);`],
    ["R6 (.not)", `expect(tookMs).not.toBeGreaterThan(900);`],
    [
      "R7 (an alias, in a deadline loop)",
      `const realDateNow = Date.now.bind(Date);\nconst deadline = realDateNow() + 2000;\nwhile (busy() && realDateNow() < deadline) await tick();`,
    ],
    [
      "R1 (an alias, in an expect)",
      `const now = () => performance.now();\nconst t0 = now(); expect(now() - t0).toBeLessThan(300);`,
    ],
  ])("POSITIVE %s: exactly one member", (_rule, snippet) => {
    expect(one(snippet)).toHaveLength(1);
  });

  it.each([
    ["a byte count", `expect(bytes.length).toBeLessThan(500);`],
    ["a memory growth", `expect(growthMb).toBeLessThan(512);`],
    [
      "config against config",
      `expect(pollWaitMs(A)).toBeGreaterThan(pollWaitMs(B));`,
    ],
    ["an equality on a timeout", `expect(task.timeout).toBe(20_000);`],
    ["a routed call", `expectFasterThan("x", ms, 500);`],
    [
      "a snippet inside a string",
      `const s = "expect(performance.now() - t0).toBeLessThan(500)";`,
    ],
    [
      "a loop counter beside a tainted name",
      `let r = Date.now(); for (let r = 0; r < 105; r++) work(r);`,
    ],
  ])("NEGATIVE %s: no member", (_what, snippet) => {
    expect(one(snippet)).toEqual([]);
  });

  it("sleeps: a literal fixed sleep is one member; an ordering flush, a variable and a fake-timer file are none", () => {
    const sleeps = (s: string) => scanSource(s, "control.ts").sleeps;
    expect(sleeps(`await page.waitForTimeout(500);`)).toHaveLength(1);
    expect(sleeps(`await new Promise((r) => setTimeout(r, 50));`)).toHaveLength(
      1,
    );
    expect(
      sleeps(
        `await new Promise<void>((resolve) => { setTimeout(resolve, 20); });`,
      ),
    ).toHaveLength(1);
    expect(sleeps(`await new Promise((r) => setTimeout(r, 0));`)).toEqual([]);
    expect(sleeps(`await new Promise((r) => setTimeout(r, ms));`)).toEqual([]);
    expect(
      sleeps(
        `vi.useFakeTimers();\nawait new Promise((r) => setTimeout(r, 50));`,
      ),
    ).toEqual([]);
  });

  it("routed calls: the id, the mode, and whether the witness is asserted in the same test", () => {
    const routed = scanSource(
      [
        `test("a", () => {`,
        `  measureTime("enc-a", ms, 500, { witness: "encodes" });`,
        `  expect(encodes).toBe(0);`,
        `});`,
        `test("b", () => {`,
        `  measureTime("enc-b", ms, 500, { witness: "encodes" });`,
        `});`,
        `test("c", () => { expectRatioBelow(name, a, b, 2); });`,
      ].join("\n"),
      "control.ts",
    ).routed;
    expect(
      routed.map((r) => [r.id, r.mode, r.witnessAsserted, r.kind]),
    ).toEqual([
      ["enc-a", "measure", true, "ceiling"],
      ["enc-b", "measure", false, "ceiling"],
      [null, "assert", false, "ratio"],
    ]);
  });

  it("CI scripts: a comparison on a time anywhere in the file, none on a count", () => {
    expect(
      findTimeComparisonsAnywhere(
        `if (run.ms > plan.budgetMs) fail();`,
        "s.mjs",
      ),
    ).toHaveLength(1);
    expect(
      findTimeComparisonsAnywhere(`if (bytes.length > limit) fail();`, "s.mjs"),
    ).toEqual([]);
  });
});
