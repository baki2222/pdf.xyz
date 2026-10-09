// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every tool that can finish must be able to say so.
 *
 * The behavioural tests next door prove the primitives work. They cannot prove
 * that a tool added six months from now will use them, and that is the failure
 * this codebase keeps repeating: `OCR_LANGUAGES` and the Dockerfile drifted, the
 * catalogue and the registry drifted, the pipeline copy and the scanner drifted.
 * A convention that lives only in reviewers' heads is not a convention.
 *
 * So this reads the directory at test time rather than listing files. Add a tool
 * and it is enrolled automatically; the only way out is a written exemption in a
 * reviewed diff.
 *
 * It is a FLOOR, not a ceiling. A completion surface that renders a plain
 * paragraph in a file that already uses `ResultPanel` elsewhere satisfies both
 * checks below while announcing nothing — `compress-runner`'s "couldn't shrink
 * this further" branch was exactly that, and no amount of file-level scanning
 * would have found it. Passing here means the obvious hole is closed, not that
 * the tool is accessible.
 */

const TOOLS_DIR = path.join(process.cwd(), "src", "components", "tools");

/**
 * The card markup that had been hand-copied into thirteen files.
 *
 * The leading `border ` keyword is load-bearing: it matches the CARD, and not
 * the bare colour pair that `compress-runner`'s headline lookup uses as a `tone`
 * token. Without it this flags a class string that renders no card at all, and a
 * guard that cries wolf gets weakened by the next person to hit it.
 */
// Written with "·" for each colour's first hyphen and restored here: Tailwind
// scans this file, and spelled whole the retired card's two colours shipped
// in the stylesheet long after the card left (shipped-css.test.ts).
const CARD_FINGERPRINT =
  "border border·emerald-400/25 bg·emerald-500/[0.07]".replaceAll("·", "-");

/** The one legal home for that markup. */
const CARD_OWNER = path.join("runner", "runner-kit.tsx");

/** Uses one of the shared outcome primitives, in any form. */
const USES_PRIMITIVE = /\b(ResultPanel|ResultCard|useOutcomeFocus)\b/;

/**
 * Exemptions, each with its reason. This list is the door left deliberately
 * open — it forces a sentence into a diff someone has to read, rather than
 * silence. The two kinds are kept apart because they are checked differently.
 *
 * Announces by another mechanism: still has an outcome, still must be audible,
 * just not via the shared primitive.
 */
const ANNOUNCES_DIFFERENTLY: Record<string, string> = {
  "chat-with-pdf-worker-panel.tsx":
    'answers stream into a role="log" transcript; moving focus would interrupt a user typing a follow-up',
};

/**
 * No outcome of its own: plumbing that matches the filename pattern without ever
 * finishing anything. These get no announcement check, because there is nothing
 * to announce — which is also why each one needs a reason recorded here rather
 * than being pattern-matched away.
 */
const NO_OUTCOME_OF_ITS_OWN: Record<string, string> = {
  "tool-runner.tsx":
    "a dispatcher: maps a RunnerKind to the runner that owns the outcome",
  "single-pdf-runner.tsx":
    "the shared load-one-PDF lifecycle (dropzone, reading, errors); the editor it renders owns the outcome",
};

const EXEMPT = { ...ANNOUNCES_DIFFERENTLY, ...NO_OUTCOME_OF_ITS_OWN };

function toolSourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [full]
        : [];
    });
  return walk(TOOLS_DIR);
}

/** Components that run a tool and therefore have an outcome to report. */
function completionSurfaceFiles(): { name: string; file: string }[] {
  return toolSourceFiles()
    .filter((file) => /-(runner|worker-panel)\.tsx$/.test(path.basename(file)))
    .map((file) => ({ name: path.basename(file), file }));
}

