// @vitest-environment node
/**
 * The coupling guard for the interest counter's ruling: **page, button copy,
 * and counter land together or not at all.**
 *
 * The counter was approved on the condition that it is an act the user
 * knowingly performs, not a measurement taken of them — which holds only
 * while two disclosures exist: the `/privacy` §4 bullet (authored by the
 * owner, verbatim) and the plain-sight line under the Notify-me button. This
 * test makes the pairing structural: while the capability exists
 * (`src/app/api/interest/route.ts`), deleting or rewording either disclosure
 * fails the build. If the counter is ever removed, delete this test with it —
 * and the disclosures too, so the page never describes a mechanism that no
 * longer exists.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, "src", "app", "api", "interest", "route.ts");

describe("the interest counter never exists without its disclosures", () => {
  it("the capability this guard is scoped to exists (else delete the guard too)", () => {
    expect(existsSync(ROUTE)).toBe(true);
  });

  it("/privacy carries the owner's disclosure bullet, verbatim anchors intact", () => {
    const privacy = readFileSync(
      path.join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    );
    // The heading — "you can choose" is the load-bearing phrase: the defence is
    // that it is an act, not a measurement.
    expect(privacy).toContain("One thing you can choose to send us.");
    // The answer to the reader's real question ("does the page do this on its
    // own?") must be in the bullet, not inferred.
    expect(privacy).toContain("Pressing nothing sends nothing.");
    // The scope of what is sent, in the page's own words.
    expect(privacy).toContain("the tool&apos;s name, and nothing else");
  });

  it("the button says what pressing it sends, in plain sight", () => {
    const button = readFileSync(
      path.join(ROOT, "src", "components", "tools", "notify-me.tsx"),
      "utf8",
    );
    expect(button).toContain(
      "Pressing it sends us the tool&apos;s name — nothing about you.",
    );
    // And the beacon carries the slug alone — the one-dimension rule.
    expect(button).toContain("JSON.stringify({ slug: tool.slug })");
  });

  it("the passive-analytics claim the disclosure sits beside is still present", () => {
    // The ruling kept the original bullet BECAUSE it stays true for passive
    // analytics. If someone deletes it, the new bullet loses its context and
    // this pairing needs re-deciding — loudly, not by drift.
    const privacy = readFileSync(
      path.join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    );
    expect(privacy).toContain("No product analytics leave your device.");
  });
});
