// @vitest-environment node
/**
 * The installed runtime dependencies stay above their published advisory
 * floors, and the one endpoint we switched off stays off.
 *
 * 2026-09 audit: the lockfile resolved next@16.2.9 (two critical RCEs, incl. the
 * image optimizer, GHSA-2xp9-vwfh-vxw4) and pdfjs-dist@6.1.200 (arbitrary
 * JavaScript on opening a malicious PDF, GHSA-hq66-cqwq-w95j) — the product's
 * core action is opening a stranger's PDF in our origin. `pnpm audit --prod`
 * reported 23 advisories; after the bump it reports none.
 *
 * 2026-11-05 audit: production ran next@16.3.6 under two new critical RCEs
 * that only 16.4.1 fixes (the image optimizer with SVG, GHSA-2464-fhr4-w9xw;
 * `use cache` returning typed arrays, GHSA-673q-mjm6-r5xr). Neither path was
 * reachable here (the optimizer is off and 404s, below; nothing uses
 * `use cache`), but 16.3.6 also carried self-hosted SSG/ISR cache poisoning,
 * which a Coolify deploy is. The same audit named sharp <0.35.5 (librsvg) and
 * source-map-js <1.2.2 (through postcss). `pnpm audit --prod` is the corpus:
 * each floor below is the first patched version it named.
 *
 * Reads what is INSTALLED (each package's own package.json, resolved the way
 * the app resolves it), not what package.json asks for: a caret range is a
 * wish, the lockfile is a fact, and node_modules is what runs.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const requireFromRoot = createRequire(path.join(ROOT, "package.json"));

/**
 * The version of `pkg` as resolved from `from`. Walks up from the resolved entry
 * point to the package's own manifest, because some packages (sharp) do not
 * export `./package.json`.
 */
function installedVersion(pkg: string, from = ROOT): string {
  const req = createRequire(path.join(from, "package.json"));
  let dir = path.dirname(req.resolve(pkg));
  for (;;) {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string; version: string };
      if (manifest.name === pkg) return manifest.version;
    } catch {
      /* no manifest at this level */
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no manifest found for ${pkg}`);
    dir = parent;
  }
}

function atLeast(version: string, floor: string): boolean {
  const a = version.split(/[.-]/).slice(0, 3).map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** Floor = the first patched version the advisory names. */
const FLOORS: {
  pkg: string;
  floor: string;
  advisory: string;
  from?: string;
}[] = [
  // 16.3.3 until 2026-11-05 (GHSA-2xp9-vwfh-vxw4).
  {
    pkg: "next",
    floor: "16.4.1",
    advisory: "GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr (critical)",
  },
  { pkg: "pdfjs-dist", floor: "6.2.108", advisory: "GHSA-hq66-cqwq-w95j" },
  {
    pkg: "sharp",
    // 0.35.4 (libheif/libvips) until 2026-11-05.
    floor: "0.35.5",
    advisory: "GHSA-wq5f-xc86-pv6w, librsvg (high)",
    // sharp arrives through Next; resolve it the way Next does.
    from: path.dirname(requireFromRoot.resolve("next/package.json")),
  },
  {
    pkg: "source-map-js",
    floor: "1.2.2",
    advisory: "GHSA-68fv-2mgg-jv7q (high)",
    // Through Next's postcss; resolve it from there.
    from: path.dirname(
      createRequire(requireFromRoot.resolve("next/package.json")).resolve(
        "postcss/package.json",
      ),
    ),
  },
];

describe("runtime dependencies stay above their advisory floors", () => {
  it("the comparator refuses the versions the audit found (positive control)", () => {
    expect(atLeast("16.2.9", "16.3.3")).toBe(false);
    expect(atLeast("6.1.200", "6.2.108")).toBe(false);
    expect(atLeast("0.34.5", "0.35.4")).toBe(false);
    expect(atLeast("16.3.6", "16.3.3")).toBe(true);
    expect(atLeast("6.10.0", "6.2.108")).toBe(true);
    // The 2026-11-05 audit's versions, which the new floors must refuse.
    expect(atLeast("16.3.6", "16.4.1")).toBe(false);
    expect(atLeast("16.4.0", "16.4.1")).toBe(false);
    expect(atLeast("1.2.1", "1.2.2")).toBe(false);
    expect(atLeast("16.4.5", "16.4.1")).toBe(true);
  });

  it.each(FLOORS)(
    "$pkg is at or above $floor ($advisory)",
    ({ pkg, floor, from }) => {
      const version = installedVersion(pkg, from);
      expect(atLeast(version, floor), `${pkg}@${version}`).toBe(true);
    },
  );

  it("the image optimizer is off, and the installed Next 404s it when off", async () => {
    const config = (await import(path.join(ROOT, "next.config.mjs")))
      .default as {
      images?: { unoptimized?: boolean };
    };
    expect(config.images?.unoptimized).toBe(true);
    // The relationship, read from the Next that runs: the image route handler
    // renders a 404 when `unoptimized` is set, before touching a parameter.
    const server = readFileSync(
      path.join(
        path.dirname(requireFromRoot.resolve("next/package.json")),
        "dist/server/next-server.js",
      ),
      "utf8",
    );
    expect(server).toMatch(
      /imagesConfig\.unoptimized\)\s*\{\s*await this\.render404\(/,
    );
  });
});
