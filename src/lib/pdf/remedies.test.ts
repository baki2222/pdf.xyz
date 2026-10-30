// @vitest-environment node
/**
 * The fix a known error offers — exhaustive over what the engine can say it
 * refused, and silent for anything it cannot name.
 *
 * A remedy is a promise like a Continue row: that tool fixes this file. So
 * each is checked against what is true of the file, never a typed table of
 * expected labels:
 *
 *  - every kind the engine refuses with gets a decision (the switch is
 *    exhaustive at compile time; this walks the runtime list of kinds);
 *  - an encrypted file's way out reads its VERDICT, all three of them, and
 *    never tells anyone to leave the password blank (Unlock refuses an empty
 *    password — `PDF_RESTRICTED_MESSAGE`);
 *  - a remedy is never the tool that failed;
 *  - it CARRIES the file exactly when its target can take a hand-off. Until
 *    WP-10 it was a plain link, and this file failed the day a target could
 *    take one — the exit named the property (the target receives files).
 *    WP-10's stage mode met it, so the test is inverted, not deleted;
 *  - an error with no kind, and a size refusal, get nothing — the positive
 *    control that the absence of a remedy is a decision too.
 */
import { describe, expect, it } from "vitest";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { getToolBySlug } from "@/lib/tools";
import { PDF_ENGINE_ERROR_KINDS } from "./engine";
import { UNLOCK_TOOL_HREF, UNLOCK_TOOL_NAME } from "./encryption";
import {
  REPAIR_TOOL_NAME,
  UPLOAD_CLAUSE,
  causeOf,
  remedyCarries,
  remedyFor,
  type RemedyInput,
} from "./remedies";

const VERDICTS = ["needs-password", "opens-without-password", null] as const;

/**
 * Does a remedy's `where` say where the file goes, and when? It must carry
 * the module's own clause, read from `remedies.ts` rather than retyped.
 *
 * HISTORY (2026-10-30, PR #228): this pinned the literal "uploads to the
 * secure worker only when you start it". The copy pass that replaced
 * "worker" with "our secure server" in the sentence turned it red on CI
 * for Repair PDF and Unlock PDF — the property held, the words had moved.
 * Now the clause is one constant both sentences are built from, and the
 * controls below hold the predicate to the property: it must reject a
 * sentence that names no destination, and the clause itself must still
 * name an upload, a server, and the reader's own start.
 */
const saysWhereTheFileGoes = (where: string | null | undefined) =>
  typeof where === "string" && where.includes(UPLOAD_CLAUSE);

describe("the where-the-file-goes predicate", () => {
  it("health check: the clause names the upload, where it goes, and when", () => {
    expect(UPLOAD_CLAUSE).toMatch(/\buploads?\b/);
    expect(UPLOAD_CLAUSE).toMatch(/\bsecure server\b/);
    expect(UPLOAD_CLAUSE).toMatch(/\bonly when you start it\b/);
  });

  it("control: rejects a sentence that says nothing about where the file goes", () => {
    expect(saysWhereTheFileGoes("Your file goes with you.")).toBe(false);
    expect(saysWhereTheFileGoes(null)).toBe(false);
    // ...and the sentence that shipped before the copy pass, whose clause is
    // no longer the module's: a stale sentence is not accepted either.
    expect(
      saysWhereTheFileGoes(
        "Your file goes with you, and it uploads to the secure worker only when you start it.",
      ),
    ).toBe(false);
  });
});

