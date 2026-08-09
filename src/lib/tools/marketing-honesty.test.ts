// @vitest-environment node
/**
 * Drift guard between what the MARKETING copy promises and what an engine says
 * about itself in the same repository.
 *
 * The homepage said a user could "translate a brochure while keeping its
 * layout". One click away, the tool panel said "It produces translated text (not
 * a layout-preserving PDF)", and `translate/engine.ts` opens with a scope note
 * saying the same. Every honest surface was honest; the page that sells the
 * product was not, and it is the one a visitor reads first.
 *
 * This is the same shape as the malware claim removed in #33: a promise written
 * next to a picture rather than next to the code, with nothing tying the two
 * together. `output-honesty.test.ts` ties `Tool.outputs` to what the engine
 * WRITES; this ties the prose to what the engine SAYS IT CANNOT DO.
 *
 * Deliberately narrow. It does not attempt to judge marketing language in
 * general — it enforces one rule: where an engine explicitly disclaims a
 * capability, no user-facing copy may promise it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyFiles, withoutComments } from "./copy-surface";

const ROOT = process.cwd();

/**
 * One disclaimed capability: where the engine denies it, how the denial reads,
 * and the phrases that would amount to promising it anyway.
 */
const DISCLAIMED = [
  {
    capability: "layout-preserving translation",
    engine: "src/lib/workers/translate/engine.ts",
    /** Proof the engine really does disclaim it — if this moves, the rule is stale. */
    denial: "not a\n * layout-preserving re-typeset PDF",
    /** A promise only counts when it is about translation, hence the pairing. */
    subject: /translat/i,
    promises: [
      /keeping its layout/i,
      /keeps? the layout/i,
      /preserv\w* (?:the )?(?:original )?layout/i,
      /same layout/i,
      /layout[- ]preserving/i,
    ],
  },
] as const;

describe("marketing copy does not promise what an engine disclaims", () => {
  it("reads the copy files, so a move cannot quietly empty this suite", () => {
    expect(copyFiles().length).toBeGreaterThanOrEqual(10);
  });

  it.each(DISCLAIMED)(
    "$engine still disclaims $capability",
    ({ engine, denial }) => {
      // If the engine gains the capability, this fails FIRST — and then the rule
      // below should be deleted, not the copy re-hedged.
      expect(readFileSync(path.join(ROOT, engine), "utf8")).toContain(denial);
    },
  );

  it.each(DISCLAIMED)(
    "no page promises $capability",
    ({ capability, subject, promises }) => {
      const offenders: string[] = [];
      for (const file of copyFiles()) {
        const source = withoutComments(readFileSync(file, "utf8"));
        if (!subject.test(source)) continue;
        for (const promise of promises) {
          const match = promise.exec(source);
          if (!match) continue;
          // Only flag a promise made near the subject: a `translate-x-0.5`
          // Tailwind class in a file about something else is not a claim.
          const near = source
            .slice(Math.max(0, match.index - 400), match.index + 400)
            .match(subject);
          if (near) {
            offenders.push(`${path.relative(ROOT, file)}: "${match[0]}"`);
          }
        }
      }
      expect(
        offenders,
        `these promise ${capability}, which the engine explicitly says it does not do:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    },
  );
});
