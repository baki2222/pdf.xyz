// @vitest-environment node
/**
 * The detector's controls, through the same pure function that reads the
 * corpus (`wall-clock-detector.ts`). Kept apart from `wall-clock-bounds.test.ts`
 * so they run without the 30 s corpus audit; the guard file keeps its own
 * original controls.
 *
 * Every shape below was a reviewer's attack on f8d48720 (2026-11-21) that the
 * detector passed: the measured time named as its own witness, a renamed or
 * namespace import of the helpers, a ceiling written as a floor, a
 * fake-timers mention in a comment exempting a whole file, a Prettier rewrap
 * changing a debt key, and nineteen realistic shapes in a fresh file.
 */
import { describe, expect, it } from "vitest";
import { ratchet } from "./wall-clock-audit";
import { keyText, scanSource } from "./wall-clock-detector";

const scan = (s: string, file = "control.ts") => scanSource(s, file);
const rules = (s: string) =>
  scan(s).comparisons.map((m) => [m.rule, m.direction]);

describe("measure mode cannot name the measured time as its witness (P6, rule 2)", () => {
  const routed = (body: string) =>
    scan(`test("t", async () => {\n${body}\n});`).routed[0]!;

  it("the measured time itself is refused as a witness", () => {
    const r = routed(
      `const t0 = performance.now(); const ms = performance.now() - t0;\nmeasureTime("w", ms, 500, { witness: "ms" });\nexpect(ms).toBeGreaterThanOrEqual(0);`,
    );
    expect(r.witnessAsserted).toBe(false);
    expect(r.witnessProblem).toMatch(/time/);
  });

  it("a tainted name that is not time-named is refused too", () => {
    const r = routed(
      `const t0 = Date.now(); const spent = Date.now() - t0;\nmeasureTime("w2", spent, 500, { witness: "spent" });\nexpect(spent).toBe(spent);`,
    );
    expect(r.witnessAsserted).toBe(false);
  });

  it("a typeof, a floor, or a negated equality is not a witness", () => {
    for (const assertion of [
      `expect(typeof encodes).toBe("number");`,
      `expect(encodes).toBeGreaterThan(0);`,
      `expect(encodes).not.toBe(5);`,
    ])
      expect(
        routed(
          `const encodes = count();\nmeasureTime("w3", ms, 500, { witness: "encodes" });\n${assertion}`,
        ).witnessAsserted,
        assertion,
      ).toBe(false);
  });

  it("an equality or size matcher on the witness (or a property of it) is", () => {
    for (const assertion of [
      `expect(encodes).toBe(3);`,
      `expect(encodes.length).toEqual(3);`,
      `expect(encodes).toHaveLength(3);`,
      `expect(spy).toHaveBeenCalledTimes(1);`,
    ]) {
      const witness = assertion.includes("spy") ? "spy" : "encodes";
      expect(
        routed(
          `measureTime("w4", ms, 500, { witness: "${witness}" });\n${assertion}`,
        ).witnessAsserted,
        assertion,
      ).toBe(true);
    }
  });
});

describe("routed calls through a renamed import, a namespace, or a reference are all seen (P6, rule 4)", () => {
  it("a renamed import resolves to its helper", () => {
    const r = scan(
      `import { expectFasterThan as fast, measureTime as m } from "../../tests/time-bound";\ntest("a", () => { fast("attack-renamed", ms, 500); m("attack-measure-renamed", ms, 500, { witness: "nobody" }); });`,
    );
    expect(r.routed.map((x) => [x.helper, x.id, x.mode])).toEqual([
      ["expectFasterThan", "attack-renamed", "assert"],
      ["measureTime", "attack-measure-renamed", "measure"],
    ]);
    expect(r.timeBoundRefs).toEqual([]);
  });

  it("a namespace import resolves to its helper", () => {
    const r = scan(
      `import * as tb from "@/tests/time-bound";\ntest("a", () => { tb.expectFasterThan("attack-ns", ms, 500, { mode: "measure", witness: "nobody" }); });`,
    );
    expect(r.routed.map((x) => [x.helper, x.id, x.mode])).toEqual([
      ["expectFasterThan", "attack-ns", "measure"],
    ]);
  });

  it("any other use of an imported helper (an object, a variable, a re-export, a dynamic import) is a problem", () => {
    const r = scan(
      [
        `import { expectFasterThan, measureTime } from "./time-bound";`,
        `import * as tb from "./time-bound";`,
        `const helper = { expectFasterThan };`,
        `const f = measureTime;`,
        `const g = tb;`,
        `export { expectAtLeast } from "./time-bound";`,
        `const late = await import("./time-bound");`,
      ].join("\n"),
    );
    expect(r.timeBoundRefs.map((x) => x.text)).toEqual([
      "expectFasterThan",
      "measureTime",
      "tb",
      'export { expectAtLeast } from "./time-bound";',
      'import("./time-bound")',
    ]);
  });

  it("an options object that is not literal is reported, not read as assert mode", () => {
    const r = scan(
      `const o = { mode: "measure" as const };\ntest("a", () => { expectFasterThan("x1", ms, 500, o); expectFasterThan("x2", ms, 500, { ...o }); expectFasterThan("x3", ms, 500, { mode: MODE }); expectFasterThan("x4", ms, 500, { mode: "measure", witness: "n" }); });`,
    );
    expect(r.routed.map((x) => [x.id, x.optionsLiteral])).toEqual([
      ["x1", false],
      ["x2", false],
      ["x3", false],
      ["x4", true],
    ]);
  });

  it("a measured value that is a literal measures nothing", () => {
    const r = scan(
      `test("a", () => { expectFasterThan("lit", 800, 1000); expectFasterThan("nan", Number.NaN, 1000); expectFasterThan("real", ms, 1000); });`,
    );
    expect(r.routed.map((x) => [x.id, x.measuredLiteral])).toEqual([
      ["lit", true],
      ["nan", true],
      ["real", false],
    ]);
  });
});

