// @vitest-environment node
/**
 * The words a suggestion shows for the fact that justified it — every kind,
 * rendered, and read the way a visitor reads them.
 *
 * Source scans cannot see these sentences: they are templates, and a claim
 * built from interpolated parts evades every phrase guard that reads files
 * (`copy-surface.ts`: "NOT CLOSED: a phrase broken by interpolation"). So the
 * templates are RENDERED over a corpus here and the rendered text goes
 * through the predicates that matter for them:
 *
 *  - the transmission ban list and both identity ban lists;
 *  - the census, made stronger than a census: every number printed is parsed
 *    back and must be a field of the evidence it came from (a size through
 *    the one byte formatter) — "Every number shown is a field value";
 *  - the claims this layer could drift into: a prior is editorial, so no
 *    rendered text may call a tool "popular"; only a file that needs a
 *    password may be called password-protected; no evidence says what was
 *    uploaded (that is the badge's job, and its own guard's).
 *
 * And the source: no string in `evidence.ts` holds a digit, so a figure can
 * only arrive as a field.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FORBIDDEN as TRANSMISSION_FORBIDDEN } from "@/lib/tools/transmission-claims";
import {
  ACCOUNT_CLAIMS,
  PERSONAL_CONDUCT_CLAIMS,
} from "@/tests/identity-claims";
import { formatBytes } from "@/lib/utils";
import { unsupportedAnswer } from "./unsupported";
import { buildToolIndex } from "./tool-index";
import {
  EVIDENCE_KINDS,
  NOTE_KINDS,
  renderEvidence,
  renderNote,
  type Evidence,
  type RankNote,
} from "./evidence";

const MB = 1024 * 1024;
const index = buildToolIndex();

/** Every kind, more than once where its wording branches. */
const EVIDENCE: readonly Evidence[] = [
  { kind: "count", count: 1, noun: "pdf", format: "PDF" },
  { kind: "count", count: 2, noun: "pdf", format: "PDF" },
  { kind: "count", count: 3, noun: "image", format: null },
  { kind: "count", count: 1, noun: "file", format: "DOCX" },
  { kind: "count", count: 2, noun: "file", format: null },
  { kind: "pages", pages: 1 },
  { kind: "pages", pages: 15 },
  { kind: "size", bytes: 2 * MB },
  { kind: "size", bytes: 240 * 1024 },
  { kind: "big-file", name: "report.pdf", bytes: 12 * MB + 345 },
  { kind: "long", name: "thesis.pdf", pages: 212 },
  { kind: "no-text", name: null, from: 1, to: 1 },
  { kind: "no-text", name: null, from: 1, to: 3 },
  { kind: "no-text", name: "scan.pdf", from: 1, to: 2 },
  { kind: "fields", name: "annex.pdf", count: 4 },
  { kind: "fields", name: "annex.pdf", count: 1 },
  { kind: "lock", name: "contract.pdf", lock: "password-required" },
  { kind: "lock", name: "statement.pdf", lock: "restricted" },
  { kind: "lock", name: "odd.pdf", lock: "unknown" },
  { kind: "unreadable", name: "broken.pdf" },
  { kind: "after", tool: "Unlock PDF" },
  { kind: "after", tool: "Repair PDF" },
  { kind: "first-file", name: "contract.pdf" },
  { kind: "partial", opens: 2, total: 5 },
  { kind: "uploads" },
  { kind: "add-there", count: 1 },
  { kind: "add-there", count: 3 },
];

const tool = (slug: string) => index.find((t) => t.slug === slug)!;
const NOTES: readonly RankNote[] = [
  {
    kind: "unsupported",
    format: "HEIC",
    answer: unsupportedAnswer("HEIC", index),
  },
  {
    kind: "unsupported",
    format: "ZIP",
    answer: unsupportedAnswer("ZIP", index),
  },
  {
    kind: "unsupported",
    format: "EPUB",
    answer: unsupportedAnswer("EPUB", index),
  },
  {
    kind: "over-ceiling",
    name: "photo.png",
    bytes: 31 * MB,
    ceiling: tool("jpg-to-pdf").ceilingBytes!,
    tools: ["JPG to PDF", "PNG to PDF"],
  },
  {
    kind: "over-ceiling",
    name: "notes.txt",
    bytes: 3 * MB,
    ceiling: tool("text-to-pdf").ceilingBytes!,
    tools: ["Text to PDF"],
  },
  { kind: "contradicted", name: "report.pdf", named: "PDF", actual: "PNG" },
  { kind: "contradicted", name: "letter.pdf", named: "PDF", actual: "DOCX" },
  { kind: "contradicted", name: "notes.txt", named: "TXT", actual: null },
  { kind: "unrecognised", name: "data.weird" },
];

/** Every number a value may legitimately print: its numeric fields. */
function allowedNumbers(value: object): Set<string> {
  const out = new Set<string>();
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== "number") continue;
    out.add(String(field));
    if (/bytes|ceiling/i.test(key))
      for (const n of formatBytes(field).match(/\d+(?:\.\d+)?/g) ?? [])
        out.add(n);
  }
  return out;
}

