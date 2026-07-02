// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
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
    expect(run([])).toEqual({ mode: "loop", idleSleepMs: DEFAULT_IDLE_SLEEP_MS });
  });

  it("selects each explicit mode", () => {
    expect(run(["--once"]).mode).toBe("once");
    expect(run(["--drain"]).mode).toBe("drain");
    expect(run(["--loop"]).mode).toBe("loop");
    expect(run(["--dry-run-status"]).mode).toBe("dry-run-status");
    expect(run(["--check"]).mode).toBe("check");
    expect(run(["--lifecycle-policy"]).mode).toBe("lifecycle-policy");
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
    expect(run(["--lifecycle-policy", "--versioned=false"]).versioned).toBe(false);
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
    expect(run(["--lifecycle-policy", "--provider=AWS-S3"]).lifecycleProvider).toBe(
      "aws-s3",
    );
    // A bare --versioned means true; an explicit value overrides.
    expect(run(["--lifecycle-policy", "--versioned"]).versioned).toBe(true);
    expect(run(["--lifecycle-policy", "--versioned=false"]).versioned).toBe(false);
  });

  it("parses a safe key prefix", () => {
    expect(run(["--lifecycle-policy", "--key-prefix=team/pdfxyz"]).keyPrefix).toBe(
      "team/pdfxyz",
    );
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

describe("parseDaemonArgs — validation", () => {
  it("rejects an unknown flag", () => {
    const parsed = parseDaemonArgs(["--nope"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/unknown option/i);
  });

  it("rejects a non-numeric or out-of-range integer", () => {
    for (const argv of [["--max-ticks=abc"], ["--max-ticks=0"], ["--lease-ms=1"]]) {
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