describe("direction is the sign of the clock term, not the matcher's name (rule 2)", () => {
  it("a ceiling written as a floor is a ceiling", () => {
    expect(
      rules(
        `const el = performance.now() - t0; expect(500 - el).toBeGreaterThan(0);`,
      ),
    ).toEqual([["R1", "ceiling"]]);
    expect(
      rules(
        `const el = performance.now() - t0; expect(500).toBeGreaterThan(el);`,
      ),
    ).toEqual([["R1", "ceiling"]]);
  });

  it("a real floor stays a floor", () => {
    expect(
      rules(
        `const el = performance.now() - t0; expect(el).toBeGreaterThan(250);`,
      ),
    ).toEqual([["R1", "floor"]]);
    // A fresh read minus a start is an elapsed time (compare-redline.spec.ts).
    expect(
      rules(
        `const started = Date.now(); expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);`,
      ),
    ).toEqual([["R1", "floor"]]);
    // A wait's "not yet" branch fails while too EARLY: a floor.
    expect(
      rules(
        `const t0 = performance.now(); if (performance.now() - t0 < 1950) throw new Error("not yet");`,
      ),
    ).toEqual([["R9", "floor"]]);
  });

  it("a time-NAMED bound is a budget, not a moving time: merge-tool's p95 stays a ceiling", () => {
    // The first draft of the sign rule read `B.frameMs` as a time that grows
    // and made this a floor; the shrink-only writer's "lost but still in the
    // file" check is what caught it (2026-11-21).
    expect(
      rules(
        `const p95 = pct(await page.evaluate(f)); expect(p95).toBeLessThan(B.scrollFrameP95Ms);`,
      ),
    ).toEqual([["R3", "ceiling"]]);
  });

  it("what is left of a deadline is a ceiling, however it is written", () => {
    expect(
      rules(
        `const deadlineAt = Date.now() + 500; expect(deadlineAt - Date.now()).toBeGreaterThan(0);`,
      ),
    ).toEqual([["R1", "ceiling"]]);
    expect(
      rules(
        `const now = Date.now(); expect(deadline - now).toBeGreaterThan(0);`,
      ),
    ).toEqual([["R1", "ceiling"]]);
  });

  it("an ordering of an unseen time against a clock reading is no member; an observed value against a time-named bound keeps its matcher's direction", () => {
    expect(
      rules(
        `const releasedAt = Date.now(); expect(frames[i]!.t).toBeGreaterThan(releasedAt);`,
      ),
    ).toEqual([]);
    expect(
      rules(
        `const { waited } = await waitedMs(); expect(waited).toBeGreaterThan(worker.timeoutMs + PROBE_TIMEOUT_MS);`,
      ),
    ).toEqual([["R3", "floor"]]);
  });

  it("a routed floor whose measured value is a negated time needs calibration like a ceiling", () => {
    const r = scan(
      `test("a", () => { expectAtLeast("disg", 500 - (performance.now() - t0), 0); expectAtLeast("real", performance.now() - t0, 250); });`,
    ).routed;
    expect(r.map((x) => [x.id, x.kind])).toEqual([
      ["disg", "ceiling"],
      ["real", "floor"],
    ]);
  });
});

