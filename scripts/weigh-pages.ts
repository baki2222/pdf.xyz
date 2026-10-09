/**
 * Weigh what a prerendered page makes a browser download — the ONE script run
 * over BOTH artifacts when comparing builds, so a before/after can never be an
 * artifact of two different methods (the "502 → 448 KB" mistake this repo has
 * already published once came from curling a running server across rebuilds).
 *
 * Same weigher as `src/deploy/bundle-budget.test.ts` (both import
 * ./page-weight, and that test runs this script against it): the chunk list is
 * read from the HTML `next build` prerendered — exactly what a browser would
 * fetch. Two figures per page: `raw` is UNCOMPRESSED bytes on disk (~3×
 * transfer; the unit of the raw budgets), and `gz` is gzip -9 of each unique
 * chunk, summed (close to transfer; the unit of the redesign's growth
 * allowances). Compare either only against this script on another artifact.
 *
 *   pnpm weigh:pages                          # table for the standard pages
 *   pnpm weigh:pages --json                   # machine-readable, for diffing
 *   pnpm weigh:pages --baseline before.json   # table with deltas vs a --json run
 *   pnpm weigh:pages --next-dir <dir>         # weigh another build directory
 *
 * EXIT 1 when a listed page is not in the build, or a page references a chunk
 * that is not on disk. Until 2026-10-09 a missing page was filtered out of the
 * rows and the script exited 0 with a shorter table — so a renamed route left
 * the before/after comparison without anyone being told.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { weighPage } from "./page-weight";

/**
 * The pages the table prints. Every page `bundle-budget.test.ts` budgets must
 * be here (that test checks it), so a budget change is always argued from a
 * row this script printed.
 */
export const WEIGHED_PAGES = [
  { name: "homepage", html: "index.html" },
  { name: "rotate-pdf (client-side)", html: "tools/rotate-pdf.html" },
  { name: "merge-pdf (client-side)", html: "tools/merge-pdf.html" },
  { name: "ocr-pdf (worker)", html: "tools/ocr-pdf.html" },
  { name: "summarize-pdf (AI)", html: "tools/summarize-pdf.html" },
  { name: "pdf-to-jpg (pdfjs)", html: "tools/pdf-to-jpg.html" },
  { name: "pdf-to-text (pdfjs)", html: "tools/pdf-to-text.html" },
  { name: "guide (merge)", html: "guides/how-to-merge-pdf-files.html" },
  { name: "404", html: "_not-found.html" },
  { name: "tools explorer", html: "tools.html" },
  { name: "workspace", html: "workspace.html" },
] as const;

interface PageRow {
  name: string;
  html: string;
  chunks: number;
  kb: number;
  gzKb: number;
  largest: { file: string; kb: number; gzKb: number }[];
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

function row(nextDir: string, html: string, name: string): PageRow | null {
  // The shared weigher (./page-weight): the same function the budget test
  // calls, so this table and the budget cannot describe different sets.
  const w = weighPage(nextDir, html);
  if (!w) return null;
  return {
    name,
    html,
    chunks: w.chunks,
    kb: w.kb,
    gzKb: w.gzKb,
    largest: w.sized.slice(0, 5).map((c) => ({
      file: path.basename(decodeURIComponent(c.url)),
      kb: Math.round(c.bytes / 1024),
      gzKb: oneDecimal(c.gzBytes / 1024),
    })),
  };
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function signed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : n === 0 ? `±${s}` : s;
}

export function main(
  argv: readonly string[] = process.argv.slice(2),
  out: (s: string) => void = (s) => process.stdout.write(s),
  err: (s: string) => void = (s) => process.stderr.write(s),
): number {
  const nextDir = path.resolve(
    argValue(argv, "--next-dir") ?? path.join(process.cwd(), ".next"),
  );
  if (!existsSync(path.join(nextDir, "server", "app"))) {
    err(`weigh:pages: no ${nextDir}/server/app — run \`pnpm build\` first.\n`);
    return 1;
  }

  let baseline: Map<string, { kb: number; gzKb?: number }> | undefined;
  const baselineFile = argValue(argv, "--baseline");
  if (argv.includes("--baseline")) {
    try {
      const rows = JSON.parse(readFileSync(baselineFile ?? "", "utf8")) as {
        html: string;
        kb: number;
        gzKb?: number;
      }[];
      baseline = new Map(rows.map((r) => [r.html, r]));
    } catch (error) {
      err(
        `weigh:pages: cannot read --baseline ${baselineFile ?? "(no file given)"}: ${(error as Error).message}\n`,
      );
      return 1;
    }
  }

  const rows: PageRow[] = [];
  const missing: string[] = [];
  try {
    for (const page of WEIGHED_PAGES) {
      const r = row(nextDir, page.html, page.name);
      if (r) rows.push(r);
      else missing.push(`${page.html} (${page.name})`);
    }
  } catch (error) {
    // A referenced chunk that is not on disk (page-weight throws).
    err(`weigh:pages: ${(error as Error).message}\n`);
    return 1;
  }
  if (missing.length > 0) {
    err(
      `weigh:pages: ${missing.length} listed page(s) are not in the build, and a table without them is not a smaller answer, it is a different question: ${missing.join(", ")}\n`,
    );
    return 1;
  }

  if (argv.includes("--json")) {
    out(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  out(
    "raw = uncompressed bytes on disk (~3x transfer); gz = gzip -9 per unique chunk, summed (close to transfer).\nCompare only against this script on another artifact.\n",
  );
  for (const r of rows) {
    let delta = "";
    if (baseline) {
      const before = baseline.get(r.html);
      delta =
        before === undefined
          ? "  [new: not in baseline]"
          : `  [${signed(r.kb - before.kb, 0)} KB raw${
              before.gzKb === undefined
                ? ""
                : `, ${signed(oneDecimal(r.gzKb - before.gzKb), 1)} KB gz`
            }]`;
    }
    out(
      `  ${r.name.padEnd(width)}  ${String(r.kb).padStart(5)} KB raw  ${r.gzKb.toFixed(1).padStart(6)} KB gz${delta}  (${r.chunks} chunks; largest: ${r.largest
        .map((c) => `${c.kb}`)
        .join("+")} KB raw)\n`,
    );
  }
  return 0;
}

// Only run when invoked directly (`tsx scripts/weigh-pages.ts`), never when a
// test imports WEIGHED_PAGES — the same main-module check scripts/qa.ts uses.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(main());
}
