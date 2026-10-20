// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { WORKER_RUN_CLASSES } from "./runner/runner-kit";

/**
 * A button the user just pressed must not be taken away from them.
 *
 * `disabled={busy}` reads as obviously correct and is the single most damaging
 * line in this codebase's history: a natively disabled element cannot hold
 * focus, so the browser blurs it the instant the run starts and a keyboard or
 * screen-reader user spends the whole job at `<body>`. #42 repaired the far end
 * of that journey, #46 fixed the cause in `RunButton` — and the site still had
 * the bug FOURTEEN more times, because every worker panel had pasted its own
 * trigger instead of using the component. Fixing one copy fixed one copy.
 *
 * That is what this guards, and it is why it scans source rather than rendering:
 * the behavioural tests in `runner-kit.a11y.test.tsx` prove the shared component
 * is correct, and proved nothing at all about the fourteen files that did not
 * use it. Component correctness and site-wide adoption are different claims.
 *
 * WOULD THIS BE GREEN IF THE FIX WERE ABSENT? No — measured, not assumed. Run
 * against `HEAD~` (the tree before this change) the first check reports 17
 * offenders: the 14 hand-rolled run triggers plus the two "Download ZIP"
 * buttons and the workspace hand-off button, which are the same defect on a
 * different verb.
 */

const ROOTS = [
  path.join(process.cwd(), "src", "components"),
  path.join(process.cwd(), "src", "app"),
];

/** The one legal home for the worker panels' trigger markup. */
const TRIGGER_OWNER = path.join("tools", "runner", "runner-kit.tsx");

/**
 * The hand-rolled trigger's class fingerprint: a tone tint at the run-button
 * size, as the worker trigger was drawn until WP-10 made it solid
 * (`WORKER_RUN_CLASSES`). The tint pair alone also draws pills and badges,
 * so the fingerprint is the tint WITH its hover step — a button's, never a
 * badge's.
 *
 * WAS `/(?:blue|violet)-500\/15 px-6 py-2\.5/`: the palette the trigger used
 * before the token system (bb78ee79). From that commit on it matched no
 * file at all, the owner included — a guard of nothing, which is why it now
 * carries a positive control against the markup it was written to catch.
 */
const TRIGGER_MARKUP =
  /bg-(?:info|accent)\/10 text-(?:info|accent) hover:bg-(?:info|accent)\/20/;

/** The trigger's markup as it shipped before WP-10 (runner-kit, d0c0316f). */
const PRE_WP10_TRIGGER = [
  "inline-flex w-full items-center justify-center gap-2 rounded-[3px] border px-6 py-2.5 text-sm font-semibold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-65 sm:w-auto sm:self-start",
  "border-info/40 bg-info/10 text-info hover:bg-info/20",
].join(" ");

function sourceFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [full]
        : [];
    });
  return ROOTS.flatMap(walk);
}

/**
 * Every `<tagName …>` opening tag in a source file.
 *
 * Deliberately not `/<button[^>]*>/`: attribute values contain `>` all over this
 * codebase (`disabled={fields.length >= MAX_EXTRACTION_FIELDS}`), so that regex
 * truncates the tag mid-attribute and silently stops seeing the ones after it —
 * a scanner that finds nothing looks exactly like a clean repo. This tracks
 * brace and quote depth and ends the tag at a `>` outside both. Lowercase tag
 * names only, so `<ChipButton disabled={busy}>` (a component whose PROP renders
 * as aria-disabled) is never mistaken for a native element.
 */
