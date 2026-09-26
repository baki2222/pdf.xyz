// @vitest-environment node
/**
 * No typeface is downloaded at build time.
 *
 * `next/font/google` looks self-hosted from the page's side — the files end
 * up under `/_next/static` and no runtime request leaves the site — which is
 * why its cost was invisible: every `next build` fetches the face from
 * fonts.googleapis.com. On 2026-09-27 the production publish for PR #162
 * failed in `nextFontGoogleFontLoader` (`Cannot read properties of null
 * (reading '1')`) because Google answered the build runner with something
 * other than the CSS Next parses. A merged, CI-green commit did not ship.
 *
 * The same commit had built fine in PR CI twenty minutes earlier, so no
 * code-level test could have seen it coming; the only fix is to leave nothing
 * for the network to break. This walks ALL of `src/` rather than naming
 * `layout.tsx`, because the next import of a Google face could be anywhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withoutComments } from "@/lib/tools/copy-surface";

const SRC = path.join(process.cwd(), "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    // What `next build` compiles — test files never ship. (The first version
    // walked them too and flagged THIS file, whose positive control below is a
    // string literal that looks exactly like the import it bans.)
    else if (
      /\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name) &&
      !/\.test\./.test(entry.name)
    )
      out.push(full);
  }
  return out;
}

/** An import (or require, or dynamic import) of `next/font/google`, in code. */
function importsGoogleFonts(source: string): boolean {
  return /(?:from|import\s*\(|require\s*\()\s*["']next\/font\/google["']/.test(
    withoutComments(source),
  );
}

describe("typefaces", () => {
  const files = sources(SRC);

  it("walked the source tree (health check)", () => {
    // An empty walk makes the assertion below vacuously true.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join("app", "layout.tsx")))).toBe(
      true,
    );
  });

  it("are never fetched from Google at build time", () => {
    const offenders = files
      .filter((f) => importsGoogleFonts(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    expect(
      offenders,
      "these import next/font/google, which downloads the face during `next build` — " +
        "self-host it from a pinned package with next/font/local instead",
    ).toEqual([]);
  });

  it("the detector sees an import and ignores prose (positive control)", () => {
    expect(
      importsGoogleFonts('import { Inter } from "next/font/google";'),
    ).toBe(true);
    expect(importsGoogleFonts("const f = require('next/font/google');")).toBe(
      true,
    );
    // The layout's own docblock names the module it replaced.
    expect(
      importsGoogleFonts(
        "/** WAS `next/font/google`, which ... */ const x = 1;",
      ),
    ).toBe(false);
  });

  it("the display face is a pinned package, not a loose file", () => {
    const layout = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(withoutComments(layout)).toContain(
      "@fontsource-variable/bricolage-grotesque",
    );
    expect(
      pkg.dependencies["@fontsource-variable/bricolage-grotesque"],
    ).toBeTruthy();
  });
});
