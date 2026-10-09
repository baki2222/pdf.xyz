// @vitest-environment node
/**
 * The one weigher, held to an independent measurement — over a fixture build,
 * so this runs in the ordinary suite and needs no `.next`.
 *
 * `scripts/page-weight.ts` answers "what does a prerendered page make a browser
 * download". Until 2026-10-09 it answered in UNCOMPRESSED bytes only, so every
 * gzip figure the redesign budgeted (G.1: "191.6 KB gz", "302.4 KB gz") came
 * from a one-off measurement nothing could re-run, and none of them matched the
 * build when one was finally weighed (home 202.6, tool pages 371.2). A budget
 * nobody can recompute is a constant with no relationships (CLAUDE.md rule 3),
 * so the gz figure now comes from the weigher and is checked here against a sum
 * this file computes ITSELF — `zlib.gzipSync(level 9)` per unique chunk — and
 * never through the code under test.
 *
 * The `%5Bslug%5D` decode and the fatal miss are the weigher's two earlier
 * defects; both already pass, so neither can be this file's red test. They stay
 * as regression controls.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  chunkUrls,
  prerenderedPages,
  weighPage,
} from "../../scripts/page-weight";

const ROOT = process.cwd();
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A compressible chunk body: real-looking minified JS, many KB raw. */
function chunkBody(seed: string, kb: number): string {
  const parts: string[] = [];
  let i = 0;
  while (parts.join("").length < kb * 1024) {
    parts.push(`function ${seed}${i}(a){return a+"${seed}-${i % 97}";}`);
    i++;
  }
  return parts.join("");
}

interface FixtureChunk {
  /** On-disk path under `.next/`, e.g. `static/chunks/app/tools/[slug]/page-1.js`. */
  disk: string;
  body: string;
}

/**
 * A minimal `.next`: prerendered HTML under `server/app`, chunks under
 * `static/chunks`. `pages` maps an HTML path to the chunk URLs it references
 * (as the HREF spells them, so `[slug]` appears percent-encoded).
 */
function fixtureBuild(
  chunks: FixtureChunk[],
  pages: Record<string, string[]>,
): string {
  const next = mkdtempSync(path.join(os.tmpdir(), "pdfxyz-weigh-"));
  made.push(next);
  for (const chunk of chunks) {
    const file = path.join(next, chunk.disk);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, chunk.body);
  }
  mkdirSync(path.join(next, "server", "app"), { recursive: true });
  for (const [html, urls] of Object.entries(pages)) {
    const file = path.join(next, "server", "app", html);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `<!DOCTYPE html><html><head>${urls
        .map((u) => `<script src="${u}" async=""></script>`)
        .join("")}</head><body><h1>fixture</h1></body></html>`,
    );
  }
  return next;
}

const SHARED: FixtureChunk = {
  disk: "static/chunks/4821-aa.js",
  body: chunkBody("shared", 60),
};
const SLUG: FixtureChunk = {
  disk: "static/chunks/app/tools/[slug]/page-bb.js",
  body: chunkBody("slug", 30),
};
const URL_SHARED = "/_next/static/chunks/4821-aa.js";
const URL_SLUG = "/_next/static/chunks/app/tools/%5Bslug%5D/page-bb.js";

describe("page-weight measures gzip the way a browser fetches the page", () => {
  // Referenced twice: a page that names a chunk twice downloads it once.
  const next = fixtureBuild([SHARED, SLUG], {
    "tools/rotate-pdf.html": [URL_SHARED, URL_SLUG, URL_SHARED],
  });

  it("gzKb is the gzip -9 size of each UNIQUE chunk, summed — computed here independently", () => {
    const independent = [SHARED, SLUG]
      .map((c) => gzipSync(Buffer.from(c.body), { level: 9 }).length)
      .reduce((a, b) => a + b, 0);
    const w = weighPage(next, "tools/rotate-pdf.html");
    expect(w).not.toBeNull();
    expect(w!.gzKb).toBe(Math.round((independent / 1024) * 10) / 10);
  });

  it("health check: 0 < gzKb < kb, so a zero or an uncompressed figure cannot pass", () => {
    const w = weighPage(next, "tools/rotate-pdf.html")!;
    expect(w.kb).toBeGreaterThan(50);
    expect(w.gzKb).toBeGreaterThan(0);
    expect(w.gzKb).toBeLessThan(w.kb);
  });

  it("names the files it weighed, decoded, once each, in the order the page references them", () => {
    const w = weighPage(next, "tools/rotate-pdf.html")!;
    expect(w.files).toEqual([
      path.join(next, "static", "chunks", "4821-aa.js"),
      path.join(
        next,
        "static",
        "chunks",
        "app",
        "tools",
        "[slug]",
        "page-bb.js",
      ),
    ]);
    // `sized` carries the same set, each with its own gz figure.
    expect(w.sized.map((c) => c.gzBytes).every((n) => n > 0)).toBe(true);
    expect(w.sized.map((c) => c.file).sort()).toEqual([...w.files].sort());
  });

  it("regression control: the percent-encoded [slug] chunk is weighed, not counted at zero", () => {
    const w = weighPage(next, "tools/rotate-pdf.html")!;
    expect(w.chunks).toBe(2);
    const raw = Buffer.byteLength(SHARED.body) + Buffer.byteLength(SLUG.body);
    expect(w.kb).toBe(Math.round(raw / 1024));
    expect(chunkUrls(next, "tools/rotate-pdf.html")).toContain(URL_SLUG);
  });

  it("regression control: a referenced chunk missing on disk is fatal, not silently light", () => {
    const broken = fixtureBuild([SHARED], {
      "index.html": [URL_SHARED, "/_next/static/chunks/gone-cc.js"],
    });
    expect(() => weighPage(broken, "index.html")).toThrow(/gone-cc\.js/);
  });
});

