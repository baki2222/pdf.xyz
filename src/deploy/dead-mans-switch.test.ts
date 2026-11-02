// @vitest-environment node
/**
 * The posture watch's dead-man's switch: the last step of
 * `.github/workflows/posture-watch.yml` tells healthchecks.io the run
 * happened and how it ended, so the owner hears about the checks failing AND
 * about the checks not running (GitHub's scheduler ran 8 of 37 between
 * 2026-11-01 and 2026-11-02, every one of them green).
 *
 * Pinned here: the WIRING (the step is last, runs whatever happened above, and
 * hands the script the secret and `job.status`), and the SCRIPT, run as the
 * workflow runs it — `node scripts/ping-dead-mans-switch.mjs` — against a
 * local server standing in for hc-ping.com, so the URL it hits and what it
 * prints are both observed, not assumed.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "ping-dead-mans-switch.mjs");
const WORKFLOW = readFileSync(
  path.join(ROOT, ".github", "workflows", "posture-watch.yml"),
  "utf8",
);

/** Executable YAML only: a comment naming the script is not a step running it. */
const executable = WORKFLOW.split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

/** The workflow's steps, each as its own text, in order. */
const steps = executable.split(/^\s*- (?=(?:name|uses):)/m).slice(1);

describe("the posture watch pings its dead-man's switch", () => {
  it("as its LAST step, whatever happened above, with the secret and the job's status", () => {
    // Health: the split found the real steps (checkout, node, three checks, ping).
    expect(steps.length).toBeGreaterThanOrEqual(6);
    const last = steps.at(-1)!;
    expect(last).toMatch(
      /^\s*run:\s*node scripts\/ping-dead-mans-switch\.mjs\s*$/m,
    );
    expect(last).toMatch(/^\s*if:\s*always\(\)\s*$/m);
    expect(last).toMatch(
      /HEALTHCHECK_PING_URL:\s*\$\{\{\s*secrets\.HEALTHCHECK_PING_URL\s*\}\}/,
    );
    expect(last).toMatch(/JOB_STATUS:\s*\$\{\{\s*job\.status\s*\}\}/);
  });

  it("runs more than once an hour (one scheduled try an hour was 8 of 37)", () => {
    const cron = /cron:\s*"([^"]+)"/.exec(executable)?.[1];
    expect(cron, "no cron line").toBeDefined();
    const minutes = cron!.split(/\s+/)[0]!.split(",");
    expect(minutes.length).toBeGreaterThanOrEqual(3);
    // Off the top of the hour, where GitHub's load (and dropping) peaks.
    expect(minutes).not.toContain("0");
  });
});

describe("scripts/ping-dead-mans-switch.mjs, run as the workflow runs it", () => {
  const hits: string[] = [];
  let base = "";
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.writeHead(200).end("OK");
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    // Shaped like a real check URL; the uuid is the part that must stay quiet.
    base = `http://127.0.0.1:${port}/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function run(env: Record<string, string>) {
    return new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [SCRIPT], {
        env: {
          ...process.env,
          // Whatever this machine has, the run sees only what the case sets.
          HEALTHCHECK_PING_URL: undefined,
          JOB_STATUS: undefined,
          ...env,
        },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  }

  it("pings the check itself when every step passed", async () => {
    hits.length = 0;
    const { code, out } = await run({
      HEALTHCHECK_PING_URL: base,
      JOB_STATUS: "success",
    });
    expect(code).toBe(0);
    expect(hits).toEqual(["/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"]);
    expect(out).toMatch(/pinged success \(job success\) → HTTP 200/);
  });

  it("pings /fail when a step failed — the alarm the owner reads", async () => {
    hits.length = 0;
    const { code, out } = await run({
      HEALTHCHECK_PING_URL: `${base}/`,
      JOB_STATUS: "failure",
    });
    expect(code).toBe(0);
    expect(hits).toEqual(["/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0/fail"]);
    expect(out).toMatch(/pinged fail \(job failure\)/);
  });

  it("never prints the URL, which is a credential for the check", async () => {
    for (const status of ["success", "failure"]) {
      const { out } = await run({
        HEALTHCHECK_PING_URL: base,
        JOB_STATUS: status,
      });
      expect(out).not.toContain("0f1e2d3c");
      expect(out).not.toContain("127.0.0.1");
    }
  });

  it("does nothing, and says so, when no switch is configured", async () => {
    hits.length = 0;
    const { code, out } = await run({ JOB_STATUS: "failure" });
    expect(code).toBe(0);
    expect(hits).toEqual([]);
    expect(out).toMatch(/HEALTHCHECK_PING_URL is not set/);
  });
});
