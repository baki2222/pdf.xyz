/**
 * Every file this directory's comments point a reader at must exist.
 *
 * WHY. The docblocks here carry the arguments for why the renderer is safe
 * ("this network decides every request", "that test proves the scan"), and a
 * reader follows those names to check the claim. Two went stale in one
 * change: `unbundled-assets.ts` credited its proof to the wrong test file,
 * and `document-url.ts` named a module under `lib/html/` that never existed.
 * Neither could fail anything.
 *
 * This catches the second kind only: a name that resolves to nothing. A name
 * that resolves to the WRONG file (the first kind) passes here; only a reader
 * can see that.
 *
 * The files are DISCOVERED (every source in this directory), and so are the
 * pointers (every backticked module path in them).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const ROOT = path.resolve(DIR, "..", "..", "..", "..");

/** `./network`, `@/lib/x`, `src/x.ts`, `scripts/x.ts`, or a bare `x.ts`. */
const POINTER =
  /`(\.\/[\w./-]+|@\/[\w./-]+|(?:src|scripts)\/[\w./-]+|[\w.-]+\.tsx?)`/g;

function resolves(pointer: string): boolean {
  const base = pointer.startsWith("@/")
    ? path.join(ROOT, "src", pointer.slice(2))
    : /^(src|scripts)\//.test(pointer)
      ? path.join(ROOT, pointer)
      : path.join(DIR, pointer);
  return ["", ".ts", ".tsx", "/index.ts"].some((ext) => existsSync(base + ext));
}

// Not this file: its own examples of broken pointers are the point of it.
const files = readdirSync(DIR).filter(
  (f) => /\.tsx?$/.test(f) && f !== path.basename(__filename),
);
const pointers = files.flatMap((file) =>
  [...readFileSync(path.join(DIR, file), "utf8").matchAll(POINTER)].map(
    (m) => ({ file, pointer: m[1]! }),
  ),
);

describe("comment pointers in html-render", () => {
  it("finds the directory's files and their pointers (health)", () => {
    expect(files).toContain("native.ts");
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(pointers.length).toBeGreaterThanOrEqual(10);
  });

  it("the resolver can fail (positive control)", () => {
    expect(resolves("@/lib/html/unbundled-assets")).toBe(false);
    expect(resolves("no-such-file.test.ts")).toBe(false);
    expect(resolves("@/lib/net/public-address")).toBe(true);
    expect(resolves("./network")).toBe(true);
  });

  it("every file a comment names exists", () => {
    expect(
      pointers
        .filter((p) => !resolves(p.pointer))
        .map((p) => `${p.file}: ${p.pointer}`),
    ).toEqual([]);
  });
});
