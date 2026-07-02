// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  RedisArg,
  RedisClient,
  RedisResult,
  RedisValue,
} from "./redis-client";
import {
  NO_ATTEMPT,
  outcomeOf,
  runTransition,
  statusCsv,
  transitionKeyList,
  TRANSITION_SCRIPTS,
  type TransitionKeys,
} from "./redis-scripts";

const KEYS: TransitionKeys = {
  job: "pdfxyz:job:job_secret001",
  spec: "pdfxyz:spec:job_secret001",
  lease: "pdfxyz:lease:job_secret001",
  ready: "pdfxyz:ready",
  active: "pdfxyz:active",
};

/** A stub REST client that records commands and replays one canned reply. */
function stubClient(
  reply: RedisResult<RedisValue>,
): { client: RedisClient; calls: RedisArg[][] } {
  const calls: RedisArg[][] = [];
  const client: RedisClient = {
    async command(args) {
      calls.push(args);
      return reply;
    },
    async transaction() {
      return { ok: true, value: [] };
    },
  };
  return { client, calls };
}

describe("transition scripts — parameterization & injection safety", () => {
  it("every script is a constant that parameterizes all dynamic values via KEYS/ARGV", () => {
    for (const [name, lua] of Object.entries(TRANSITION_SCRIPTS)) {
      // Uses server-side parameter arrays and real redis calls…
      expect(lua, name).toContain("KEYS[");
      expect(lua, name).toContain("redis.call");
      // …and interpolates NO dynamic datum into the program text: no job id,
      // filename, URL, token, or key literal is ever baked into a script.
      expect(lua, name).not.toMatch(/job_[0-9a-z]{6,}/i);
      expect(lua, name).not.toMatch(/https?:\/\//i);
      expect(lua, name).not.toMatch(/\.pdf/i);
      expect(lua, name).not.toMatch(/token|secret|bearer/i);
    }
  });

  it("guarded transitions read the authoritative record and check ownership", () => {
    // The ownership guard is expressed against the stored lease's attempt count.
    for (const name of ["heartbeat", "advance", "finalize", "requeue"] as const) {
      expect(TRANSITION_SCRIPTS[name], name).toContain("attempts");
    }
    // The claim commit / redelivery re-read the job status before writing.
    for (const name of ["claimCommit", "redeliver", "heartbeat"] as const) {
      expect(TRANSITION_SCRIPTS[name], name).toContain("job.status");
    }
  });
});

describe("statusCsv", () => {
  it("joins a status set into the comma-delimited allow-list the guard expects", () => {
    expect(statusCsv(["queued", "scanning", "processing"])).toBe(
      "queued,scanning,processing",
    );
  });
});

describe("outcomeOf", () => {
  it("maps each Lua status code to a typed outcome", () => {
    expect(outcomeOf("applied")).toBe("applied");
    expect(outcomeOf("invalid")).toBe("invalid_state");
    expect(outcomeOf("stale")).toBe("stale_lease");
    expect(outcomeOf("missing")).toBe("missing_job");
  });

  it("treats an unexpected reply shape as unavailable, never a silent success", () => {
    expect(outcomeOf(null)).toBe("unavailable");
    expect(outcomeOf(42)).toBe("unavailable");
    expect(outcomeOf(["applied"])).toBe("unavailable");
    expect(outcomeOf("weird")).toBe("unavailable");
  });
});

describe("runTransition — REST command shape", () => {
  it("issues EVAL with numkeys, the KEYS, then ARGV — dynamic data only in KEYS/ARGV", async () => {
    const { client, calls } = stubClient({ ok: true, value: "applied" });
    const argv: RedisArg[] = [
      "<<JOB_JSON_PAYLOAD>>",
      "3600",
      NO_ATTEMPT,
      "queued,scanning,processing",
      "job_secret001",
    ];
    const outcome = await runTransition(client, "finalize", KEYS, argv);
    expect(outcome).toBe("applied");

    expect(calls).toHaveLength(1);
    const cmd = calls[0]!.map(String);
    expect(cmd[0]).toBe("EVAL");
    // The program text is the frozen constant — never a dynamically built string.
    expect(cmd[1]).toBe(TRANSITION_SCRIPTS.finalize);
    expect(cmd[2]).toBe("5"); // numkeys
    expect(cmd.slice(3, 8)).toEqual(transitionKeyList(KEYS));
    expect(cmd.slice(8)).toEqual(argv.map(String));
    // The script text itself carries none of the dynamic values.
    expect(cmd[1]).not.toContain("<<JOB_JSON_PAYLOAD>>");
    expect(cmd[1]).not.toContain("job_secret001");
  });

  it("maps a transport failure to unavailable", async () => {
    const { client } = stubClient({ ok: false, error: "unreachable" });
    expect(await runTransition(client, "advance", KEYS, [])).toBe("unavailable");
  });

  it("declares exactly the five positional keys for every script", async () => {
    for (const name of Object.keys(TRANSITION_SCRIPTS) as Array<
      keyof typeof TRANSITION_SCRIPTS
    >) {
      const { client, calls } = stubClient({ ok: true, value: "applied" });
      await runTransition(client, name, KEYS, []);
      expect(calls[0]!.map(String)[2], name).toBe("5");
    }
  });
});
