// @vitest-environment node
/**
 * Static, no-secret proof for the committed observability examples under
 * `docs/examples/observability/`. It pins each example to the metric schema — every
 * metric, label, and SLO id it references must be on the allowlist — and asserts each
 * file is content-free (no endpoint, host, bucket, key, filename, or secret). Offline:
 * it reads committed files only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { METRIC_NAMES, METRIC_SCHEMA, type WorkerMetricName } from "./metrics";
import { SLO_IDS } from "./slo";

const DIR = join(process.cwd(), "docs", "examples", "observability");
const read = (f: string): string => readFileSync(join(DIR, f), "utf8");
const readJson = (f: string): unknown => JSON.parse(read(f));

const FILES = ["dashboard.json", "alerts.json", "alerts.prometheus.yml", "README.md"];

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

describe("observability examples — content-free", () => {
  it("no example leaks an endpoint, bucket, credential, or scheme", () => {
    for (const file of FILES) {
      const text = read(file).toLowerCase();
      for (const leak of FORBIDDEN) {
        expect(text, `${file} must not leak ${leak}`).not.toContain(leak);
      }
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
          expect(schema.labels[k], `${s.metric} has no label ${k}`).toBeDefined();
          expect(schema.labels[k], `${s.metric}.${k}=${v} not allowed`).toContain(v);
        }
      }
    }
  });

  it("every panel SLO reference is a known SLO id", () => {
    for (const panel of dashboard.panels) {
      if (panel.slo) expect(SLO_IDS, `unknown slo ${panel.slo}`).toContain(panel.slo);
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
      expect(SEVERITIES, `bad severity ${rule.severity}`).toContain(rule.severity);
      expect(rule.summary.length).toBeGreaterThan(0);
    }
  });

  it("has a rule for every SLO id (no silent gaps)", () => {
    const covered = new Set(alerts.rules.map((r) => r.slo));
    for (const id of SLO_IDS) expect(covered, `no alert for ${id}`).toContain(id);
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
