// @vitest-environment node
/**
 * Client file names carry EIGHT hex digits of content hash, not Next's 16
 * (`clientWebpack` in next.config.mjs, 2026-11-08).
 *
 * Every page's webpack runtime holds one hash per async chunk, and every
 * page's HTML holds one per script tag. Hex digits barely compress, so the
 * second eight digits of each hash were transfer on every visit: measured on
 * one machine from an empty .next, main d445c2c3 against this change. The
 * figures are in the PR that made it.
 *
 * Read from the BUILD, the artifact a browser receives, not from the config:
 * a Next upgrade that renamed the option or moved the hash into another
 * template would leave the config line in place and the names at 16.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CHUNKS = path.join(process.cwd(), ".next/static/chunks");

/** The hash in a chunk file name: `671.9cf360d7.js`, `main-app-84a98ca2.js`. */
function nameHash(file: string): string | null {
  return /[.-]([0-9a-f]{6,})\.js$/.exec(file)?.[1] ?? null;
}

describe("client chunk hashes", () => {
  const built = existsSync(CHUNKS);

  it("has a build to measure", () => {
    expect(
      built,
      "no .next/static/chunks — run `pnpm build` before this suite (CI does)",
    ).toBe(true);
  });

  it("CONTROL: the name reader finds both lengths, so a 16 cannot hide", () => {
    expect(nameHash("671.9cf360d7ee310fb5.js")).toHaveLength(16);
    expect(nameHash("main-app-84a98ca2.js")).toHaveLength(8);
    expect(nameHash("polyfills.js")).toBeNull();
  });

  it("every client chunk name and every runtime map entry has 8 hex digits", () => {
    if (!built) return;
    const all = readdirSync(CHUNKS).filter((f) => f.endsWith(".js"));
    // Next COPIES its legacy polyfills file under a hash of its own (it is
    // not webpack output, so hashDigestLength never reaches it), and only a
    // browser without ES modules loads it (`nomodule`). The one exemption,
    // held to exactly one file so it cannot grow into a pattern.
    const polyfills = all.filter((f) => /^polyfills-[0-9a-f]+\.js$/.test(f));
    expect(polyfills).toHaveLength(1);
    const files = all.filter((f) => !polyfills.includes(f));
    const hashes = files.map(nameHash).filter((h): h is string => h !== null);
    // Health: a reader that matched nothing would pass any length rule.
    expect(hashes.length).toBeGreaterThan(50);
    expect(new Set(hashes.map((h) => h.length))).toEqual(new Set([8]));

    const runtime = files.find((f) => /^webpack-[0-9a-f]+\.js$/.test(f));
    expect(runtime, "the webpack runtime chunk").toBeTruthy();
    const source = readFileSync(path.join(CHUNKS, runtime!), "utf8");
    const entries = [...source.matchAll(/\b\d+:"([0-9a-f]{6,})"/g)].map(
      (m) => m[1]!,
    );
    expect(entries.length).toBeGreaterThan(50);
    expect(new Set(entries.map((e) => e.length))).toEqual(new Set([8]));
  });
});
