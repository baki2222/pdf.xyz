// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No surface may assert, on its own authority, that nothing was uploaded.
 *
 * This scans source instead of rendering, for the reason #47 established: the
 * behavioural tests in `upload-disclosure.test.tsx` prove the shared hook is
 * honest and prove nothing whatever about a file that does not use it. Three
 * files each hand-wrote this sentence, which is exactly how all three came to
 * state something the product could not know — and how a fourth would.
 *
 * `app/global-error.tsx` is the concrete reason this exists: it renders its own
 * `<html>`/`<body>`, so it is awkward to mount in jsdom and is covered here
 * rather than there. Coverage by scan is weaker than coverage by behaviour, and
 * saying which one a surface has is the point.
 *
 * WOULD THIS BE GREEN IF THE FIX WERE ABSENT? No — measured against `HEAD`
 * (the tree before this change), both checks report all **3** fallbacks:
 * `components/telemetry/error-boundary.tsx`, `app/error.tsx`, and
 * `app/global-error.tsx` each state the claim and none has a disclosure hook,
 * because the hook did not exist.
 *
 * The scan is scoped to the fallbacks rather than to all of `src` — deliberately,
 * after measuring. A whole-tree ban caught two more occurrences in
 * `tools/runner/handoff-notice.tsx` ("Still in this browser; nothing was
 * uploaded", and the expired-hand-off notice), and both are TRUE: they describe
 * what one workspace hand-off did at the instant it rendered, not a claim about
 * the session. Banning the phrase everywhere would have meant rewriting honest
 * copy to satisfy a guard, which is how guards start getting routed around.
 */

const SRC = path.join(process.cwd(), "src");

/**
 * The claim. Case-insensitive on purpose: this must catch the sentence in a
 * comment or a mid-sentence paraphrase, not only as rendered copy, so the only
 * way to discuss it anywhere else in the tree is to not word it as an assertion.
 */
const CLAIM = /nothing was uploaded/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = walk(SRC);

/**
 * Every crash fallback in the tree: Next's route-level and root-level error
 * conventions, plus the shared boundary that renders at all fourteen
 * `/tools/[slug]` catch sites. Discovered rather than listed, so a route-level
 * `error.tsx` added later is held to the same standard without anyone
 * remembering to add it here.
 */
const FALLBACKS = SOURCES.filter((file) => {
  const rel = path.relative(SRC, file);
  return (
    /^app[\\/](.*[\\/])?(global-)?error\.tsx$/.test(rel) ||
    rel === path.join("components", "telemetry", "error-boundary.tsx")
  );
});

describe("the upload claim has exactly one owner", () => {
  it("finds the fallbacks it means to guard", () => {
    const rel = FALLBACKS.map((f) => path.relative(SRC, f)).sort();
    expect(rel).toEqual(
      [
        path.join("app", "error.tsx"),
        path.join("app", "global-error.tsx"),
        path.join("components", "telemetry", "error-boundary.tsx"),
      ].sort(),
    );
  });

  it("is stated by no crash fallback on its own authority", () => {
    const offenders = FALLBACKS.filter((file) =>
      CLAIM.test(readFileSync(file, "utf8")),
    ).map((f) => path.relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it("is asked for, not asserted, by every crash fallback", () => {
    const missing = FALLBACKS.filter(
      (file) => !readFileSync(file, "utf8").includes("useUploadDisclosure"),
    ).map((f) => path.relative(SRC, f));

    expect(missing).toEqual([]);
  });
});
