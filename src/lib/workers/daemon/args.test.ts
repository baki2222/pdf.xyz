// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEASE_SECONDS,
  LEASE_MAX_SECONDS,
  REDIS_QUEUE_ENV,
} from "../queue/redis-config";
import {
  DAEMON_USAGE,
  DEFAULT_IDLE_SLEEP_MS,
  parseDaemonArgs,
  type DaemonArgs,
} from "./args";

/** Parse and assert success, returning the args for further checks. */
function run(argv: string[]): DaemonArgs {
  const parsed = parseDaemonArgs(argv);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.kind !== "run") throw new Error("expected run args");
  return parsed.args;
}

describe("parseDaemonArgs — modes", () => {
  it("defaults to loop with the default idle sleep and no caps", () => {
    expect(run([])).toEqual({
      mode: "loop",
      idleSleepMs: DEFAULT_IDLE_SLEEP_MS,
    });
  });

  it("selects each explicit mode", () => {
    expect(run(["--once"]).mode).toBe("once");
    expect(run(["--drain"]).mode).toBe("drain");
    expect(run(["--loop"]).mode).toBe("loop");
    expect(run(["--dry-run-status"]).mode).toBe("dry-run-status");
    expect(run(["--check"]).mode).toBe("check");
    expect(run(["--lifecycle-policy"]).mode).toBe("lifecycle-policy");
    expect(run(["--lifecycle-verify"]).mode).toBe("lifecycle-verify");
  });

  it("treats a repeated same mode flag as the same mode", () => {
    expect(run(["--drain", "--drain"]).mode).toBe("drain");
  });

  it("rejects two conflicting mode flags", () => {
    const parsed = parseDaemonArgs(["--once", "--drain"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/conflicting/i);
  });
});

describe("parseDaemonArgs — help", () => {
  it("returns help for --help and -h", () => {
    for (const flag of ["--help", "-h"]) {
      const parsed = parseDaemonArgs([flag]);
      expect(parsed).toEqual({ ok: true, kind: "help" });
    }
  });
});

describe("parseDaemonArgs — value flags", () => {
  it("parses --max-ticks with = and space forms", () => {
    expect(run(["--max-ticks=10"]).maxTicks).toBe(10);
    expect(run(["--max-ticks", "25"]).maxTicks).toBe(25);
  });

  it("parses --idle-sleep-ms including the 0 floor", () => {
    expect(run(["--idle-sleep-ms=500"]).idleSleepMs).toBe(500);
    expect(run(["--idle-sleep-ms=0"]).idleSleepMs).toBe(0);
  });

  it("parses --lease-ms", () => {
    expect(run(["--lease-ms=60000"]).leaseMs).toBe(60_000);
  });

  it("parses lifecycle policy provider, key prefix, and versioned options", () => {
    expect(
      run([
        "--lifecycle-policy",
        "--provider=aws-s3",
        "--key-prefix=pdfxyz",
        "--versioned",
      ]),
    ).toMatchObject({
      mode: "lifecycle-policy",
      lifecycleProvider: "aws-s3",
      keyPrefix: "pdfxyz",
      versioned: true,
    });
    expect(run(["--lifecycle-policy", "--versioned=false"]).versioned).toBe(
      false,
    );
  });

  it("combines a mode with tuning knobs", () => {
    expect(run(["--drain", "--max-ticks=3", "--lease-ms=45000"])).toEqual({
      mode: "drain",
      maxTicks: 3,
      idleSleepMs: DEFAULT_IDLE_SLEEP_MS,
      leaseMs: 45_000,
    });
  });
});

describe("parseDaemonArgs — lifecycle-policy options", () => {
  it("parses a valid provider (case-insensitively) and versioned flag", () => {
    expect(run(["--lifecycle-policy", "--provider=aws-s3"])).toMatchObject({
      mode: "lifecycle-policy",
      lifecycleProvider: "aws-s3",
    });
    expect(
      run(["--lifecycle-policy", "--provider=AWS-S3"]).lifecycleProvider,
    ).toBe("aws-s3");
    // A bare --versioned means true; an explicit value overrides.
    expect(run(["--lifecycle-policy", "--versioned"]).versioned).toBe(true);
    expect(run(["--lifecycle-policy", "--versioned=false"]).versioned).toBe(
      false,
    );
  });

  it("parses a safe key prefix", () => {
    expect(
      run(["--lifecycle-policy", "--key-prefix=team/pdfxyz"]).keyPrefix,
    ).toBe("team/pdfxyz");
  });

  it("rejects an unknown provider", () => {
    const parsed = parseDaemonArgs(["--lifecycle-policy", "--provider=gcs"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/must be one of/i);
  });

  it("rejects a traversal or leading-slash key prefix", () => {
    for (const argv of [
      ["--key-prefix=../etc"],
      ["--key-prefix=/abs"],
      ["--key-prefix= spaced"],
    ]) {
      expect(parseDaemonArgs(argv).ok).toBe(false);
    }
  });

  it("rejects a non-boolean --versioned value", () => {
    expect(parseDaemonArgs(["--versioned=maybe"]).ok).toBe(false);
  });

  it("rejects --provider with no value", () => {
    expect(parseDaemonArgs(["--provider"]).ok).toBe(false);
  });
});

describe("parseDaemonArgs — lifecycle-verify options", () => {
  it("parses --observed as a path, with = and space forms", () => {
    expect(
      run(["--lifecycle-verify", "--provider=aws-s3", "--observed=cfg.json"]),
    ).toMatchObject({
      mode: "lifecycle-verify",
      lifecycleProvider: "aws-s3",
      observedPath: "cfg.json",
    });
    expect(
      run(["--lifecycle-verify", "--observed", "/tmp/observed.json"])
        .observedPath,
    ).toBe("/tmp/observed.json");
  });

  it("verifies with no --observed (the honest not-configured path is a valid parse)", () => {
    const args = run([
      "--lifecycle-verify",
      "--provider=aws-s3",
      "--versioned",
    ]);
    expect(args.mode).toBe("lifecycle-verify");
    expect(args.observedPath).toBeUndefined();
  });

  it("rejects --observed with no value", () => {
    expect(parseDaemonArgs(["--lifecycle-verify", "--observed"]).ok).toBe(
      false,
    );
    expect(parseDaemonArgs(["--observed", "--versioned"]).ok).toBe(false);
  });
});

describe("parseDaemonArgs — validation", () => {
  it("rejects an unknown flag", () => {
    const parsed = parseDaemonArgs(["--nope"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/unknown option/i);
  });

  it("rejects a non-numeric or out-of-range integer", () => {
    for (const argv of [
      ["--max-ticks=abc"],
      ["--max-ticks=0"],
      ["--lease-ms=1"],
    ]) {
      expect(parseDaemonArgs(argv).ok).toBe(false);
    }
  });

  it("rejects a value flag with no value", () => {
    // A trailing value flag, and one immediately followed by another flag.
    expect(parseDaemonArgs(["--max-ticks"]).ok).toBe(false);
    expect(parseDaemonArgs(["--max-ticks", "--once"]).ok).toBe(false);
  });

  it("caps oversized values", () => {
    expect(parseDaemonArgs(["--idle-sleep-ms=99999999"]).ok).toBe(false);
  });
});

/**
 * `--lease-ms` used to be bounded by `MAX_LEASE_MS = 3_600_000 // 1h — matches the
 * queue's lease ceiling.` Nothing compared the two: the queue's ceiling was a private
 * `LEASE_MAX_SECONDS` in redis-config.ts. And "matches" was the wrong claim anyway —
 * the queue grants `min(--lease-ms, PDFXYZ_QUEUE_LEASE_SECONDS)`, default 300 s, so a
 * `--lease-ms=1800000` the CLI accepted became a five-minute lease without a word.
 * These pin the bound to the queue's constant and the help text to what is granted.
 */
describe("parseDaemonArgs — --lease-ms against the queue that grants it", () => {
  const ceilingMs = LEASE_MAX_SECONDS * 1000;

  it("accepts exactly the most the queue can be configured to grant, and no more", () => {
    // Health check: the imported ceiling is a real, positive number.
    expect(Number.isInteger(ceilingMs) && ceilingMs > 0).toBe(true);
    expect(run([`--lease-ms=${ceilingMs}`]).leaseMs).toBe(ceilingMs);
    expect(parseDaemonArgs([`--lease-ms=${ceilingMs + 1}`]).ok).toBe(false);
  });

  it("--help states the bounds and the clamp from the constants that own them", () => {
    const leaseHelp = DAEMON_USAGE.slice(
      DAEMON_USAGE.indexOf("--lease-ms="),
      DAEMON_USAGE.indexOf("--provider="),
    );
    // Health check: the slice found the --lease-ms entry and stopped at the next one.
    expect(leaseHelp.startsWith("--lease-ms=")).toBe(true);
    expect(leaseHelp.length).toBeGreaterThan(20);
    // The bounds the parser enforces, read from the parser's own behaviour.
    const min = [...Array(5000).keys()].find(
      (ms) => parseDaemonArgs([`--lease-ms=${ms}`]).ok,
    );
    expect(min).toBeDefined();
    expect(leaseHelp).toContain(`${min}..${ceilingMs}`);
    // What the Redis queue actually grants: the env var that caps it and its default.
    expect(leaseHelp).toContain(REDIS_QUEUE_ENV.leaseSeconds);
    expect(leaseHelp).toContain(`default ${DEFAULT_LEASE_SECONDS}`);
  });
});
