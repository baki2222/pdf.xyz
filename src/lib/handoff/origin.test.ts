// @vitest-environment node
/**
 * Where a hand-off came from, and what the receiving page says about it.
 *
 * THE DEFECT: every hand-off read "Loaded 2 files from your workspace." —
 * including the files a visitor dropped on the home page, which never went
 * near the workspace (addendum WP-04 #72). The record did not know where it
 * came from, so the badge could only guess, and it guessed the one origin
 * that existed when it was written.
 *
 * Held here, both ways:
 *  - `originPhrase` renders every member of `HANDOFF_ORIGINS`, each to its
 *    own sentence (exhaustive — a kind added to the union without a phrase
 *    is a compile error in origin.ts AND a missing row here);
 *  - a stored record without an origin reads as the workspace (the only
 *    origin records had before this), and a malformed one is not trusted;
 *  - the reserved targets are no catalogue tool's slug;
 *  - every rendered phrase goes through the copy predicates the source scans
 *    cannot apply to interpolated text, and every number in it is a count
 *    that was passed in.
 */
import { describe, expect, it } from "vitest";
import { getAllToolSlugs } from "@/lib/tools";
import { FORBIDDEN as TRANSMISSION_FORBIDDEN } from "@/lib/tools/transmission-claims";
import {
  ACCOUNT_CLAIMS,
  PERSONAL_CONDUCT_CLAIMS,
} from "@/tests/identity-claims";
import {
  DROP_SURFACES,
  HANDOFF_ORIGINS,
  HANDOFF_TARGET_PARKED,
  HANDOFF_TARGET_WORKSPACE,
  MAX_TRAIL,
  RESERVED_HANDOFF_TARGETS,
  originPhrase,
  readOrigin,
  readPending,
  readTrail,
  type HandoffOrigin,
} from "./origin";

/** One example of each kind — the corpus every phrase check runs over. */
function examples(): HandoffOrigin[] {
  return HANDOFF_ORIGINS.flatMap((kind): HandoffOrigin[] => {
    switch (kind) {
      case "workspace":
        return [{ kind }];
      case "drop":
        return DROP_SURFACES.map((surface) => ({ kind, surface }));
      case "result":
        return [{ kind, fromSlug: "merge-pdf" }];
      case "remedy":
        return [
          { kind, fromSlug: "rotate-pdf", problem: "encrypted" },
          { kind, fromSlug: "rotate-pdf", problem: "unreadable" },
        ];
    }
  });
}

const CONTEXTS = [
  { count: 1, fileName: "report.pdf", fromName: "Merge PDF" },
  { count: 3, fileName: null, fromName: "Rotate PDF" },
  { count: 2, fileName: null, fromName: null },
] as const;

describe("originPhrase", () => {
  it("says the spec's sentence for each origin", () => {
    const one = { count: 1, fileName: "report.pdf", fromName: "Merge PDF" };
    const two = { count: 2, fileName: null, fromName: null };
    expect(originPhrase({ kind: "workspace" }, two)).toBe(
      "Loaded 2 files from your workspace.",
    );
    expect(originPhrase({ kind: "workspace" }, one)).toBe(
      "Loaded 1 file from your workspace.",
    );
    // WAS "Loaded the 2 files you added." / "Loaded the file you added." —
    // false whenever the gate kept fewer than were added (see below).
    expect(originPhrase({ kind: "drop", surface: "home" }, two)).toBe(
      "Loaded 2 files you added.",
    );
    expect(originPhrase({ kind: "drop", surface: "home" }, one)).toBe(
      "Loaded 1 file you added.",
    );
    expect(originPhrase({ kind: "result", fromSlug: "merge-pdf" }, one)).toBe(
      "Loaded your result from Merge PDF.",
    );
    expect(
      originPhrase(
        { kind: "remedy", fromSlug: "rotate-pdf", problem: "encrypted" },
        { ...one, fromName: "Rotate PDF" },
      ),
    ).toBe("Loaded report.pdf from Rotate PDF to unlock it first.");
  });

  it("renders every origin kind, each to its own sentence (exhaustive)", () => {
    const seen = new Map<string, string>();
    for (const origin of examples()) {
      const phrase = originPhrase(origin, CONTEXTS[1]);
      expect(phrase, origin.kind).toMatch(/^Loaded .+\.$/);
      seen.set(phrase, origin.kind);
    }
    // Health: the corpus holds every kind, not one kind many times.
    expect(new Set(examples().map((o) => o.kind))).toEqual(
      new Set(HANDOFF_ORIGINS),
    );
    // A workspace phrase never speaks for another origin.
    for (const [phrase, kind] of seen) {
      if (kind !== "workspace") expect(phrase).not.toMatch(/workspace/i);
    }
  });

  it("every rendered phrase passes the copy predicates, and its numbers are the counts passed in", () => {
    const offenders: string[] = [];
    let rendered = 0;
    for (const origin of examples())
      for (const ctx of CONTEXTS) {
        const phrase = originPhrase(origin, ctx);
        rendered += 1;
        for (const p of TRANSMISSION_FORBIDDEN)
          if (p.test(phrase)) offenders.push(`${phrase} — ${p}`);
        for (const { label, pattern } of ACCOUNT_CLAIMS)
          if (pattern.test(phrase)) offenders.push(`${phrase} — ${label}`);
        for (const { name, pattern } of PERSONAL_CONDUCT_CLAIMS)
          if (pattern.test(phrase)) offenders.push(`${phrase} — ${name}`);
        // The only number a phrase may print is the file count it was given.
        for (const n of phrase.match(/\d+/g) ?? [])
          if (Number(n) !== ctx.count) offenders.push(`${phrase} — ${n}`);
      }
    expect(rendered).toBeGreaterThanOrEqual(15);
    expect(offenders).toEqual([]);
  });
});

