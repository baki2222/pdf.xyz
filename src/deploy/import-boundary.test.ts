// @vitest-environment node
/**
 * Static guard for the load-bearing deployment rule: the web app must never
 * eagerly import the worker daemon runtime or the native-compression subprocess
 * module. Those are Node-only (they shell out / pull the queue + S3 signer) and
 * belong exclusively to the out-of-band worker image and the CLI.
 *
 * A web route MAY still reach them behind `await import(...)` — the `/status`
 * route probes the native engine that way, and the adapter lazy-loads the
 * local-dev worker — so only STATIC imports (`import … from` / `export … from` /
 * side-effect `import "…"`) are forbidden. This encodes the boundary that keeps
 * `node:child_process` out of the web bundle and stops the app from ever
 * becoming the daemon; a new eager import from a route trips it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/**
 * Node-only worker internals that must not reach an eager web bundle. Substrings
 * so both the `@/`-aliased and relative import forms are caught.
 */
const FORBIDDEN = [
  "compression/native",
  "ocr-native",
  "pdf-text/native",
  "daemon/runtime",
  "node:child_process",
  // Resolves the Noto TTFs out of node_modules for the copy step, the coverage
  // generator and the guards. Reads `node:fs`, so an eager import from a
  // component would drag the filesystem into the client bundle — the exact
  // regression the pdf-lib dynamic boundary exists to prevent. The browser
  // fetches these faces from `public/`; it never resolves a package.
  "pdf/noto-source",
] as const;

/**
 * The only modules permitted to STATICALLY import the above — themselves
 * Node-only and pulled in exclusively via lazy `import()` or the CLI, never
 * eagerly by a route/component/barrel.
 */
const ALLOWED = new Set(
  [
    "src/lib/workers/compression/native.ts",
    "src/lib/workers/pdf-security/native.ts",
    "src/lib/workers/pdf-structure/native.ts",
    "src/lib/workers/pdf-archive/native.ts",
    "src/lib/workers/html-render/native.ts",
    "src/lib/workers/office-conversion/native.ts",
    "src/lib/workers/ocr-native.ts",
    // The `pdftotext` subprocess runner and every deps builder that wires it.
    // The web path must keep using the pdfjs extractors in `@/lib/pdf/*`; these
    // are reached only through `daemon/runtime` and the lazy local-dev adapter.
    "src/lib/workers/pdf-text/native.ts",
    "src/lib/workers/pdf-office-export/native.ts",
    "src/lib/workers/table-extract/native.ts",
    // The four AI engines read a PDF's selectable text before prompting a model,
    // so they take the same native extractor rather than the browser-only pdfjs one.
    "src/lib/workers/summarize/native.ts",
    "src/lib/workers/translate/native.ts",
    "src/lib/workers/ai-extract/native.ts",
    "src/lib/workers/chat-with-pdf/native.ts",
    "src/lib/workers/local-dev.ts",
    "src/lib/workers/daemon/runtime.ts",
    // Portable-pnpm subprocess resolution: only reached by the release CLI
    // scripts (`scripts/worker-release-*.ts`) and worker `cli.smoke.test.ts`
    // helpers, never by a web route/component/barrel.
    "src/lib/workers/exec-pnpm.ts",
    "src/tests/exec-pnpm.ts",
    // Subprocess runner for the worker `cli.smoke.test.ts` tier: spawns the real
    // `tsx scripts/worker-*.ts` binary end-to-end. Node-only by design and pulled
    // in exclusively by smoke-test helpers, never by a web route/component/barrel.
    "src/tests/run-worker-cli.ts",
    // Reads the shipped Noto TTFs so a test embeds the same bytes a browser
    // would have downloaded. Test-side only: `setup.ts` is vitest's setupFile
    // and `unicode-fonts.ts` is pulled in by `*.test.ts` files. Neither is
    // reachable from a route, a component or a barrel.
    "src/tests/unicode-fonts.ts",
    "src/tests/setup.ts",
    // Spawns `render-tool-pages.ts` in a fresh process and parses the tool
    // pages' JSON-LD back out of the markup. Imported only by `*.test.ts` copy
    // guards; nothing on a route, a component or a barrel reaches it.
    "src/tests/rendered-tool-pages.ts",
  ].map((rel) => path.join(ROOT, rel)),
);

