// @vitest-environment node
/**
 * The posture watch's PRIMARY trigger: a systemd timer on the worker host
 * that starts `.github/workflows/posture-watch.yml` through
 * `workflow_dispatch`, because GitHub's own `schedule` trigger ran it 3 times
 * in 26 hours (scripts/posture-dispatch/README.md).
 *
 * Pinned here: the RELATIONSHIPS between the files that must agree for a
 * dispatch to happen at all — the workflow the script names exists and can
 * be dispatched, the repository is this one, the paths install.sh writes are
 * the paths the units and the README use — and the script itself, run as
 * systemd runs it, against a local server standing in for api.github.com, so
 * the request it sends and what it prints are observed, not assumed.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts", "posture-dispatch");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

/** Git for Windows ships the bash and curl the script needs; elsewhere, PATH. */
const BASH =
  process.platform === "win32"
    ? path.join(
        execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
        "../../../bin/bash.exe",
      )
    : "bash";

const DISPATCH = read("dispatch.sh");
const SET_TOKEN = read("set-token.sh");
const INSTALL = read("install.sh");
const SERVICE = read("pdfxyz-posture-dispatch.service");
const TIMER = read("pdfxyz-posture-dispatch.timer");
const README = read("README.md");

/** `NAME="value"` from a shell script; fails loudly when it is not there. */
function shellVar(script: string, name: string): string {
  const value = new RegExp(`^${name}="([^"$]+)"`, "m").exec(script)?.[1];
  expect(value, `${name}= not found`).toBeDefined();
  return value!;
}

/** `Key=value` lines from a unit file. */
function unitValues(unit: string, key: string): string[] {
  return [...unit.matchAll(new RegExp(`^${key}=(.+)$`, "gm"))].map((m) =>
    m[1]!.trim(),
  );
}

describe("the dispatcher and the files it depends on agree", () => {
  it("names a workflow that exists and accepts workflow_dispatch", () => {
    const workflow = shellVar(DISPATCH, "WORKFLOW");
    const yml = readFileSync(
      path.join(ROOT, ".github", "workflows", workflow),
      "utf8",
    );
    const executable = yml
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(executable).toMatch(/^\s{2}workflow_dispatch:\s*$/m);
  });

  it("dispatches to THIS repository", () => {
    // Derived from where the code lives, not typed a second time.
    const remote =
      process.env.GITHUB_REPOSITORY ??
      execFileSync("git", ["config", "--get", "remote.origin.url"], {
        encoding: "utf8",
      })
        .trim()
        .replace(/^.*github\.com[:/]/, "")
        .replace(/\.git$/, "");
    expect(remote).toMatch(/^[\w.-]+\/[\w.-]+$/);
    expect(shellVar(DISPATCH, "REPO")).toBe(remote);
  });

  it("is installed where the service runs it, and the README command exists", () => {
    const installed = [
      ...INSTALL.matchAll(/^install -D -m 755 (\S+) (\S+)$/gm),
    ].map((m) => ({ from: m[1]!, to: m[2]! }));
    expect(installed.map((i) => i.from).sort()).toEqual([
      "dispatch.sh",
      "set-token.sh",
    ]);
    const to = (from: string) => installed.find((i) => i.from === from)!.to;
    expect(unitValues(SERVICE, "ExecStart")).toEqual([to("dispatch.sh")]);
    const command = path.posix.basename(to("set-token.sh"));
    expect(README).toContain(`ssh -t root@13.140.139.65 ${command}`);
    expect(SET_TOKEN).toContain(`Installed as ${to("set-token.sh")}`);
  });

  it("writes the token where the service loads it from, under the name the script reads", () => {
    const [credential] = unitValues(SERVICE, "LoadCredential");
    const [name, source] = credential!.split(":");
    expect(DISPATCH).toContain(`$CREDENTIALS_DIRECTORY/${name}`);
    const tokenDefault = (script: string) =>
      /PDFXYZ_DISPATCH_TOKEN_FILE:-([^}]+)\}/.exec(script)?.[1];
    expect(tokenDefault(SET_TOKEN)).toBe(source);
    expect(tokenDefault(DISPATCH)).toBe(source);
    expect(INSTALL).toContain(`-s ${source} ]]`);
  });

  it("the timer drives this service, and every doc states its real cadence", () => {
    expect(unitValues(TIMER, "Unit")).toEqual([
      "pdfxyz-posture-dispatch.service",
    ]);
    const unitName = "pdfxyz-posture-dispatch.timer";
    expect(SET_TOKEN).toContain(`systemctl enable --now ${unitName}`);
    expect(INSTALL).toContain(`systemctl enable --now ${unitName}`);

    const [calendar] = unitValues(TIMER, "OnCalendar");
    const match = /\*:(\d{2})\/(\d+):00 UTC$/.exec(calendar!);
    expect(match, `unparsed OnCalendar=${calendar}`).not.toBeNull();
    const [first, step] = [Number(match![1]), Number(match![2])];
    const minutes: number[] = [];
    for (let m = first; m < 60; m += step) minutes.push(m);
    // At least twice an hour, so one lost start never leaves an hour unwatched.
    expect(minutes.length).toBeGreaterThanOrEqual(2);
    for (const doc of [README, TIMER]) {
      expect(doc).toMatch(new RegExp(`every ${step} minutes`));
    }
    const named = minutes.map((m) => `:${String(m).padStart(2, "0")}`);
    expect(README).toContain(
      `${named.slice(0, -1).join(", ")} and ${named.at(-1)} UTC`,
    );
  });

  it("hands curl the token on stdin, and prints nothing but its length", () => {
    const lines = DISPATCH.split("\n").filter((l) => !/^\s*#/.test(l));
    const auth = lines.filter((l) => l.includes("Authorization"));
    expect(auth).toHaveLength(1);
    expect(auth[0]).toMatch(/^\s*printf .*"\$token" \|$/);
    expect(DISPATCH).toMatch(/curl [^\n]*--config - /);
    for (const script of [DISPATCH, SET_TOKEN]) {
      const shown = script
        .split("\n")
        .filter((l) => /^\s*echo /.test(l))
        .filter((l) => /\$\{?token\b/.test(l));
      expect(shown, "an echo prints the token").toEqual([]);
    }
  });
});

