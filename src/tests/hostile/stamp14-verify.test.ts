import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * STAMP-14 adversarial verification: unclosed `q` depth makes pdf.js's
 * getTextContent superlinear (measured on pdfjs-dist 6.2.108, Windows/Node):
 *
 *   q depth   readAsViewer (getTextContent)
 *   1,000     0.66 s
 *   10,000    1.5 s
 *   20,000    4.3 s
 *   40,000    37 s
 *   60,000    113 s
 *   100,000   493 s to finish (8.2 min); killed at 60/90/120 s bounds (also the product's own
 *             extractPdfText, and conversion-out.cell.ts `text` on that
 *             matrix's H24-unbalanced-q-100k fixture, killed at 120 s)
 *
 * Cause, read in node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs:
 * `StateManager.save()` pushes `this.state` and replaces it with
 * `old.clone()`, and `EvalState.clone()` / `TextState.clone()` are
 * `Object.create(this)` — so every `q` adds one link to the state's PROTOTYPE
 * chain. 100,000 unclosed `q` is a 100,000-deep prototype chain that every
 * inherited property read walks. Nothing in the product (src/lib/pdf/text.ts,
 * render.ts) bounds the time.
 *
 * Each measurement runs in a child (pdf.js's in-process worker is synchronous,
 * so no in-process timer can interrupt it) under a kill bound. The 100k cell
 * is not run here (it would cost minutes); the ratio below shows the curve.
 */
const CHILD = path.join(__dirname, "stamp14-verify.child.ts");

function run(n: number, boundMs: number): { ms: number | null; raw: string } {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", CHILD, "text", String(n), "1"],
    { cwd: __dirname, timeout: boundMs, encoding: "utf8" },
  );
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (!line) return { ms: null, raw: `${r.signal ?? r.status} ${r.stderr}` };
  const parsed = JSON.parse(line) as { ms?: number; runs?: string[] };
  expect(parsed.runs).toContain("Hostile control"); // positive control: text read
  return { ms: parsed.ms ?? null, raw: line };
}

describe("STAMP-14 verify (known-slow: ~50 s)", () => {
  it("getTextContent time grows superlinearly with unclosed q depth", () => {
    const t0 = run(0, 30_000);
    const t20 = run(20_000, 60_000);
    const t40 = run(40_000, 120_000);
    console.log(
      `[STAMP-14] n=0 ${t0.ms}ms n=20k ${t20.ms}ms n=40k ${t40.ms}ms`,
    );
    // Health check: every child produced a measurement.
    expect(t0.ms, t0.raw).not.toBeNull();
    expect(t20.ms, t20.raw).not.toBeNull();
    expect(t40.ms, t40.raw).not.toBeNull();
    // Linear would be ~2x; the finding is that doubling depth costs far more.
    expect(t40.ms! / t20.ms!).toBeGreaterThan(4);
  }, 240_000);
});
