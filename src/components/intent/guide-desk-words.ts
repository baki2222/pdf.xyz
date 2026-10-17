/**
 * What a guide's desk says on its sheet — one spelling for the live desk
 * (`./guide-desk`) and the shell the server draws before it arrives
 * (`./guide-desk-shell`), so the two cannot say different things. Free of
 * React and of "use client": the server renders the shell from it.
 *
 * WHAT IT PROMISES is decided by the tool's runner, not by the guide: a tool
 * with no in-browser runner (PDF to Word, OCR, Protect, Translate, Repair,
 * Unlock) cannot be handed a file, so its desk says "see which tools open
 * it", never "open PDF to Word with it" (addendum WP-07 #8).
 */
export function guideDeskTitle({
  tool,
  opens,
  noun,
}: {
  readonly tool: { readonly name: string };
  readonly opens: "one" | "many" | null;
  readonly noun: { readonly one: string; readonly many: string };
}): string {
  return opens === "many"
    ? `Drop your ${noun.many} to open ${tool.name} with them, or`
    : opens === "one"
      ? `Drop ${noun.one} to open ${tool.name} with it, or`
      : `Drop ${noun.one} to see which tools open it, or`;
}

/** The hint's id: the shell has no `useId`, and a guide has one desk. */
export const GUIDE_DESK_HINT_ID = "guide-desk-hint";

/** The status slot under the sheet: always there, at its longest sentence's height. */
export const GUIDE_DESK_STATUS_CLASS = "text-muted min-h-8 text-xs leading-4";