describe("every refusal the engine can name has a decision", () => {
  it("health check: the kinds are the engine's own list", () => {
    expect(PDF_ENGINE_ERROR_KINDS).toEqual(["encrypted", "unreadable"]);
  });

  it.each(PDF_ENGINE_ERROR_KINDS.map((k) => [k]))(
    "%s leads to a real tool that is not the one that failed",
    (kind) => {
      const remedy = remedyFor({ kind, verdict: null }, "rotate-pdf");
      expect(remedy).not.toBeNull();
      const target = getToolBySlug(remedy!.toolSlug);
      expect(target, remedy!.toolSlug).toBeDefined();
      expect(remedy!.toolName).toBe(target!.name);
      expect(remedy!.href).toBe(`/tools/${remedy!.toolSlug}`);
      expect(remedy!.problem).toBe(kind);
      // Where it runs is said, from the catalogue, in words.
      expect(remedy!.processing).toBe(target!.processing);
      expect(
        saysWhereTheFileGoes(remedy!.where),
        `${remedy!.toolName} runs as "${remedy!.processing}", and nothing says where the file goes there: ${remedy!.where}`,
      ).toBe(true);
      expect(remedy!.label).toMatch(
        new RegExp(`^(?:Open|Try) ${remedy!.toolName}$`),
      );
    },
  );

  // INVERTED in WP-10. WAS "%s: a link today, because its target cannot
  // take a file yet", asserting `handoffCapabilityFor(target).supported` was
  // false — with the message "make its remedy carry the file … and invert
  // this". The worker panels stage a carried file now, so it carries.
  it.each(PDF_ENGINE_ERROR_KINDS.map((k) => [k]))(
    "%s: carries the file, because its target takes a hand-off",
    (kind) => {
      const remedy = remedyFor({ kind, verdict: null }, "rotate-pdf")!;
      expect(handoffCapabilityFor(remedy.toolSlug).supported).toBe(true);
      expect(remedy.carries).toBe(true);
      expect(remedy.where).toMatch(/^Your file goes with you/);
    },
  );

  it("positive control: a remedy whose target took no hand-off would not carry", () => {
    // `carries` is read from the capability, never typed: a target with no
    // way to receive the file keeps the old link and its old sentence.
    expect(
      remedyCarries("webpage-to-pdf"),
      "webpage-to-pdf takes a URL, not a file",
    ).toBe(false);
  });

  it("the names the copy uses are the catalogue's", () => {
    expect(getToolBySlug("unlock-pdf")?.name).toBe(UNLOCK_TOOL_NAME);
    expect(UNLOCK_TOOL_HREF).toBe("/tools/unlock-pdf");
    expect(getToolBySlug("repair-pdf")?.name).toBe(REPAIR_TOOL_NAME);
  });
});

describe("an encrypted file: Unlock PDF, said for its verdict", () => {
  it.each(VERDICTS.map((v) => [v]))("verdict %s", (verdict) => {
    const remedy = remedyFor({ kind: "encrypted", verdict }, "rotate-pdf");
    expect(remedy?.toolSlug).toBe("unlock-pdf");
    expect(remedy?.toolName).toBe(UNLOCK_TOOL_NAME);
    // Never "leave the password blank": Unlock refuses an empty password.
    expect(remedy!.why).not.toMatch(/\bblank\b|\bempty\b|\bno password\b/i);
  });

  it("each verdict says which password Unlock will ask for", () => {
    const why = (verdict: RemedyInput["verdict"]) =>
      remedyFor({ kind: "encrypted", verdict }, "rotate-pdf")!.why;
    expect(why("needs-password")).toMatch(/password that opens it/i);
    expect(why("opens-without-password")).toMatch(/owner \(permissions\)/i);
    // Undetermined: true of both kinds.
    expect(why(null)).toMatch(/password that opens it/i);
    expect(why(null)).toMatch(/owner \(permissions\)/i);
    expect(new Set(VERDICTS.map(why)).size).toBe(3);
  });
});

describe("an unreadable file: Repair PDF", () => {
  it("is offered from any other tool", () => {
    const remedy = remedyFor({ kind: "unreadable" }, "rotate-pdf");
    expect(remedy?.toolSlug).toBe("repair-pdf");
  });
});

describe("a remedy is never the tool that failed", () => {
  it("Repair PDF failing to read a file does not offer Repair PDF", () => {
    expect(remedyFor({ kind: "unreadable" }, "repair-pdf")).toBeNull();
    expect(
      remedyFor({ kind: "encrypted", verdict: null }, "unlock-pdf"),
    ).toBeNull();
  });
});

describe("the cause is read off the thrown error", () => {
  it("an encrypted refusal carries its verdict; an unreadable one its kind", async () => {
    const { PdfEncryptedError, PdfEngineError } = await import("./engine");
    expect(causeOf(new PdfEncryptedError("needs-password"))).toEqual({
      kind: "encrypted",
      verdict: "needs-password",
    });
    expect(causeOf(new PdfEngineError("x", { kind: "encrypted" }))).toEqual({
      kind: "encrypted",
      verdict: null,
    });
    expect(causeOf(new PdfEngineError("x", { kind: "unreadable" }))).toEqual({
      kind: "unreadable",
    });
    // No kind, or not ours: nothing to read.
    expect(causeOf(new PdfEngineError("x"))).toEqual({});
    expect(causeOf(new Error("x"))).toEqual({});
    expect(causeOf("x")).toEqual({});
  });
});

describe("POSITIVE CONTROL: no kind, no remedy", () => {
  it("an error the engine did not classify gets nothing", () => {
    expect(remedyFor({ kind: undefined }, "rotate-pdf")).toBeNull();
    expect(remedyFor({}, "rotate-pdf")).toBeNull();
  });

  it("a size refusal states its limit and offers no tool", () => {
    expect(remedyFor({ kind: "too-large" }, "rotate-pdf")).toBeNull();
  });
});
