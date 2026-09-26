// @vitest-environment node
/**
 * Static, no-secret proof for the committed observability examples under
 * `docs/examples/observability/`. It pins each example to the metric schema — every
 * metric, label, and SLO id it references must be on the allowlist — and asserts every
 * file in the directory TREE is content-free (no endpoint, host, bucket, key, filename,
 * or secret). Offline: it reads committed files only.
 *
 * History: the leak scan used to walk a hand-typed list of the 4 top-level files while
 * this docblock claimed the directory. The tree holds 11: the six `healthcheck/*.json`
 * were scanned by `ops-check/examples.test.ts`, but `healthcheck/README.md` was scanned
 * by nothing, and any new example file would have been too. The set is now DISCOVERED
 * by walking the tree, with a floor so a walk that quietly shrinks cannot pass.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { METRIC_NAMES, METRIC_SCHEMA, type WorkerMetricName } from "./metrics";
import { SLO_IDS } from "./slo";

const DIR = join(process.cwd(), "docs", "examples", "observability");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

/** Every file under `root`, recursively, as sorted POSIX paths relative to `root`. */
function walk(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix), {
    withFileTypes: true,
  })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

/** The scanned set: discovered from the tree, never typed. */
const FILES = walk(DIR);

/**
 * The floor for the discovered set. Not the subjects (the walk supplies those) — a
 * bound, so a walk that stops descending or a directory that moves fails LOUDLY
 * instead of reporting the vacuous pass of scanning nothing. The four top-level
 * files, plus the one nested doc no other test scanned before this walk existed.
 */
const MUST_SCAN = [
  "dashboard.json",
  "alerts.json",
  "alerts.prometheus.yml",
  "README.md",
  "healthcheck/README.md",
];
const MIN_FILES = 11;

const FORBIDDEN = [
  "amazonaws",
  "akia",
  "://",
  "secretaccesskey",
  "us-east-1",
  ".upstash.io",
  ".r2.cloudflarestorage",
  "password",
  "bearer ",
];

/** The FORBIDDEN entries `text` contains, case-insensitively. */
function leaksIn(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN.filter((leak) => lower.includes(leak));
}

/** Every `file: leak` pair in the tree under `root` — the scan the test runs. */
function scanTree(root: string): string[] {
  return walk(root).flatMap((file) =>
    leaksIn(readFileSync(join(root, file), "utf8")).map(
      (leak) => `${file}: ${leak}`,
    ),
  );
}

describe("observability examples — content-free", () => {
  it("the scanned set is discovered from the tree and cannot quietly shrink", () => {
    for (const f of MUST_SCAN) expect(FILES, `the walk lost ${f}`).toContain(f);
    expect(FILES.length).toBeGreaterThanOrEqual(MIN_FILES);
    // It descends: at least one scanned file is nested below the top level.
    expect(FILES.some((f) => f.includes("/"))).toBe(true);
  });

  it("no example anywhere in the tree leaks an endpoint, bucket, credential, or scheme", () => {
    expect(scanTree(DIR)).toEqual([]);
  });

  it("positive control: every FORBIDDEN entry is caught, in any case, in a nested file", () => {
    // Rule 1 in the other direction: a pattern nothing exercises is decoration.
    for (const leak of FORBIDDEN) {
      expect(leaksIn(`x ${leak.toUpperCase()} x`), leak).toContain(leak);
    }
    // And the composed walk + scan reaches a file two levels down.
    const root = mkdtempSync(join(tmpdir(), "obs-examples-"));
    try {
      mkdirSync(join(root, "a", "b"), { recursive: true });
      writeFileSync(join(root, "clean.md"), "worker_job_total{outcome=ok}\n");
      writeFileSync(
        join(root, "a", "b", "leak.md"),
        "curl https://example.invalid\n",
      );
      expect(walk(root)).toEqual(["a/b/leak.md", "clean.md"]);
      expect(scanTree(root)).toEqual(["a/b/leak.md: ://"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("every JSON example parses", () => {
    for (const file of FILES.filter((f) => f.endsWith(".json"))) {
      expect(() => JSON.parse(read(file))).not.toThrow();
    }
  });
});

describe("dashboard.json references only schema metrics + labels", () => {
  const dashboard = readJson("dashboard.json") as {
    panels: {
      slo?: string;
      series: { metric: string; labels?: Record<string, string> }[];
    }[];
  };

  it("every panel series is a known metric with allowed labels", () => {
    for (const panel of dashboard.panels) {
      for (const s of panel.series) {
        expect(METRIC_NAMES, `unknown metric ${s.metric}`).toContain(s.metric);
        const schema = METRIC_SCHEMA[s.metric as WorkerMetricName];
        for (const [k, v] of Object.entries(s.labels ?? {})) {
          expect(
            schema.labels[k],
            `${s.metric} has no label ${k}`,
          ).toBeDefined();
          expect(
            schema.labels[k],
            `${s.metric}.${k}=${v} not allowed`,
          ).toContain(v);
        }
      }
    }
  });

  it("every panel SLO reference is a known SLO id", () => {
    for (const panel of dashboard.panels) {
      if (panel.slo)
        expect(SLO_IDS, `unknown slo ${panel.slo}`).toContain(panel.slo);
    }
  });
});

describe("alerts.json covers every SLO with a bounded severity", () => {
  const alerts = readJson("alerts.json") as {
    rules: { slo: string; severity: string; summary: string }[];
  };
  const SEVERITIES = ["page", "ticket", "warn"];

  it("every rule targets a known SLO with an allowed severity", () => {
    for (const rule of alerts.rules) {
      expect(SLO_IDS, `unknown slo ${rule.slo}`).toContain(rule.slo);
      expect(SEVERITIES, `bad severity ${rule.severity}`).toContain(
        rule.severity,
      );
      expect(rule.summary.length).toBeGreaterThan(0);
    }
  });

  it("has a rule for every SLO id (no silent gaps)", () => {
    const covered = new Set(alerts.rules.map((r) => r.slo));
    for (const id of SLO_IDS)
      expect(covered, `no alert for ${id}`).toContain(id);
  });
});

describe("alerts.prometheus.yml references only real metrics", () => {
  it("every worker_ token maps to a schema metric (allowing _bucket/_count histogram suffixes)", () => {
    const text = read("alerts.prometheus.yml");
    const tokens = new Set(text.match(/worker_[a-z0-9_]+/g) ?? []);
    expect(tokens.size).toBeGreaterThan(0);
    for (const token of tokens) {
      const base = token.replace(/_(bucket|count)$/, "");
      expect(METRIC_NAMES, `unknown metric token ${token}`).toContain(base);
    }
  });

  it("references SLO ids in its rule labels", () => {
    const text = read("alerts.prometheus.yml");
    expect(text).toContain("slo: job_success_rate");
    expect(text).toContain("histogram_quantile");
  });
});
