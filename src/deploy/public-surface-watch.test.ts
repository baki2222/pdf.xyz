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
import { readdirSync, readFileSync } from "node:fs";
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

/**
 * The watcher's scripts, DISCOVERED: every `scripts/check-*.mjs`.
 *
 * Until 2026-09-27 the coverage test named two scripts, and was titled "runs
 * BOTH checks", while the workflow ran three. The third —
 * `check-backup-freshness.mjs`, the only thing proving nightly database dumps
 * land in R2, and the check that found the 2026-09-17 backup outage — was
 * guarded by nothing: it could be deleted from the schedule or turned into
 * `echo skipped` with every test green. A named list cannot see a script it
 * does not name (rule 4), so the set is the directory, and a new check script
 * is watched the day it lands or this fails and says why.
 */
const CHECK_SCRIPTS = readdirSync(path.join(ROOT, "scripts"))
  .filter((name) => /^check-.*\.mjs$/.test(name))
  .sort();

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The workflow's steps, each as its own text, in order. */
function steps(yaml: string): string[] {
  // `- uses:` as well as `- name:` — the two setup steps carry no name, and
  // splitting on names alone would fold them into their neighbours.
  return executable(yaml)
    .split(/^\s*- (?=(?:name|uses):)/m)
    .slice(1);
}

/** Scripts from CHECK_SCRIPTS with no step that EXECUTES exactly them. */
function unscheduled(yaml: string): string[] {
  const code = executable(yaml);
  return CHECK_SCRIPTS.filter(
    (name) =>
      // Anchored both ends: `run: echo skipped # node scripts/x.mjs` and
      // `run: node scripts/x.mjs || true` must not count as running it.
      !new RegExp(
        `^\\s*run:\\s*node scripts/${escapeRegExp(name)}\\s*$`,
        "m",
      ).test(code),
  );
}

/**
 * Every step after the first `run:` step, by its own text, that lacks
 * `if: always()`. Returns [checked, missing] so a caller can bound the first.
 */
function notIndependent(yaml: string): [string[], string[]] {
  const all = steps(yaml);
  const firstRun = all.findIndex((step) => /^\s*run:/m.test(step));
  const later = all.slice(firstRun + 1).filter((s) => /^\s*run:/m.test(s));
  const label = (step: string) =>
    /name:\s*(.+)/.exec(step)?.[1]?.trim() ?? step.split("\n")[0]!;
  return [
    later.map(label),
    later.filter((step) => !/^\s*if:\s*always\(\)\s*$/m.test(step)).map(label),
  ];
}

describe("the scheduled watch covers the site, not only the fleet", () => {
  const raw = read(".github/workflows/posture-watch.yml");
  const workflow = executable(raw);
  const probe = read("scripts/check-public-surface.mjs");

  it("runs EVERY scripts/check-*.mjs on the schedule", () => {
    // Before 2026-08-25 this workflow ran one probe against one JSON payload,
    // so a 500 on /tools or a lost noindex header alerted nobody.
    //
    // Health check, printing the members rather than a count: the discovery
    // must see at least the three this watcher is known to run, or an empty
    // directory read would pass as "everything is scheduled".
    expect(CHECK_SCRIPTS).toEqual(
      expect.arrayContaining([
        "check-backup-freshness.mjs",
        "check-operations-posture.mjs",
        "check-public-surface.mjs",
      ]),
    );
    expect(
      unscheduled(raw),
      "a scripts/check-*.mjs is not executed by posture-watch.yml; schedule it, " +
        "or rename it if it is not a posture check",
    ).toEqual([]);
    expect(workflow).toMatch(/cron:\s*"[^"]+"/);
  });

  it("lets each check fail independently", () => {
    // Without `if: always()` a red fleet short-circuits the job and the surface
    // goes unexamined for exactly as long as the outage lasts — the hours when
    // a second failure is most likely.
    //
    // HISTORY: this used to slice from "Check public surface" to END OF FILE
    // and look for `if: always()` anywhere in the slice — so the backup step's
    // own `if: always()`, below it, satisfied the check for the surface step.
    // Each step is now judged by its own text.
    const [checked, missing] = notIndependent(raw);
    expect(
      checked.length,
      `checked: ${checked.join(", ")}`,
    ).toBeGreaterThanOrEqual(CHECK_SCRIPTS.length - 1);
    expect(missing).toEqual([]);
  });

  it("CONTROL: the predicates fail on the mutations they exist to catch", () => {
    // Surface step loses `if: always()`, backup step keeps it — the exact case
    // the end-of-file slice passed.
    const surfaceDependent = raw.replace(
      /(- name: Check public surface\n)\s*if: always\(\)\n/,
      "$1",
    );
    expect(surfaceDependent, "mutation 1 never landed").not.toBe(raw);
    expect(notIndependent(surfaceDependent)[1]).toEqual([
      "Check public surface",
    ]);

    const backupDependent = raw.replace(
      /(- name: Check backup freshness\n)\s*if: always\(\)\n/,
      "$1",
    );
    expect(backupDependent, "mutation 2 never landed").not.toBe(raw);
    expect(notIndependent(backupDependent)[1]).toEqual([
      "Check backup freshness",
    ]);

    for (const name of CHECK_SCRIPTS) {
      const line = new RegExp(`run: node scripts/${escapeRegExp(name)}`);
      for (const replacement of [
        "run: echo skipped",
        `run: echo skipped # node scripts/${name}`,
        `run: node scripts/${name} || true`,
      ]) {
        const mutated = raw.replace(line, replacement);
        expect(mutated, `mutation on ${name} never landed`).not.toBe(raw);
        expect(unscheduled(mutated)).toEqual([name]);
      }
    }
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

  it("every check it runs is dependency-free", () => {
    // The workflow installs nothing, deliberately: an npm failure must not be
    // able to masquerade as a posture failure. Every discovered script, not
    // only the surface probe — the backup check signs its own R2 request with
    // node:crypto for exactly this reason.
    const PACKAGE_IMPORT = /^import\s[^;]*?from\s*["'](?!node:)/m;
    // Positive control, both directions, so a regex that matches nothing
    // cannot report every script clean.
    expect('import { z } from "zod";').toMatch(PACKAGE_IMPORT);
    expect('import {\n  a,\n} from "undici";').toMatch(PACKAGE_IMPORT);
    expect('import { createHmac } from "node:crypto";').not.toMatch(
      PACKAGE_IMPORT,
    );
    for (const name of CHECK_SCRIPTS)
      expect(read(`scripts/${name}`), name).not.toMatch(PACKAGE_IMPORT);
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