function openingTags(source: string, tagName: string): string[] {
  const tags: string[] = [];
  const OPEN = new RegExp(`<${tagName}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = OPEN.exec(source)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = match.index; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) {
        tags.push(source.slice(match.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

function buttonTags(source: string): string[] {
  return openingTags(source, "button");
}

/** Every native form-control opening tag (`button`, `input`, `select`, `textarea`). */
function nativeControlTags(source: string): string[] {
  return ["button", "input", "select", "textarea"].flatMap((tag) =>
    openingTags(source, tag),
  );
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

describe("a run does not blur the user who started it", () => {
  it("finds the components, so a move cannot quietly empty this suite", () => {
    const withButtons = sourceFiles().filter(
      (file) => buttonTags(readFileSync(file, "utf8")).length > 0,
    );
    expect(withButtons.length).toBeGreaterThanOrEqual(30);
  });

  it("never takes a busy control out of the focus order", () => {
    // `aria-busy` marks a control the user has just activated — it is the one
    // element in the document that must survive the work it started. Native
    // `disabled` on that element is the bug, whatever the verb: run, zip, launch.
    const offenders = sourceFiles().flatMap((file) =>
      buttonTags(readFileSync(file, "utf8"))
        .filter((tag) => /\baria-busy=/.test(tag) && /\sdisabled=/.test(tag))
        .map(
          (tag) =>
            `${relative(file)} — ${tag.replace(/\s+/g, " ").slice(0, 90)}…`,
        ),
    );

    expect(
      offenders,
      `these buttons announce they are busy and then remove themselves from the focus order, dropping the user to <body> for the duration:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no native control in the tools sources removes itself from the focus order", () => {
    // #46/#47 fixed the trigger; the class survived on the controls BESIDE it,
    // in two flavours: busy-state (option chips, the strength radios, the
    // password field — disable at t=0 of a run) and bounds-state (TileAction's
    // move/remove, ai-extract's add/remove field, the OCR language cap, the
    // add-signer cap — disable at the exact moment the user's own repeated
    // press reaches the edge). Both eject focus and leave the tab order. After
    // sweeping every one to `aria-disabled` + a self-guarding handler (or
    // `readOnly` for an input), NO native form control under these sources
    // carries the attribute at all, so the rule is total rather than a name
    // list a new binding could slip past: bind `aria-disabled`, guard the
    // handler, and move `disabled:` styling to `aria-disabled:` variants
    // (ChipButton/TileAction in the runner kit are the pattern). Component
    // PROPS named `disabled` (<ChipButton disabled={…}>, <WorkerRunButton
    // disabled={…}>) are fine — they render as aria-disabled; this scans
    // lowercase native tags only.
    const offenders = sourceFiles().flatMap((file) =>
      nativeControlTags(readFileSync(file, "utf8"))
        .filter((tag) => /\sdisabled=/.test(tag))
        .map(
          (tag) =>
            `${relative(file)} — ${tag.replace(/\s+/g, " ").slice(0, 90)}…`,
        ),
    );

    expect(
      offenders,
      `these native controls remove themselves from the focus order (use aria-disabled + a guarded handler, or readOnly for an input):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("positive control: the fingerprint catches the trigger it was written for", () => {
    expect(TRIGGER_MARKUP.test(PRE_WP10_TRIGGER)).toBe(true);
    expect(
      TRIGGER_MARKUP.test(PRE_WP10_TRIGGER.replace(/info/g, "accent")),
    ).toBe(true);
  });

  it("the worker trigger is the solid primary, from the button variants", () => {
    // The fix itself: green only while WorkerRunButton draws the primary.
    expect(WORKER_RUN_CLASSES).toContain("bg-invert");
    expect(WORKER_RUN_CLASSES).toContain(
      buttonVariants({ variant: "primary", size: "lg" }).split(" ")[0]!,
    );
    expect(TRIGGER_MARKUP.test(WORKER_RUN_CLASSES)).toBe(false);
    const owner = readFileSync(
      path.join(process.cwd(), "src", "components", TRIGGER_OWNER),
      "utf8",
    );
    expect(owner).toMatch(/className=\{WORKER_RUN_CLASSES\}/);
  });

  it("keeps the worker panels' trigger markup in one place", () => {
    // The copying is what let one fix miss fourteen sites. A fifteenth copy
    // would be correct today and wrong at the next fix, so it is the copying
    // itself that is disallowed — use <WorkerRunButton>.
    // No exemption for the owner since WP-10: it draws the solid primary, so
    // a tint trigger anywhere — the owner included — is a regression.
    const offenders = sourceFiles()
      .filter((file) => TRIGGER_MARKUP.test(readFileSync(file, "utf8")))
      .map(relative);

    expect(
      offenders,
      `these files hand-roll the worker run trigger instead of using <WorkerRunButton>:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