describe("prerenderedPages is every page the build wrote, derived from disk", () => {
  it("walks nested routes, returns posix paths, and ignores what is not a page", () => {
    const next = fixtureBuild([SHARED], {
      "index.html": [URL_SHARED],
      "_not-found.html": [URL_SHARED],
      "tools/rotate-pdf.html": [URL_SHARED],
      "tools/category/organize.html": [URL_SHARED],
      "guides/how-to-merge-pdf-files.html": [URL_SHARED],
    });
    // Siblings a real build writes next to the HTML: flight data and metadata.
    writeFileSync(path.join(next, "server", "app", "index.rsc"), "0:{}");
    writeFileSync(path.join(next, "server", "app", "index.meta"), "{}");
    expect(prerenderedPages(next)).toEqual([
      "_not-found.html",
      "guides/how-to-merge-pdf-files.html",
      "index.html",
      "tools/category/organize.html",
      "tools/rotate-pdf.html",
    ]);
  });

  it("an absent build is an error, not an empty set that every ⊆ check passes", () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "pdfxyz-weigh-empty-"));
    made.push(empty);
    expect(() => prerenderedPages(empty)).toThrow(/server[\\/]app/);
  });
});

/**
 * `pnpm weigh:pages` is the table every budget change is argued from, so it is
 * tested where it is consumed: the real script, spawned the way package.json
 * runs it, against a fixture build.
 */
