/**
 * Every font file fontconfig says covers zh, ja or ko — the union of
 * `fc-list :lang=zh|ja|ko`, the coverage fontconfig itself reports, which is
 * what Chromium resolves CJK text through. DERIVED, never typed.
 *
 * Shared by `measure-cjk-radical-glyphs.ts` and the image proof
 * `worker-translate-pdf-proof.ts`. It lives in `scripts/`, not `src/`, so
 * the worker's own modules gain no child-process site
 * (`src/deploy/import-boundary.test.ts`).
 */
import { execFileSync } from "node:child_process";

export function cjkFontFiles(): string[] {
  const files = new Set<string>();
  for (const lang of ["zh", "ja", "ko"]) {
    const out = execFileSync(
      "fc-list",
      ["--format", "%{file}\\n", `:lang=${lang}`],
      { encoding: "utf8" },
    );
    for (const line of out.split("\n")) if (line.trim()) files.add(line.trim());
  }
  if (files.size === 0) throw new Error("fc-list reports no CJK font");
  return [...files].sort();
}
