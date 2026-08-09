/**
 * Weigh what a prerendered page makes a browser download — the ONE script run
 * over BOTH artifacts when comparing builds, so a before/after can never be an
 * artifact of two different methods (the "502 → 448 KB" mistake this repo has
 * already published once came from curling a running server across rebuilds).
 *
 * Same method as `src/deploy/bundle-budget.test.ts` (which documents it): the
 * chunk list is read from the HTML `next build` prerendered — exactly what a
 * browser would fetch — and sizes are UNCOMPRESSED bytes on disk (~3× transfer;
 * fine for comparing builds, wrong as a user-facing figure).
 *
 *   pnpm weigh:pages                       # table for the standard pages
 *   pnpm weigh:pages --json                # machine-readable, for diffing runs
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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

interface PageWeight {
  name: string;
  html: string;
  chunks: number;
  kb: number;
  largest: { file: string; kb: number }[];
}

function weigh(htmlRelPath: string, name: string): PageWeight | null {
  const html = path.join(APP_DIR, htmlRelPath);
  if (!existsSync(html)) return null;
  const urls = [
    ...new Set(
      readFileSync(html, "utf8").match(/\/_next\/static\/chunks\/[^"']+?\.js/g) ?? [],
    ),
  ];
  let bytes = 0;
  const sized: { file: string; kb: number }[] = [];
  for (const url of urls) {
    const file = path.join(NEXT_DIR, url.replace("/_next/", ""));
    if (!existsSync(file)) continue;
    const size = statSync(file).size;
    bytes += size;
    sized.push({ file: path.basename(file), kb: Math.round(size / 1024) });
  }
  sized.sort((a, b) => b.kb - a.kb);
  return {
    name,
    html: htmlRelPath,
    chunks: urls.length,
    kb: Math.round(bytes / 1024),
    largest: sized.slice(0, 5),
  };
}

function main(): number {
  if (!existsSync(APP_DIR)) {
    process.stderr.write("weigh:pages: no .next/server/app — run `pnpm build` first.\n");
    return 1;
  }
  const rows = PAGES.map((p) => weigh(p.html, p.name)).filter(
    (r): r is PageWeight => r !== null,
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
