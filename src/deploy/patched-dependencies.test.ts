// pnpm applies `patchedDependencies` at install time, and a frozen install
// FAILS when a patch file is missing. The worker image runs its own `pnpm
// install`, and its build context is the one place a patch can silently go
// missing (.dockerignore, or a deps stage that copies only the manifests), so
// the deployment depends on this being true for every patch, not one.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** `name@version: patches/file.patch` lines under `patchedDependencies:`. */
function patchedDependencies(yaml: string): Map<string, string> {
  const out = new Map<string, string>();
  const block = yaml.match(/^patchedDependencies:\n((?:[ \t]+.*\n?)*)/m);
  for (const line of block?.[1]?.split("\n") ?? []) {
    const m = line.match(/^\s+['"]?([^'":]+@[^'":]+)['"]?:\s*['"]?([^'"\s]+)/);
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

/**
 * Whether the Dockerfile stage holding the first `pnpm install` has copied
 * `file` into the context before it runs (by a whole-context `COPY . .`, or a
 * COPY naming the file or a directory above it).
 */
function copiedBeforeInstall(dockerfile: string, file: string): boolean {
  const lines = dockerfile.split("\n");
  const install = lines.findIndex((l) => /^RUN\s.*pnpm install/.test(l));
  if (install < 0) return false;
  let stage = install;
  while (stage > 0 && !/^FROM\s/.test(lines[stage]!)) stage -= 1;
  return lines.slice(stage, install).some((line) => {
    const m = line.match(/^COPY\s+(?!--from)(?:--\S+\s+)*(.+)\s+\S+$/);
    if (!m) return false;
    return m[1]!
      .split(/\s+/)
      .some(
        (src) =>
          src === "." ||
          file === src ||
          file.startsWith(`${src.replace(/\/$/, "")}/`),
      );
  });
}

describe("patched dependencies reach every install", () => {
  const workspace = patchedDependencies(read("pnpm-workspace.yaml"));
  const dockerfile = read("Dockerfile");
  const ignored = read(".dockerignore")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  it("health: the set is derived, not empty", () => {
    expect(workspace.size).toBeGreaterThanOrEqual(1);
  });

  it("every patch file exists, and the lockfile pins the same set", () => {
    const lock = patchedDependencies(read("pnpm-lock.yaml"));
    expect([...lock.keys()].sort()).toEqual([...workspace.keys()].sort());
    for (const file of workspace.values()) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });

  it("no patch is excluded from the Docker build context", () => {
    for (const file of workspace.values()) {
      const top = file.split("/")[0]!;
      for (const rule of ignored) {
        expect([file, top, `${top}/`, `/${top}`]).not.toContain(rule);
      }
    }
  });

  it("the deps stage copies every patch before its frozen install", () => {
    for (const file of workspace.values()) {
      expect(copiedBeforeInstall(dockerfile, file), file).toBe(true);
    }
  });

  it("control: the same check fails on a deps stage that copies only the manifests", () => {
    const manifestsOnly = dockerfile.replace(/^COPY patches .*\n/m, "");
    expect(manifestsOnly).not.toBe(dockerfile);
    for (const file of workspace.values()) {
      expect(copiedBeforeInstall(manifestsOnly, file)).toBe(false);
    }
  });
});