describe("debt keys survive a whitespace-only reformat (Prettier's wrap)", () => {
  it("a wrapped expect with a trailing comma keys the same as the one-liner", () => {
    const one = scan(
      `const started = Date.now(); expect(Date.now() - started).toBeLessThan(5_000);`,
    ).comparisons[0]!.snippet;
    const wrapped = scan(
      `const started = Date.now();\n        expect(\n          Date.now() - started,\n        ).toBeLessThan(5_000);`,
    ).comparisons[0]!.snippet;
    expect(wrapped).toBe(one);
    expect(one).toBe("expect(Date.now() - started).toBeLessThan(5_000)");
  });

  it("a member chain broken across lines keys as the joined chain", () => {
    expect(
      scan(`expect\n  .soft(ms)\n  .toBeLessThanOrEqual(x);`).comparisons[0]!
        .snippet,
    ).toBe("expect.soft(ms).toBeLessThanOrEqual(x)");
  });

  it("keyText drops comments and collapses whitespace inside strings", () => {
    const sf = `f(/* why */ a,\n  "x   y",\n);`;
    expect(keyText(sf)).toBe('f(a, "x y");');
  });
});

describe("fake timers exempt only the scope that installs them, and never from a comment", () => {
  const sleeps = (s: string) => scan(s).sleeps.length;

  it("a mention in a comment exempts nothing", () => {
    expect(
      sleeps(
        `// we deliberately do NOT call vi.useFakeTimers() here\nawait new Promise((r) => setTimeout(r, 300));`,
      ),
    ).toBe(1);
  });

  it("fake timers in another test do not exempt this one", () => {
    expect(
      sleeps(
        `test("real", async () => { await new Promise((r) => setTimeout(r, 300)); });\ntest("fake", () => { vi.useFakeTimers(); });`,
      ),
    ).toBe(1);
  });

  it("fake timers in the same test, its describe's beforeEach, or at module scope exempt it", () => {
    expect(
      sleeps(
        `test("fake", async () => { vi.useFakeTimers(); await new Promise((r) => setTimeout(r, 300)); });`,
      ),
    ).toBe(0);
    expect(
      sleeps(
        `describe("d", () => { beforeEach(() => { vi.useFakeTimers(); }); test("x", async () => { await new Promise((r) => setTimeout(r, 300)); }); });`,
      ),
    ).toBe(0);
    expect(
      sleeps(
        `vi.useFakeTimers();\nawait new Promise((r) => setTimeout(r, 50));`,
      ),
    ).toBe(0);
  });

  it("fake timers that fake only Date leave setTimeout real", () => {
    expect(
      sleeps(
        `vi.useFakeTimers({ toFake: ["Date"] });\nawait new Promise((r) => setTimeout(r, 50));`,
      ),
    ).toBe(1);
  });
});

