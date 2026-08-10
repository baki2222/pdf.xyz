// @vitest-environment node
/**
 * Repo-wide invariant: every tracked path fits a Windows-safe length budget.
 *
 * Why this exists: a generator once compounded directory names until the
 * longest tracked path hit 235 characters, and the repository stopped being
 * clonable into ordinary Windows paths — `git worktree add` failed outright
 * with "Filename too long" at a 25-character prefix, and the TASK-14 audit's
 * own corpus reader went blind past MAX_PATH and reported its blindness as
 * findings. The family is deleted; this guard keeps the ceiling from
 * climbing back.
 *
 * THE BUDGET, derived rather than chosen: Windows MAX_PATH is 260 (drive,
 * colon, separators, and the terminating NUL included). A tracked path of
 * length M checks out under a prefix of length P when P + 1 + M < 260. The
 * ceiling of 140 guarantees every checkout prefix up to 119 characters —
 * enough for `C:\Users\<name>\Documents\GitHub\pdf.xyz\` (~45–60) and deep
 * verification worktrees — while sitting far enough above today's real
 * maximum (73, measured at the family's deletion) that ordinary growth
 * never trips it. It binds without being decorative: the deleted family's
 * shortest breaching path (181) and its longest (235) would both fail here.
 *
 * Tracked files only, from git itself: build artifacts (.next) legitimately
 * exceed this and are nobody's checkout problem.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const BUDGET = 140;

function trackedPaths(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

describe("tracked paths fit a Windows-safe budget", () => {
  it("reads the real index, so an empty listing cannot vacuous-pass", () => {
    expect(trackedPaths().length).toBeGreaterThan(1000);
  });

  it(`no tracked path exceeds ${BUDGET} characters`, () => {
    const over = trackedPaths()
      .filter((p) => p.length > BUDGET)
      .sort((a, b) => b.length - a.length);
    expect(
      over,
      `these tracked paths exceed the ${BUDGET}-char budget (MAX_PATH 260 minus a 119-char checkout prefix) and will break ordinary Windows checkouts:\n  ${over
        .map((p) => `${p.length}: ${p}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });
});
