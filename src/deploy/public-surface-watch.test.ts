// @vitest-environment node
/**
 * The watcher that answers "does the SITE still serve?", and the CSP helper
 * that decides what its pages may talk to.
 *
 * Both are here because both are things NOTHING ELSE CAN OBSERVE from inside a
 * test run: the probe only means anything when a schedule actually runs it, and
 * the CSP only means anything as the string a browser receives. So these
 * assertions pin the WIRING and the pure function, and the probe's behaviour is
 * proven the only way it can be — by running against production, which is what
 * the workflow does hourly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Executable YAML only.
 *
 * The first version of this file asserted on the raw source, and a mutation
 * that replaced the step with `run: echo skipped` stayed GREEN — because the
 * COMMENT above the step still names the script. A guard that matches prose
 * proves the prose exists, which is the one thing nobody doubted.
 */
function executable(yaml: string): string {
  return yaml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("the scheduled watch covers the site, not only the fleet", () => {
  const workflow = executable(read(".github/workflows/posture-watch.yml"));
  const probe = read("scripts/check-public-surface.mjs");

  it("runs BOTH checks on the schedule", () => {
    // Before 2026-08-25 this workflow ran one probe against one JSON payload,
    // so a 500 on /tools or a lost noindex header alerted nobody.
    expect(workflow).toMatch(
      /run:\s*node scripts\/check-operations-posture\.mjs/,
    );
    expect(workflow).toMatch(/run:\s*node scripts\/check-public-surface\.mjs/);
    expect(workflow).toMatch(/cron:\s*"[^"]+"/);
  });

  it("lets each check fail independently", () => {
    // Without `if: always()` a red fleet short-circuits the job and the surface
    // goes unexamined for exactly as long as the outage lasts — the hours when
    // a second failure is most likely.
    const surfaceStep = workflow.slice(
      workflow.indexOf("Check public surface"),
    );
    expect(surfaceStep).toMatch(/if:\s*always\(\)/);
  });

  it("derives its corpus from the sitemap and bounds how small it may get", () => {
    // Rule 4: a typed page list cannot see a page it does not name; and a
    // derived list that silently shrinks reports the strongest possible pass.
    expect(probe).toMatch(/<loc>/);
    expect(probe).toMatch(/MIN_SITEMAP_URLS\s*=\s*\d+/);
    expect(probe).toMatch(/locs\.length\s*<\s*MIN_SITEMAP_URLS/);
  });

  it("checks the noindex pair in BOTH directions", () => {
    // The apex must stay indexable and beta must not — and the beta assertion
    // is the positive control: if header reading broke, "the apex carries no
    // noindex" would keep passing for the wrong reason.
    expect(probe).toMatch(/wronglyHidden/);
    expect(probe).toMatch(/betaVisible/);
  });

  it("re-homes sampled URLs onto the base under test", () => {
    // The sitemap publishes ABSOLUTE canonical URLs, so without this a run
    // against any other origin probes production and reports the answers as
    // that origin's — a right command over the wrong set, in the one file
    // written to prevent it. Measured: beta went from 4 findings to 9.
    expect(probe).toMatch(/new URL\(new URL\(loc\)\.pathname, BASE\)/);
  });

  it("is dependency-free, like the check beside it", () => {
    // The workflow installs nothing, deliberately: an npm failure must not be
    // able to masquerade as a posture failure.
    expect(probe).not.toMatch(/^import .* from "(?!node:)/m);
    expect(workflow).not.toMatch(/pnpm install|npm ci/);
  });
});

describe("the CSP storage origin list", () => {
  const config = read("next.config.mjs");

  /** Evaluate the real helper out of the config, with a chosen env. */
  function storageConnectSrc(envValue?: string): string {
    const fn = config.slice(
      config.indexOf("function storageConnectSrc"),
      config.indexOf("function contentSecurityPolicy"),
    );
    const fakeProcess = {
      env:
        envValue === undefined
          ? {}
          : { NEXT_PUBLIC_STORAGE_CONNECT_SRC: envValue },
    };
    return new Function("process", `${fn}; return storageConnectSrc();`)(
      fakeProcess,
    ) as string;
  }

  it("names the R2 wildcard exactly once when the env repeats it", () => {
    // PRODUCTION SETS EXACTLY THIS STRING, so the un-deduped version shipped a
    // connect-src listing one origin twice — valid, and it reads as a mistake
    // to the only audience a CSP has.
    const value = storageConnectSrc("https://*.r2.cloudflarestorage.com");
    expect(value.split(/\s+/).filter(Boolean)).toEqual([
      "https://*.r2.cloudflarestorage.com",
    ]);
  });

  it("still carries a genuinely different configured origin", () => {
    // The dedupe must not become a filter: an operator adding a second storage
    // origin has to see it in the header.
    const value = storageConnectSrc("https://cdn.example.org");
    expect(value.split(/\s+/).filter(Boolean)).toEqual([
      "https://*.r2.cloudflarestorage.com",
      "https://cdn.example.org",
    ]);
  });

  it("falls back to the built-in origin when nothing is configured", () => {
    expect(storageConnectSrc()).toBe("https://*.r2.cloudflarestorage.com");
  });
});