/**
 * FOUND IN REVIEW (2026-10-09): "Loaded the file you added." is a definite
 * description — it says the loaded file IS what was added. The count it was
 * given is what arrived AFTER the gate (`handoffPayload`), which keeps only
 * what the tool takes: three PDFs dropped on the home page and sent to Sign
 * PDF arrived as one, and the badge called it "the file you added", with
 * nothing said of the other two; 2 PDFs and a DOCX sent to Merge PDF read
 * "the 2 files you added". No phrase may describe the loaded files as THE
 * files of some larger set, since no origin's count says how many there were.
 */
describe("a phrase never says the files that loaded are all that were sent", () => {
  /** "the file", "the 2 files", "the files": the loaded set, as definite. */
  const DEFINITE = /\bthe (?:\d+ )?files?\b/i;

  it("the pattern catches every sentence that shipped with the defect", () => {
    for (const shipped of [
      "Loaded the file you added.",
      "Loaded the 2 files you added.",
      "Loaded the files you added.",
    ])
      expect(shipped, shipped).toMatch(DEFINITE);
  });

  it("no rendered phrase, for any origin or count, is definite about its files", () => {
    const offenders: string[] = [];
    let rendered = 0;
    for (const origin of examples())
      for (const count of [1, 2, 3]) {
        const phrase = originPhrase(origin, {
          count,
          fileName: count === 1 ? "report.pdf" : null,
          fromName: "Merge PDF",
        });
        rendered += 1;
        if (DEFINITE.test(phrase)) offenders.push(phrase);
      }
    expect(rendered).toBe(examples().length * 3);
    expect(offenders).toEqual([]);
  });
});

describe("reading a stored record's provenance", () => {
  it("a record made before origins existed reads as the workspace (migration)", () => {
    expect(readOrigin(undefined)).toEqual({ kind: "workspace" });
  });

  it("a malformed origin is not trusted: it reads as the workspace too", () => {
    for (const bad of [
      null,
      "drop",
      { kind: "nope" },
      { kind: "drop", surface: "moon" },
      { kind: "result" },
      { kind: "remedy", fromSlug: "rotate-pdf", problem: "boredom" },
      { kind: "result", fromSlug: "../../etc" },
    ])
      expect(readOrigin(bad), JSON.stringify(bad)).toEqual({
        kind: "workspace",
      });
  });

  it("a well-formed origin survives the round trip", () => {
    for (const origin of examples()) expect(readOrigin(origin)).toEqual(origin);
  });

  it("the trail keeps slugs only, the most recent MAX_TRAIL of them", () => {
    expect(readTrail(undefined)).toEqual([]);
    expect(
      readTrail(["merge-pdf", 4, "", "Not A Slug", "compress-pdf"]),
    ).toEqual(["merge-pdf", "compress-pdf"]);
    const long = Array.from({ length: MAX_TRAIL + 3 }, (_, i) => `tool-${i}`);
    expect(readTrail(long)).toEqual(long.slice(-MAX_TRAIL));
  });

  it("a pending step needs a slug; its parked id is optional", () => {
    expect(readPending(undefined)).toBeNull();
    expect(readPending({ toolSlug: "merge-pdf", parkedId: null })).toEqual({
      toolSlug: "merge-pdf",
      parkedId: null,
    });
    expect(
      readPending({ toolSlug: "merge-pdf", parkedId: "h_0123456789abcdef" }),
    ).toEqual({ toolSlug: "merge-pdf", parkedId: "h_0123456789abcdef" });
    expect(readPending({ toolSlug: 7 })).toBeNull();
    expect(readPending({ toolSlug: "merge-pdf", parkedId: 9 })).toBeNull();
  });
});

describe("the reserved targets", () => {
  it("are workspace and parked", () => {
    expect([...RESERVED_HANDOFF_TARGETS].sort()).toEqual(
      [HANDOFF_TARGET_PARKED, HANDOFF_TARGET_WORKSPACE].sort(),
    );
    expect(HANDOFF_TARGET_WORKSPACE).toBe("workspace");
    expect(HANDOFF_TARGET_PARKED).toBe("parked");
  });

  it("are no catalogue tool's slug, so a hand-off to one can never open a tool", () => {
    const slugs = getAllToolSlugs();
    expect(slugs.length).toBeGreaterThanOrEqual(40);
    expect(
      slugs.filter((s) => RESERVED_HANDOFF_TARGETS.includes(s as never)),
    ).toEqual([]);
  });
});
