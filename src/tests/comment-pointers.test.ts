// @vitest-environment node
/**
 * A comment that sends the reader to a module must send them somewhere real.
 *
 * THE DEFECT. `src/lib/pdf/layout.ts` opened with "Positioned selectable-text
 * extraction for table detection ... so the table engine can recover rows and
 * columns". Nothing imported it. The table engine's own deps file said, in
 * writing, "These deliberately do NOT use" it (quoted there by its alias). A maintainer
 * fixing table extraction would have edited the wrong file. The file is
 * deleted, and three comments that named it were reworded. This guard makes
 * the next dangling pointer fail instead of misleading.
 *
 * THE CORPUS is every backticked `@/<root>/...` path in any src file, where
 * <root> is a real top-level directory of src. The roots are read from disk,
 * so a placeholder like `@/x` in prose about the alias is not a pointer. Each
 * must resolve the way the alias does: the path itself, or with .ts/.tsx, or
 * an index file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");
const ROOTS = readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
const POINTER = new RegExp(
  String.raw`\x60@/((?:` + ROOTS.join("|") + String.raw`)/[\w/.\[\]-]+)\x60`,
  "g",
);

function files(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

function resolves(pointer: string): boolean {
  const base = path.join(SRC, pointer);
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ].some((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function pointersIn(source: string): string[] {
  return [...source.matchAll(POINTER)].map((m) => m[1]!);
}

describe("backticked module pointers resolve", () => {
  const found = files().flatMap((file) =>
    pointersIn(readFileSync(file, "utf8")).map((pointer) => ({
      file: path.relative(SRC, file),
      pointer,
    })),
  );

  it("health: the roots and the pointer corpus are plausible", () => {
    expect(ROOTS).toEqual(expect.arrayContaining(["app", "components", "lib"]));
    console.info(`module pointers checked: ${found.length}`);
    expect(found.length).toBeGreaterThan(50);
  });

  it("positive control: a pointer to a missing module is caught, a placeholder is not a pointer", () => {
    // Split so this file's own source does not contain the pointer it tests.
    const [missing] = pointersIn("see `@/lib/pdf/" + "no-such-module` for why");
    expect(missing).toBe("lib/pdf/no-such-module");
    expect(resolves(missing!)).toBe(false);
    expect(resolves("lib/pdf/engine")).toBe(true);
    expect(pointersIn("`@/x` is the alias for `src/x`")).toEqual([]);
  });

  it("every one resolves", () => {
    expect(
      found
        .filter(({ pointer }) => !resolves(pointer))
        .map(({ file, pointer }) => `${file}: @/${pointer}`),
    ).toEqual([]);
  });
});