function offences(text: string, value: object): string[] {
  const out: string[] = [];
  for (const p of TRANSMISSION_FORBIDDEN)
    if (p.test(text)) out.push(`transmission ${p}`);
  for (const { label, pattern } of ACCOUNT_CLAIMS)
    if (pattern.test(text)) out.push(label);
  for (const { name, pattern } of PERSONAL_CONDUCT_CLAIMS)
    if (pattern.test(text)) out.push(name);
  if (/popular/i.test(text)) out.push("a prior called popular");
  if (
    /upload(?:ed|s)? (?:nothing|no)|nothing (?:is|was) uploaded|never upload/i.test(
      text,
    )
  )
    out.push("an upload claim");
  const allowed = allowedNumbers(value);
  // Strip the file names: a name may hold digits that are the visitor's own.
  const named = "name" in value ? String(value.name) : "";
  const prose = named ? text.split(named).join("") : text;
  for (const n of prose.match(/\d+(?:\.\d+)?/g) ?? [])
    if (!allowed.has(n)) out.push(`the number ${n} is no field`);
  return out;
}

describe("renderEvidence", () => {
  it("health: the corpus holds every kind", () => {
    expect(new Set(EVIDENCE.map((e) => e.kind))).toEqual(
      new Set(EVIDENCE_KINDS),
    );
  });

  it("says each fact in the words the ticket shows", () => {
    const say = (e: Evidence) => renderEvidence(e);
    expect(say({ kind: "count", count: 2, noun: "pdf", format: "PDF" })).toBe(
      "2 PDFs",
    );
    expect(say({ kind: "pages", pages: 15 })).toBe("15 pages");
    expect(say({ kind: "size", bytes: 2 * MB })).toBe("2.0 MB");
    expect(say({ kind: "no-text", name: null, from: 1, to: 3 })).toBe(
      "No selectable text on pages 1–3",
    );
    expect(say({ kind: "no-text", name: null, from: 1, to: 1 })).toBe(
      "No selectable text on page 1",
    );
    expect(say({ kind: "fields", name: "annex.pdf", count: 4 })).toBe(
      "annex.pdf has 4 form fields",
    );
    expect(say({ kind: "partial", opens: 2, total: 5 })).toBe(
      "opens 2 of your 5 files",
    );
    expect(say({ kind: "uploads" })).toBe("uploads only when you start it");
  });

  it("only a file that needs a password is called password-protected", () => {
    for (const e of EVIDENCE) {
      const text = renderEvidence(e);
      if (/password/i.test(text))
        expect(e, text).toMatchObject({
          kind: "lock",
          lock: "password-required",
        });
    }
  });

  it("every rendered evidence passes the predicates, and prints only its own numbers", () => {
    const found = EVIDENCE.flatMap((e) =>
      offences(renderEvidence(e), e).map((o) => `${renderEvidence(e)} — ${o}`),
    );
    expect(found).toEqual([]);
  });
});

describe("renderNote", () => {
  it("health: the corpus holds every kind", () => {
    expect(new Set(NOTES.map((n) => n.kind))).toEqual(new Set(NOTE_KINDS));
  });

  it("answers an unsupported format the way /tools does, alternative read from the catalogue", () => {
    expect(renderNote(NOTES[0]!)).toBe(
      "No tool here opens HEIC photos. Save a JPG copy first. JPG to PDF takes JPG and PNG.",
    );
  });

  it("names the limit a file is over, and who has it", () => {
    expect(renderNote(NOTES[3]!)).toBe(
      `photo.png is ${formatBytes(31 * MB)}, over the ${formatBytes(
        tool("jpg-to-pdf").ceilingBytes!,
      )} that JPG to PDF and PNG to PDF take.`,
    );
  });

  it("says a renamed file is not what its name says", () => {
    expect(renderNote(NOTES[5]!)).toBe(
      "report.pdf is really a PNG image, so no tool here opens it under its name.",
    );
  });

  it("every rendered note passes the predicates, and prints only its own numbers", () => {
    const found = NOTES.flatMap((n) => {
      const text = renderNote(n);
      // An unsupported answer's words are the catalogue's, checked by
      // tools-explorer.test.tsx where /tools renders them; the numbers rule
      // still applies to the sentence as composed here.
      return offences(text, n).map((o) => `${text} — ${o}`);
    });
    expect(found).toEqual([]);
  });
});

describe("the module holds no figure of its own", () => {
  it("no string literal or template in evidence.ts contains a digit", () => {
    const file = path.join(
      process.cwd(),
      "src",
      "lib",
      "intent",
      "evidence.ts",
    );
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const digits: string[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n)
      ) {
        if (/\d/.test(n.text)) digits.push(n.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // Health: the walk saw the module's strings at all.
    let strings = 0;
    const count = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isTemplateExpression(n)) strings += 1;
      ts.forEachChild(n, count);
    };
    count(sf);
    expect(strings).toBeGreaterThanOrEqual(15);
    expect(digits).toEqual([]);
  });
});