/** All non-test `.ts`/`.tsx` files under `src/`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Specifiers of STATIC imports only. Comments are stripped first; dynamic
 * `import(…)` has no `from` clause and is not a side-effect `import "…"`, so it
 * is never matched. Works across multi-line import statements (it matches the
 * `from "specifier"` tail, not the whole statement).
 */
function staticImportSpecifiers(source: string): string[] {
  const noComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const specs: string[] = [];
  const fromRe = /\bfrom\s*["']([^"']+)["']/g;
  const sideRe = /\bimport\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(noComments)) !== null) specs.push(m[1]!);
  while ((m = sideRe.exec(noComments)) !== null) specs.push(m[1]!);
  return specs;
}

/** Match a forbidden static import without flagging node-free config modules. */
function matchesForbiddenImport(spec: string, forbidden: string): boolean {
  if (forbidden === "compression/native") {
    return (
      spec === "@/lib/workers/compression/native" ||
      spec.endsWith("/compression/native")
    );
  }
  if (forbidden === "ocr-native") {
    // Exact leaf only — the node-free `ocr-native-config` (which ends with
    // `/ocr-native-config`) is safe to import eagerly and must NOT be flagged.
    return spec === "@/lib/workers/ocr-native" || spec.endsWith("/ocr-native");
  }
  if (forbidden === "pdf-text/native") {
    // Exact leaf only — `pdf-text/native-config` and `pdf-text/parse` are
    // node-free and safe to import eagerly.
    return (
      spec === "@/lib/workers/pdf-text/native" ||
      spec.endsWith("/pdf-text/native")
    );
  }
  return spec.includes(forbidden);
}

describe("web-eager modules do not statically import Node-only worker internals", () => {
  const files = walk(SRC);

  it("scans a meaningful number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const forbidden of FORBIDDEN) {
    it(`only the allowlisted Node-only modules statically import "${forbidden}"`, () => {
      const offenders = files
        .filter((file) => !ALLOWED.has(file))
        .filter((file) =>
          staticImportSpecifiers(readFileSync(file, "utf8")).some((spec) =>
            matchesForbiddenImport(spec, forbidden),
          ),
        )
        .map((file) => path.relative(ROOT, file));
      expect(offenders).toEqual([]);
    });
  }

  it("the eager @/lib/workers barrel pulls in neither the daemon runtime nor a native probe", () => {
    const barrel = readFileSync(path.join(SRC, "lib/workers/index.ts"), "utf8");
    const specs = staticImportSpecifiers(barrel);
    expect(specs.some((s) => s.includes("daemon/runtime"))).toBe(false);
    expect(specs.some((s) => s.includes("compression/native"))).toBe(false);
    expect(specs.some((s) => matchesForbiddenImport(s, "ocr-native"))).toBe(
      false,
    );
    expect(specs.some((s) => s.startsWith("node:"))).toBe(false);
  });

  it("the /status readiness surface uses only the node-free daemon barrel", () => {
    // The status route + page read presence-only readiness; they must reach it
    // through the node-free `daemon` barrel (args/daemon/readiness), never the
    // Node-only `daemon/runtime` wiring.
    const route = readFileSync(
      path.join(SRC, "app/api/worker/status/route.ts"),
      "utf8",
    );
    const specs = staticImportSpecifiers(route);
    expect(specs.some((s) => s.includes("daemon/runtime"))).toBe(false);
    expect(specs.some((s) => s.includes("compression/native"))).toBe(false);
    // …and it still probes the native engine, but lazily.
    expect(route).toMatch(/await import\(\s*["'][^"']*compression\/native/);
  });
});