describe("completion surfaces", () => {
  it("finds the tool components, so a rename cannot quietly empty this suite", () => {
    // A guard that silently checks nothing reads exactly like a passing one.
    expect(completionSurfaceFiles().length).toBeGreaterThanOrEqual(25);
  });

  it("keeps the success card in one place", () => {
    const offenders = toolSourceFiles()
      .filter((file) => !file.endsWith(CARD_OWNER))
      .filter((file) => readFileSync(file, "utf8").includes(CARD_FINGERPRINT))
      .map((file) => path.relative(TOOLS_DIR, file));

    expect(
      offenders,
      `these files hand-copy the success card instead of using <ResultCard>, so their outcome is invisible to assistive tech:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it.each(completionSurfaceFiles())(
    "$name reports its outcome through a shared primitive",
    ({ name, file }) => {
      if (name in EXEMPT) return;
      const source = readFileSync(file, "utf8");
      expect(
        USES_PRIMITIVE.test(source),
        `${name} runs a tool but never uses ResultPanel, ResultCard, or useOutcomeFocus — a finished run there is silent. Use one, or add an entry to EXEMPT with the reason.`,
      ).toBe(true);
    },
  );

  it("has no stale exemptions", () => {
    // An exemption for a file that no longer exists is a claim nobody is
    // checking any more.
    const ghosts = Object.keys(EXEMPT).filter(
      (name) => !completionSurfaceFiles().some((entry) => entry.name === name),
    );
    expect(ghosts).toEqual([]);
  });

  it("keeps the exempt files honest about how they announce", () => {
    // Exempt from the primitive, not from being accessible at all.
    for (const name of Object.keys(ANNOUNCES_DIFFERENTLY)) {
      const entry = completionSurfaceFiles().find((f) => f.name === name)!;
      const source = readFileSync(entry.file, "utf8");
      expect(
        /role="(log|status|alert)"|aria-live/.test(source),
        `${name} is exempt from the shared primitive but announces nothing at all`,
      ).toBe(true);
    }
  });
});

describe("a run that starts always stops", () => {
  /**
   * `fetch` REJECTS rather than returning a non-2xx for offline, DNS failure, a
   * reset connection, and CORS — and `file.arrayBuffer()` can reject too. Every
   * panel used to run `setBusy(true) … await … setBusy(false)` with no `try` and
   * no `finally`, so a rejection escaped the callback, `setBusy(false)` never
   * ran, and the button spun forever showing no error at all. A reload was the
   * only way out, and nothing in the product said so.
   *
   * The client layer is now careful, but care is not a guarantee: `finally` is,
   * and it covers causes that layer cannot see — including ones not written yet.
   */
  /**
   * Since 2026-09-27 the worker panels hold their run in the shared
   * `useWorkerJob` hook (Keep waiting, Cancel, progress), so their busy state
   * is set THERE, not in the panel. A panel that uses the hook stops where the
   * hook does, and is checked against the hook's source — the corpus did not
   * shrink to the one runner left calling `setBusy(true)` itself.
   */
  const JOB_HOOK = path.join(TOOLS_DIR, "worker-job.tsx");
  const USES_JOB_HOOK = /\buseWorkerJob\s*</;
  const busyPanels = completionSurfaceFiles().filter(({ file }) => {
    const source = readFileSync(file, "utf8");
    return source.includes("setBusy(true)") || USES_JOB_HOOK.test(source);
  });

  it("finds the panels that show a busy state", () => {
    expect(busyPanels.length).toBeGreaterThanOrEqual(12);
  });

  it.each(busyPanels)(
    "$name clears its busy state in a finally",
    ({ file, name }) => {
      const own = readFileSync(file, "utf8");
      const source =
        USES_JOB_HOOK.test(own) && !own.includes("setBusy(true)")
          ? readFileSync(JOB_HOOK, "utf8")
          : own;
      expect(
        /\}\s*finally\s*\{[^}]*setBusy\(false\)/s.test(source),
        `${name} sets a busy state but does not clear it in a finally — a rejected fetch there leaves the button spinning with no error, and only a page reload recovers it`,
      ).toBe(true);
    },
  );
});

describe("the app's live region", () => {
  it("is mounted in the root layout, above every route", () => {
    // The region that existed before this was rendered inside a runner's editor
    // branch, and the early return that showed the result unmounted it — silent
    // at the only moment it mattered. Mounting it at the root is what makes that
    // structurally impossible, so the location is the guarantee.
    const layout = path.join(process.cwd(), "src", "app", "layout.tsx");
    expect(existsSync(layout)).toBe(true);
    expect(readFileSync(layout, "utf8")).toContain("<LiveRegion />");
  });
});