describe("scripts/posture-dispatch/dispatch.sh, run as systemd runs it", () => {
  type Seen = {
    method?: string;
    url?: string;
    auth?: string;
    body: string;
  };
  const seen: Seen[] = [];
  let answer = 204;
  let api = "";
  const server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body,
      });
      res.writeHead(answer).end();
    });
  });

  // Shaped like a real fine-grained token; it is the part that must stay quiet.
  const TOKEN = `github_pat_11TEST${"0123456789abcdef".repeat(5)}`;
  const tmp = mkdtempSync(path.join(tmpdir(), "posture-dispatch-"));
  const tokenFile = path.join(tmp, "posture-dispatch.token");
  writeFileSync(tokenFile, `${TOKEN}\n`);

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function run(env: Record<string, string | undefined>) {
    seen.length = 0;
    return new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(BASH, [path.join(DIR, "dispatch.sh")], {
        env: {
          ...process.env,
          CREDENTIALS_DIRECTORY: undefined,
          PDFXYZ_GITHUB_API: api,
          PDFXYZ_DISPATCH_TOKEN_FILE: path.join(tmp, "absent"),
          ...env,
        },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  }

  it("starts posture-watch on main with the token as a bearer header", async () => {
    answer = 204;
    const { code, out } = await run({ PDFXYZ_DISPATCH_TOKEN_FILE: tokenFile });
    expect(out).toMatch(/started posture-watch\.yml on main → HTTP 204/);
    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      method: "POST",
      url: "/repos/baki2222/pdf.xyz/actions/workflows/posture-watch.yml/dispatches",
      auth: `Bearer ${TOKEN}`,
      body: '{"ref":"main"}',
    });
    expect(out).not.toContain("0123456789abcdef");
  });

  it("reads the systemd credential when the service hands one over", async () => {
    answer = 204;
    const credentials = mkdtempSync(path.join(tmpdir(), "credentials-"));
    writeFileSync(path.join(credentials, "token"), TOKEN);
    const { code } = await run({ CREDENTIALS_DIRECTORY: credentials });
    expect(code).toBe(0);
    expect(seen.map((s) => s.auth)).toEqual([`Bearer ${TOKEN}`]);
  });

  it("fails, and says why, when GitHub refuses the token", async () => {
    answer = 401;
    const { code, out } = await run({ PDFXYZ_DISPATCH_TOKEN_FILE: tokenFile });
    expect(code).toBe(1);
    expect(seen).toHaveLength(1);
    expect(out).toMatch(/HTTP 401 \(the token expired or was revoked/);
    expect(out).not.toContain("0123456789abcdef");
  });

  it("sends nothing, and says so, with no token installed", async () => {
    const { code, out } = await run({});
    expect(code).toBe(0);
    expect(seen).toEqual([]);
    expect(out).toMatch(/no token installed — nothing dispatched/);
  });

  it("sends nothing when the file is not a token (it could break the curl config)", async () => {
    const bad = path.join(tmp, "bad.token");
    writeFileSync(bad, 'abc"\nheader = "X-Injected: 1');
    const { code, out } = await run({ PDFXYZ_DISPATCH_TOKEN_FILE: bad });
    expect(code).toBe(1);
    expect(seen).toEqual([]);
    expect(out).toMatch(/does not hold a GitHub token/);
  });

  // The setter's last word is the only thing the owner reads. On 2026-11-03
  // it was systemd's "Finished …" — true of a 401 as much as of a 204 —
  // because it printed the unit's LAST journal line. Composed here: the
  // script's real output, placed in a journal shaped as the worker host
  // recorded that start, read back through the setter.
  it("set-token.sh shows the owner what the run it started printed, as the README promises", async () => {
    answer = 204;
    const dispatched = await run({ PDFXYZ_DISPATCH_TOKEN_FILE: tokenFile });
    expect(dispatched.code).toBe(0);
    const unit = "pdfxyz-posture-dispatch.service";
    const journal = [
      `-\tStarting ${unit} - Start one pdf.xyz posture-watch run on GitHub...`,
      ...dispatched.out
        .trim()
        .split("\n")
        .map((line) => `inv-1\t${line}`),
      `-\t${unit}: Deactivated successfully.`,
      `-\tFinished ${unit} - Start one pdf.xyz posture-watch run on GitHub.`,
    ];

    const stubs = mkdtempSync(path.join(tmpdir(), "posture-setter-"));
    const stub = (name: string, body: string) =>
      writeFileSync(path.join(stubs, name), `#!/usr/bin/env bash\n${body}`, {
        mode: 0o755,
      });
    writeFileSync(path.join(stubs, "journal.tsv"), `${journal.join("\n")}\n`);
    stub(
      "systemctl",
      `echo "$*" >>"$STUBS/systemctl.log"\n[[ "$1" == show ]] && echo inv-1\nexit 0\n`,
    );
    // journalctl over the recorded journal: <_SYSTEMD_INVOCATION_ID>\t<MESSAGE>.
    stub(
      "journalctl",
      [
        'inv="" n=""',
        "while (($#)); do",
        '  case "$1" in',
        "    --sync) exit 0 ;;",
        '    _SYSTEMD_INVOCATION_ID=*) inv="${1#*=}" ;;',
        '    -n) n="$2"; shift ;;',
        "  esac",
        "  shift",
        "done",
        "while IFS=$'\\t' read -r id msg; do",
        '  [[ -z "$inv" || "$id" == "$inv" ]] && printf \'%s\\n\' "$msg"',
        'done <"$STUBS/journal.tsv" | if [[ -n "$n" ]]; then tail -n "$n"; else cat; fi',
        "",
      ].join("\n"),
    );

    // Git for Windows' `install -d` cannot chmod the directory it makes
    // ("Permission denied" on every drive), so there it is a plain mkdir;
    // Linux runs the real one. The setter only ever calls `install -d`.
    if (process.platform === "win32") {
      stub(
        "install",
        '[[ "$1" == -d ]] || exit 2\nshift\n[[ "$1" == -m ]] && shift 2\nmkdir -p "$@"\n',
      );
    }

    // A directory the setter creates, as /etc/pdfxyz is on a fresh host.
    const saved = path.join(stubs, "etc", "saved.token");
    const out = await new Promise<string>((resolve) => {
      // PATH is set inside bash: Git for Windows' bash.exe puts its own
      // directories first, so a stub prepended from here loses to them.
      const child = spawn(
        BASH,
        [
          "-c",
          'PATH="$(cd "$STUBS" && pwd):$PATH"; exec bash "$1"',
          "bash",
          path.join(DIR, "set-token.sh"),
        ],
        {
          env: {
            ...process.env,
            STUBS: stubs,
            PDFXYZ_DISPATCH_TOKEN_FILE: saved,
          },
        },
      );
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("close", () => resolve(text));
      child.stdin.end(`${TOKEN}\n`);
    });

    const promised = /prints the result, for example\s+`([^`]+)`/.exec(
      README,
    )?.[1];
    expect(
      promised,
      "README no longer says what the setter prints",
    ).toBeTruthy();
    expect(out).toContain(`Saved the token (${TOKEN.length} characters).`);
    expect(out).toContain(promised);
    expect(out).not.toContain("Finished");
    expect(out).not.toContain("0123456789abcdef");
    expect(readFileSync(saved, "utf8")).toBe(`${TOKEN}\n`);
    // It asked about the unit it started, not some other one.
    const calls = readFileSync(path.join(stubs, "systemctl.log"), "utf8");
    expect(calls).toContain(`start ${unit}`);
    expect(calls).toContain(`show -p InvocationID --value ${unit}`);
  });
});
