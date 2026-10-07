/**
 * Weigh what a prerendered page makes a browser download — the ONE script run
 * over BOTH artifacts when comparing builds, so a before/after can never be an
 * artifact of two different methods (the "502 → 448 KB" mistake this repo has
 * already published once came from curling a running server across rebuilds).
 *
 * Same weigher as `src/deploy/bundle-budget.test.ts` (both import
 * ./page-weight, and that test runs this script against it): the chunk list is read from the HTML `next build` prerendered — exactly what a
 * browser would fetch — and sizes are UNCOMPRESSED bytes on disk (~3× transfer;
 * fine for comparing builds, wrong as a user-facing figure).
 *
 *   pnpm weigh:pages                       # table for the standard pages
 *   pnpm weigh:pages --json                # machine-readable, for diffing runs
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { weighPage } from "./page-weight";

const NEXT_DIR = path.join(process.cwd(), ".next");
const APP_DIR = path.join(NEXT_DIR, "server", "app");

const PAGES = [
  { name: "homepage", html: "index.html" },
  { name: "rotate-pdf (client-side)", html: "tools/rotate-pdf.html" },
  { name: "merge-pdf (client-side)", html: "tools/merge-pdf.html" },
  { name: "ocr-pdf (worker)", html: "tools/ocr-pdf.html" },
  { name: "summarize-pdf (AI)", html: "tools/summarize-pdf.html" },
  { name: "pdf-to-jpg (pdfjs)", html: "tools/pdf-to-jpg.html" },
  { name: "pdf-to-text (pdfjs)", html: "tools/pdf-to-text.html" },
  { name: "workspace", html: "workspace.html" },
] as const;

interface PageRow {
  name: string;
  html: string;
  chunks: number;
  kb: number;
  largest: { file: string; kb: number }[];
}

function weigh(htmlRelPath: string, name: string): PageRow | null {
  // The shared weigher (./page-weight): the same function the budget test
  // calls, so this table and the budget cannot describe different sets.
  const w = weighPage(NEXT_DIR, htmlRelPath);
  if (!w) return null;
  return {
    name,
    html: htmlRelPath,
    chunks: w.chunks,
    kb: w.kb,
    largest: w.sized.slice(0, 5).map((c) => ({
      file: path.basename(decodeURIComponent(c.url)),
      kb: Math.round(c.bytes / 1024),
    })),
  };
}

function main(): number {
  if (!existsSync(APP_DIR)) {
    process.stderr.write(
      "weigh:pages: no .next/server/app — run `pnpm build` first.\n",
    );
    return 1;
  }
  const rows = PAGES.map((p) => weigh(p.html, p.name)).filter(
    (r): r is PageRow => r !== null,
  );
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  process.stdout.write(
    "Uncompressed bytes on disk (~3x transfer). Compare only against the same script on another artifact.\n",
  );
  for (const r of rows) {
    process.stdout.write(
      `  ${r.name.padEnd(width)}  ${String(r.kb).padStart(5)} KB  (${r.chunks} chunks; largest: ${r.largest
        .map((c) => `${c.kb}`)
        .join("+")} KB)\n`,
    );
  }
  return 0;
}

process.exit(main());

export {};