describe("the shapes a fresh file used to walk past (reviewer's attack corpus)", () => {
  it.each([
    [
      "a destructured Date.now",
      `const { now } = Date; const t0 = now(); expect(now() - t0).toBeLessThan(500);`,
    ],
    [
      "Date-object subtraction",
      `const s = new Date(); expect(+new Date() - +s).toBeLessThan(500);`,
    ],
    [
      "the process.hrtime tuple",
      `const h0 = process.hrtime(); const [sec, ns] = process.hrtime(h0); expect(sec * 1e3 + ns / 1e6).toBeLessThan(500);`,
    ],
    [
      "a stopwatch closure",
      `const t0 = performance.now(); const lap = () => performance.now() - t0; expect(lap()).toBeLessThan(500);`,
    ],
    [
      "chai below",
      `const t0 = Date.now(); expect(Date.now() - t0).to.be.below(500);`,
    ],
    [
      "chai lessThan",
      `const t0 = Date.now(); expect(Date.now() - t0).lessThan(500);`,
    ],
    [
      "chai within",
      `const t0 = Date.now(); expect(Date.now() - t0).to.be.within(0, 500);`,
    ],
    [
      "assert.isBelow",
      `const t0 = Date.now(); assert.isBelow(Date.now() - t0, 500);`,
    ],
    [
      "assert(cond)",
      `const t0 = Date.now(); const spent = Date.now() - t0; assert(spent < 500);`,
    ],
    [
      "assert.ok(cond)",
      `const t0 = Date.now(); assert.ok(Date.now() - t0 < 500);`,
    ],
    [
      "toSatisfy",
      `const t0 = Date.now(); expect(Date.now() - t0).toSatisfy((v) => v < 500);`,
    ],
    [
      "a filter on a sample array with no Ms name",
      `const samples = []; const t0 = performance.now(); samples.push(performance.now() - t0); const slow = samples.filter((v) => v > 500);`,
    ],
    [
      "if-throw on a clock read",
      `const t0 = Date.now(); if (Date.now() - t0 > 500) throw new Error("slow");`,
    ],
    [
      "an e2e navigation duration",
      `const nav = await page.evaluate(() => performance.getEntriesByType("navigation")[0].duration); expect(nav).toBeLessThan(3000);`,
    ],
  ])("POSITIVE %s: exactly one member", (_what, snippet) => {
    expect(scan(snippet).comparisons).toHaveLength(1);
  });

  it.each([
    [
      "timers/promises setTimeout",
      `import { setTimeout as delay } from "node:timers/promises";\nawait delay(400);`,
    ],
    [
      "a same-file sleep helper",
      `const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));\nawait sleep(400);`,
    ],
    [
      "a same-file async sleep function",
      `async function pause(ms: number) { await new Promise<void>((resolve) => setTimeout(resolve, ms)); }\nawait pause(300);`,
    ],
    [
      "setTimeout with an arrow that resolves",
      `await new Promise<void>((resolve) => setTimeout(() => resolve(), 300));`,
    ],
  ])("SLEEP %s: exactly one member", (_what, snippet) => {
    expect(scan(snippet).sleeps).toHaveLength(1);
  });

  it("config against config is no member, even when its argument was observed", () => {
    expect(
      rules(
        `const expected = await load(); expect(pollWaitMs(expected)).toBeGreaterThan(pollWaitMs(AI_JOB_POLL));`,
      ),
    ).toEqual([]);
  });

  it("a date compared to a date-of-now that is a fixture constant is no member", () => {
    expect(
      rules(
        `const d = new Date("2026-01-01"); expect(d.getTime()).toBeLessThan(FIXED);`,
      ),
    ).toEqual([]);
  });
});

describe("the ratchet compares against an independent copy of the list (finding: self-referential ceiling)", () => {
  const e = (file: string, snippet: string, kind = "raw", n = 0) => ({
    file,
    snippet,
    kind,
    n,
  });

  it("an entry the base does not have is growth; a routed entry replacing a raw one in its file is not", () => {
    const base = [e("a-spec.ts", "expect(ms).toBeLessThan(5)")];
    const r = ratchet(
      base,
      [
        e("a-spec.ts", 'expectFasterThan("x", ms, 5)', "routed"),
        e("b-spec.ts", "expect(took).toBeLessThan(9)"),
      ],
      new Map([["a-spec.ts", 'expectFasterThan("x", ms, 5)']]),
    );
    expect(r.grown.map((x) => x.file)).toEqual(["b-spec.ts"]);
    expect(r.lostButPresent).toEqual([]);
  });

  it("an entry that left while its code is still in the file is the detector going blind", () => {
    const base = [e("a-spec.ts", "expect(ms).toBeLessThan(5)")];
    const r = ratchet(
      base,
      [],
      new Map([["a-spec.ts", "it(x, () => { expect(ms).toBeLessThan(5); });"]]),
    );
    expect(r.lostButPresent.map((x) => x.snippet)).toEqual([
      "expect(ms).toBeLessThan(5)",
    ]);
    expect(
      ratchet(base, [], new Map([["a-spec.ts", "it(x, () => {});"]]))
        .lostButPresent,
    ).toEqual([]);
  });

  it("one of several identical comparisons fixed is progress; blind only while the file holds more copies than the list (2026-11-22)", () => {
    // Lane 1b routed the 4th of four `expect(ms).toBeLessThan(5_000)` in one
    // file and kept the other three: the ratchet, reading only "the snippet
    // is still in the file", called entry #3 blind and refused the shrink.
    const snippet = "expect(ms).toBeLessThan(5)";
    const at = (n: number) => ({ ...e("a-spec.ts", snippet), n });
    const base = [at(0), at(1)];
    const once = new Map([["a-spec.ts", `it(x, () => { ${snippet}; });`]]);
    expect(ratchet(base, [at(0)], once).lostButPresent).toEqual([]);
    // Positive control: both copies still there, one entry gone, is blind.
    const twice = new Map([
      ["a-spec.ts", `it(x, () => { ${snippet}; ${snippet}; });`],
    ]);
    expect(
      ratchet(base, [at(0)], twice).lostButPresent.map((x) => x.n),
    ).toEqual([1]);
  });
});
