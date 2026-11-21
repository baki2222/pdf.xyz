import { join } from "node:path";

/**
 * Where a chain test writes the scratch copy its mutation control runs:
 * a git-ignored directory at the repository root, outside `src/`, `e2e/`,
 * `scripts/` and `public/` — the roots tree-walking tests read — so no walk
 * can list the copy and then find it deleted (see chain-scratch.test.ts).
 * Inside the repository so a bare import ("vitest", "@playwright/test")
 * still resolves through the root node_modules, and two levels deep, as
 * `e2e/<dir>` was, so `../../src/...` imports keep resolving. The pid keeps
 * two parallel workers apart.
 */
export function chainScratchDir(name: string): string {
  return join(
    __dirname,
    "..",
    "..",
    ".chain-mutants",
    `${name}-${process.pid}`,
  );
}
