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
 *  - whether it CARRIES the file is the hand-off capability's answer, not a
 *    flag of its own (a plain link until the target can take a file);
 *  - an error with no kind, and a size refusal, get nothing — the positive
 *    control that the absence of a remedy is a decision too.
 */
import { describe, expect, it } from "vitest";
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { getToolBySlug } from "@/lib/tools";
import { PDF_ENGINE_ERROR_KINDS } from "./engine";
import { UNLOCK_TOOL_HREF, UNLOCK_TOOL_NAME } from "./encryption";
import { REPAIR_TOOL_NAME, remedyFor, type RemedyInput } from "./remedies";

const VERDICTS = ["needs-password", "opens-without-password", null] as const;

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
      // Where it runs is said, from the catalogue.
      expect(remedy!.processing).toBe(target!.processing);
      // Carrying the file is the capability's call.
      expect(remedy!.carries).toBe(
        handoffCapabilityFor(remedy!.toolSlug).supported,
      );
    },
  );

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

describe("POSITIVE CONTROL: no kind, no remedy", () => {
  it("an error the engine did not classify gets nothing", () => {
    expect(remedyFor({ kind: undefined }, "rotate-pdf")).toBeNull();
    expect(remedyFor({}, "rotate-pdf")).toBeNull();
  });

  it("a size refusal states its limit and offers no tool", () => {
    expect(remedyFor({ kind: "too-large" }, "rotate-pdf")).toBeNull();
  });
});