function runWeighPages(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(ROOT, "scripts", "weigh-pages.ts"),
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

// Every case below spawns the real CLI through tsx, two or three times. Alone
// the block takes under 2 s; in a loaded full-suite run on 2026-10-09 the first
// case timed out at vitest's 5 s default (green alone) — the same class as
// 2b20baa7, so the same remedy: an explicit budget for each spawning case.
const SPAWNS = 30_000;

describe("pnpm weigh:pages refuses to print a smaller table than it was asked for", () => {
  it(
    "a listed page with no HTML in the build exits 1 — table and --json",
    () => {
      // Before 2026-10-09 a missing page returned null and was FILTERED out of
      // the rows: the script printed a shorter table and exited 0, so a renamed
      // route silently left the before/after comparison.
      const next = fixtureBuild([SHARED], { "index.html": [URL_SHARED] });
      for (const mode of [[], ["--json"]]) {
        const run = runWeighPages(["--next-dir", next, ...mode]);
        expect(run.status, `mode ${mode.join(" ") || "table"}`).toBe(1);
        expect(run.stderr).toMatch(/not in the build/);
      }
    },
    SPAWNS,
  );

  it(
    "a complete build prints raw and gz for every listed page, equal to weighPage",
    async () => {
      const { WEIGHED_PAGES } = await import("../../scripts/weigh-pages");
      // Health check on the list itself: an empty list would make every
      // assertion below vacuous.
      expect(WEIGHED_PAGES.length).toBeGreaterThanOrEqual(8);
      const next = fixtureBuild(
        [SHARED, SLUG],
        Object.fromEntries(
          WEIGHED_PAGES.map((p) => [
            p.html,
            p.html.startsWith("tools/") ? [URL_SHARED, URL_SLUG] : [URL_SHARED],
          ]),
        ),
      );
      const run = runWeighPages(["--next-dir", next, "--json"]);
      expect(run.status, run.stderr).toBe(0);
      const rows = JSON.parse(run.stdout) as {
        html: string;
        kb: number;
        gzKb: number;
      }[];
      expect(rows.map((r) => r.html)).toEqual(WEIGHED_PAGES.map((p) => p.html));
      for (const row of rows) {
        const w = weighPage(next, row.html)!;
        expect(row.kb, row.html).toBe(w.kb);
        expect(row.gzKb, row.html).toBe(w.gzKb);
      }
      const table = runWeighPages(["--next-dir", next]);
      expect(table.status, table.stderr).toBe(0);
      expect(table.stdout).toMatch(/KB raw/);
      expect(table.stdout).toMatch(/KB gz/);
    },
    SPAWNS,
  );

  it(
    "--baseline prints the delta against an earlier --json run",
    async () => {
      const { WEIGHED_PAGES } = await import("../../scripts/weigh-pages");
      const next = fixtureBuild(
        [SHARED],
        Object.fromEntries(WEIGHED_PAGES.map((p) => [p.html, [URL_SHARED]])),
      );
      const now = JSON.parse(
        runWeighPages(["--next-dir", next, "--json"]).stdout,
      ) as { html: string; kb: number; gzKb: number }[];
      // An earlier build where the homepage was 10 KB raw / 2.5 KB gz lighter,
      // and the 404 was not weighed at all.
      const before = now
        .filter((r) => r.html !== "_not-found.html")
        .map((r) =>
          r.html === "index.html"
            ? {
                ...r,
                kb: r.kb - 10,
                gzKb: Math.round((r.gzKb - 2.5) * 10) / 10,
              }
            : r,
        );
      const file = path.join(next, "baseline.json");
      writeFileSync(file, JSON.stringify(before));
      const run = runWeighPages(["--next-dir", next, "--baseline", file]);
      expect(run.status, run.stderr).toBe(0);
      const home = run.stdout.split("\n").find((l) => l.includes("homepage"));
      expect(home).toMatch(/\+10 KB raw/);
      expect(home).toMatch(/\+2\.5 KB gz/);
      const notFound = run.stdout.split("\n").find((l) => l.includes("404"));
      expect(notFound).toMatch(/new/);
      // An unreadable baseline is an error, not a table with no deltas.
      const bad = runWeighPages([
        "--next-dir",
        next,
        "--baseline",
        file + ".x",
      ]);
      expect(bad.status).toBe(1);
    },
    SPAWNS,
  );

  it(
    "is spawned the way package.json runs it",
    () => {
      const pkg = JSON.parse(
        readFileSync(path.join(ROOT, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> };
      expect(pkg.scripts["weigh:pages"]).toBe("tsx scripts/weigh-pages.ts");
    },
    SPAWNS,
  );
});

/**
 * A suite that reads `.next` must run AFTER the build and never before it. CI's
 * unit step (`pnpm test`) runs before `pnpm build`; its bundle step
 * (`pnpm test:bundle`) runs after. Such a suite in the unit step is red for
 * want of a build; left out of the bundle step it never runs at all, which is
 * worse because nothing says so.
 *
 * The set is DERIVED by the assertion every build-reading suite opens with,
 * `has a build to measure` (it refuses to skip silently when `.next` is
 * absent), never typed: a typed list here would be the third copy of the two
 * script strings it is checking.
 */
describe("every suite that needs the build runs after it, and only there", () => {
  const SRC = path.join(ROOT, "src");
  const needsBuild = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.test\.tsx?$/.test(entry.name) &&
          full !== path.join(SRC, "deploy", "page-weight.test.ts") &&
          /it\(\s*["']has a build to measure["']/.test(
            readFileSync(full, "utf8"),
          )
        )
          out.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    };
    walk(SRC);
    return out.sort();
  };
  const scripts = (
    JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  it("health check: the derivation finds the build suites", () => {
    expect(needsBuild()).toEqual(
      expect.arrayContaining([
        "src/deploy/bundle-budget.test.ts",
        "src/deploy/lazy-chunks.test.ts",
      ]),
    );
  });

  it("`pnpm test` excludes exactly them", () => {
    const excluded = [
      ...scripts.test!.matchAll(/--exclude\s+['"]?([^\s'"]+)['"]?/g),
    ].map((m) => m[1]!);
    expect(excluded.sort()).toEqual(needsBuild());
  });

  it("`pnpm test:bundle` runs exactly them", () => {
    const run = scripts["test:bundle"]!.replace(/^vitest run\s+/, "");
    expect(run.split(/\s+/).sort()).toEqual(needsBuild());
  });
});
