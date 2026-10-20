// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO PAGE MAY SAY A WORKER TOOL'S DROP ZONE WAITS FOR THE WORKER.
 *
 * Until WP-10 a worker panel mounted its drop zone only once the status
 * check said the worker was ready, and the copy said so — eighteen
 * sentences across the tool pages. WP-10 renders the drop zone at once
 * (only Run waits), which made every one of them false. They were found by
 * searching, and the first search missed eight: each was worded its own
 * way ("appears only", "is missing until", "stand where the field would
 * be", "You get that box only when"…).
 *
 * CLAUDE.md rule 1, both directions: every sentence below — the OLD
 * wording, as it shipped on d0c0316f — is caught by some pattern, and every
 * pattern catches some sentence below. The subjects are discovered: every
 * source file under the tool content and the guides, comments excluded.
 * Patterns use `\s+` between words, so a sentence wrapped across source
 * lines is still one sentence to them.
 */

const SHIPPED_BEFORE_WP10: readonly string[] = [
  // chat-with-pdf
  "When the status badge reads Secure worker, the Add your PDF, or browse area appears, together with the question box.",
  // excel-to-pdf
  'The area is shown only while the panel\'s badge says "Secure worker".',
  // extract-tables
  "The area appears only while the status badge reads Secure worker, and a Remove button beside the chosen file's name clears a wrong pick.",
  // html-to-pdf
  "When no secure worker is ready, the drop area is not shown at all: you get the worker's status and a “Notify me when this ships” button.",
  // ocr-pdf
  "That area appears only after the page confirms the OCR worker is available, and your file is sent only when you press the button.",
  // optimize-web
  "Until that answer is yes, no drop box is shown: while the check runs the panel says “Checking the secure worker…”",
  // pdf-to-excel
  'While the worker is unavailable the panel offers "Notify me when this ships" in place of a drop box; once the badge reads "Secure worker", the box is there.',
  // pdf-to-pdfa
  "Otherwise the panel says why and shows no uploader, so nothing is sent.",
  // pdf-to-powerpoint
  "The upload box appears only while the panel's status badge reads Secure worker; if it says Not enabled or Status unknown, there is nowhere to add a file yet.",
  // pdf-to-word
  "Once the status badge reads Secure worker, drop your file on the Add your PDF area or choose browse to pick it.",
  // powerpoint-to-pdf
  'You get that box only when the status badge next to "LibreOffice renderer" says "Secure worker"; any other badge comes with a note on the state of the converter instead.',
  // repair-pdf
  "That box is missing until the status badge at the top of the panel reads Secure worker.",
  // request-signatures
  "The form shows only when the status check finds the worker's storage, queue and daemon ready.",
  // summarize-pdf
  "If the worker's status cannot be checked, a short note and a Check again button take the place of that box.",
  // translate-pdf
  "The box appears only once the page confirms a secure worker with an AI model is available.",
  // unlock-pdf (two)
  'Once the badge reads Secure worker, drop one PDF onto the area that reads "Add a locked PDF, or browse"; clicking that area opens a file picker instead.',
  "If no worker is available, the panel explains why and shows neither the drop area nor the password field.",
  // webpage-to-pdf
  'If the secure worker is unavailable, a status note and a "Notify me when this ships" button stand where the field would be.',
  // word-to-pdf (two)
  'If the badge reads "Not enabled", it shows a "Notify me when this ships" button instead of taking a file it cannot convert.',
  "No file can be added until a check confirms the worker.",
];

/** Each names one SHAPE of "the place to add a file waits for the worker". */
export const UPLOAD_GATE_CLAIMS: Readonly<Record<string, RegExp>> = {
  // "the area is shown only while", "the form shows only when", "the box
  // appears only once": the drop place exists only under a condition.
  shownOnly:
    /\b(?:area|box|drop\s+zone|drop\s+area|upload\s+box|form|uploader)\s+(?:is\s+shown|appears|shows)\s+only\b/i,
  // "that box is missing until", "the drop area is not shown", "no drop box
  // is shown", "shows no uploader", "shows neither the drop area".
  notShown:
    /\b(?:(?:box|area)\s+is\s+missing\s+until|drop\s+(?:area|box|zone)\s+is\s+not\s+shown|no\s+drop\s+(?:box|area|zone)\s+is\s+shown|shows\s+no\s+uploader|shows\s+neither\s+the\s+drop\s+area)\b/i,
  // "once the badge reads Secure worker, drop …", "when the status badge
  // reads Secure worker, the … area appears", "…, the box is there".
  afterBadge:
    /\b(?:once|when)\s+the\s+(?:status\s+)?badge\s+reads\s+["“]?Secure\s+worker["”]?,\s+(?:drop\b|the\s+(?:box|area|Add)\b)/i,
  // Something else stands where the drop place would be, or there is none.
  inItsPlace:
    /\b(?:in\s+place\s+of\s+a\s+drop\s+box|take\s+the\s+place\s+of\s+that\s+box|stand\s+where\s+the\s+field\s+would\s+be|instead\s+of\s+taking\s+a\s+file|nowhere\s+to\s+add\s+a\s+file|no\s+file\s+can\s+be\s+added\s+until|you\s+get\s+that\s+box\s+only)\b/i,
};

const ROOTS = [
  path.join(process.cwd(), "src", "lib", "tools", "content"),
  path.join(process.cwd(), "src", "lib", "guides"),
  // The panels' own words: the not-enabled reason, the run notes.
  path.join(process.cwd(), "src", "components", "tools"),
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const FILES = ROOTS.flatMap(walk);

/** A file's text with full-line comments dropped: history may quote the old copy. */
const copyOf = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join("\n");

const caughtBy = (text: string) =>
  Object.entries(UPLOAD_GATE_CLAIMS)
    .filter(([, re]) => re.test(text))
    .map(([name]) => name);

describe("no page says a worker tool's drop zone waits for the worker", () => {
  it("health: the walk finds the tool content and the guides", () => {
    const under = (dir: string) =>
      FILES.filter((f) => f.includes(`${path.sep}${dir}${path.sep}`)).length;
    expect(under("content")).toBeGreaterThanOrEqual(50);
    expect(under("guides")).toBeGreaterThanOrEqual(4);
    expect(
      FILES.filter((f) => f.endsWith("-worker-panel.tsx")).length,
    ).toBeGreaterThanOrEqual(13);
  });

  it("every sentence that shipped is caught by some pattern", () => {
    const missed = SHIPPED_BEFORE_WP10.filter((s) => caughtBy(s).length === 0);
    expect(missed).toEqual([]);
  });

  it("every pattern catches some sentence that shipped", () => {
    const idle = Object.keys(UPLOAD_GATE_CLAIMS).filter(
      (name) => !SHIPPED_BEFORE_WP10.some((s) => caughtBy(s).includes(name)),
    );
    expect(idle).toEqual([]);
  });

  it("a sentence broken across source lines is still caught", () => {
    expect(
      caughtBy("That box is missing\n    until the status badge reads it."),
    ).toEqual(["notShown"]);
  });

  it("no tool page or guide says it now", () => {
    const offenders = FILES.flatMap((file) => {
      const text = copyOf(file);
      return Object.entries(UPLOAD_GATE_CLAIMS)
        .map(([name, re]) => {
          const m = re.exec(text);
          return m
            ? `${path.relative(process.cwd(), file)} [${name}]: …${text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, " ")}…`
            : null;
        })
        .filter((x): x is string => x !== null);
    });
    expect(offenders).toEqual([]);
  });
});
