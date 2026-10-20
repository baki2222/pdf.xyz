/**
 * The fix a known refusal offers: the tool that can do what this one could
 * not, named in the error itself ("Every ending is a fork", redesign E.6).
 *
 * EXHAUSTIVE over what the engine can say it refused (`PdfEngineErrorKind`),
 * plus the size refusal, which has its limit and nothing else: a tool cannot
 * make a file smaller than a limit it was refused for. An error the engine
 * did not classify gets nothing — `remedies.test.ts` holds that absence as
 * its positive control, so a guess can never pass for a fix.
 *
 * Not here, on purpose (addendum WP-08 #3): "no selectable text" is a
 * SUCCESS that already says what to do (`NoSelectableTextNote`, and Compare
 * PDF's own states), not a refusal.
 *
 * A REMEDY IS A LINK TODAY. Both targets run on the secure worker, and no
 * worker tool can take a hand-off yet (`handoffCapabilityFor`), so the file
 * cannot travel with the click; the link says where the file goes instead.
 * `remedies.test.ts` fails the day a target CAN take one — the exit names
 * the property (the target receives files), and that is when the remedy
 * starts carrying the file, with a `remedy` origin.
 */
import type { ProcessingMode } from "@/lib/tools/types";
import { getToolBySlug } from "@/lib/tools";
import {
  PdfEncryptedError,
  PdfEngineError,
  type PdfEngineErrorKind,
} from "./engine";
import {
  UNLOCK_TOOL_HREF,
  UNLOCK_TOOL_NAME,
  type EncryptionVerdict,
} from "./encryption";

/** The tool a damaged file is sent to, and where it lives. */
export const REPAIR_TOOL_NAME = "Repair PDF";
export const REPAIR_TOOL_HREF = "/tools/repair-pdf";

/** What an error says about its cause — read off the thrown error. */
export interface RemedyInput {
  /** The engine's refusal, or a size refusal (a file-check, not the engine). */
  readonly kind?: PdfEngineErrorKind | "too-large";
  /** For an encrypted file: what a reader made of its lock. */
  readonly verdict?: EncryptionVerdict | null;
}

export interface Remedy {
  readonly toolSlug: string;
  readonly toolName: string;
  readonly href: string;
  readonly problem: PdfEngineErrorKind;
  /** The link's words: "Open Unlock PDF", "Try Repair PDF". */
  readonly label: string;
  /** How it fixes this file, after the link: "with the password…". */
  readonly why: string;
  /** Where the remedy runs, read from the catalogue. */
  readonly processing: ProcessingMode;
  /**
   * Where the file goes there, said at the moment it would move — or null
   * for a mode no remedy runs in yet, which `remedies.test.ts` fails, so a
   * new remedy cannot ship without saying it.
   */
  readonly where: string | null;
}

/**
 * The sentence for where a file goes in a tool it cannot be carried to; the
 * worker tools are the only ones today. Also said by a preflight hint whose
 * target cannot take the file yet (`@/components/intent/preflight-hint`).
 */
export function whereFor(mode: ProcessingMode): string | null {
  return mode === "server"
    ? "You add the file there, and it uploads to the secure worker only when you start it."
    : null;
}

/** The words for an encrypted file, by what a reader made of its lock. */
function unlockWhy(verdict: EncryptionVerdict | null | undefined): string {
  switch (verdict) {
    case "needs-password":
      return "with the password that opens it";
    case "opens-without-password":
      return "with the owner (permissions) password that set its restrictions";
    default:
      // Could not tell: true of both kinds, never "leave it blank".
      return "with the password that opens it — or, if it opens without one, its owner (permissions) password";
  }
}

function remedy(
  toolSlug: string,
  fallbackName: string,
  href: string,
  problem: PdfEngineErrorKind,
  verb: "Open" | "Try",
  why: string,
): Remedy {
  const tool = getToolBySlug(toolSlug);
  const toolName = tool?.name ?? fallbackName;
  const processing = tool?.processing ?? "server";
  return {
    toolSlug,
    toolName,
    href,
    problem,
    label: `${verb} ${toolName}`,
    why,
    processing,
    where: whereFor(processing),
  };
}

/**
 * The fix for an error, offered from the tool `fromSlug` — or null when the
 * error names no cause, or the fix is the tool that just failed.
 */
export function remedyFor(input: RemedyInput, fromSlug: string): Remedy | null {
  const found = remedyOf(input);
  return found && found.toolSlug !== fromSlug ? found : null;
}

function remedyOf({ kind, verdict }: RemedyInput): Remedy | null {
  switch (kind) {
    case "encrypted":
      return remedy(
        "unlock-pdf",
        UNLOCK_TOOL_NAME,
        UNLOCK_TOOL_HREF,
        "encrypted",
        "Open",
        unlockWhy(verdict),
      );
    case "unreadable":
      return remedy(
        "repair-pdf",
        REPAIR_TOOL_NAME,
        REPAIR_TOOL_HREF,
        "unreadable",
        "Try",
        "to recover as much of the file as it can",
      );
    case "too-large":
      // The refusal states the limit; no tool here gets past it.
      return null;
    case undefined:
      return null;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/** What a thrown value says about its cause, for {@link remedyFor}. */
export function causeOf(err: unknown): RemedyInput {
  if (!(err instanceof PdfEngineError) || err.kind === undefined) return {};
  return err.kind === "encrypted"
    ? {
        kind: "encrypted",
        verdict: err instanceof PdfEncryptedError ? err.verdict : null,
      }
    : { kind: err.kind };
}
