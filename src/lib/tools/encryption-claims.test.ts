// @vitest-environment node
/**
 * What a tool PAGE says about encrypted PDFs, held to what that tool's runner
 * does with one.
 *
 * Since wave1's encryption work (87316b85, 0cf157bd, c27ec099, 18fffa8d) an
 * encrypted PDF meets one of three things in the browser, decided by the
 * runner the page mounts:
 *
 *  - a pdfjs reader (`reader="pdfjs"`: PDF to JPG/PNG/Text/Markdown) OPENS a
 *    file that only carries its author's restrictions, and refuses only one
 *    that needs a password to open;
 *  - a runner that opts into `classifyLocked` (Compress) offers a restricted
 *    file the secure worker instead of refusing it;
 *  - a runner that opts into `openProtected` (Edit PDF, Fill Forms, since
 *    2026-10-29) OPENS it with the author's restrictions in force — its form
 *    filled under the author's encryption, every tool once the owner
 *    password is entered (`@/lib/pdf/security`);
 *  - every other in-browser loader refuses both, in the words of the probe's
 *    verdict (`@/lib/pdf/encryption`): "password-protected" only for a file
 *    that needs a password, the editing-restrictions sentence for one that
 *    does not.
 *
 * Nine pages still said the pre-wave1 thing — restricted files refused, with
 * a "password-protected" message, quoting a sentence ("This PDF is
 * password-protected. Unlock it first, then try again.") that no longer
 * exists in the tree. Every structural guard was green, because none tied the
 * copy's encryption claims to the reader. This does, over what the page
 * SERVES (`./page-copy`), with each tool's reader DERIVED from the runner the
 * page's own dispatch mounts.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "./catalog";
import type { Tool } from "./types";
import { withoutComments } from "./copy-surface";
import {
  pageDescription,
  pageFaq,
  pageIntro,
  pageSteps,
  pageUseCases,
  stepText,
} from "./page-copy";
import { getRunnerKind } from "@/lib/pdf/registry";
import { ENCRYPTED_PDF_MESSAGES, LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import { runnerModuleOf } from "@/tests/tool-panel-modules";

const RUNNER_DIR = "src/components/tools/runner";
const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

/** registry kind → dispatcher arm → module, as the page mounts it. */
function runnerSource(slug: string): string | null {
  const kind = getRunnerKind(slug);
  if (!kind) return null;
  const dispatch = read(`${RUNNER_DIR}/tool-runner.tsx`);
  const arm = new RegExp(
    `case\\s+"${kind}":[\\s\\S]{0,200}?<([A-Z][A-Za-z]*)`,
  ).exec(dispatch);
  if (!arm) throw new Error(`no dispatcher arm renders kind "${kind}"`);
  // Through the dispatcher's own bindings — a static import, or the
  // `next/dynamic` loader every runner has been since 2026-10-09 — to the
  // module that defines it. Throws when it cannot.
  return withoutComments(read(runnerModuleOf(arm[1]!)));
}

/**
 * What the page's runner does with a file that opens without a password.
 * `opens`: it reads it. `offers-worker`: it offers the secure worker.
 * `refuses`: it refuses it, in the verdict's words. `null`: no in-browser
 * runner (a worker panel), which this does not classify.
 */
type Restricted = "opens" | "opens-protected" | "offers-worker" | "refuses";

function restrictedFileMeets(slug: string): Restricted | null {
  const source = runnerSource(slug);
  if (source === null) return null;
  if (/\breader="pdfjs"/.test(source)) return "opens";
  if (/\bclassifyLocked\s*:\s*true\b/.test(source)) return "offers-worker";
  // A bare JSX flag on its own line: `openProtected` (see `use-single-pdf`).
  if (/^\s*openProtected\s*$/m.test(source)) return "opens-protected";
  return "refuses";
}

/** Every string the page serves, as sentences. */
function servedText(tool: Tool): string[] {
  return [
    pageDescription(tool),
    ...pageIntro(tool),
    ...pageUseCases(tool).flatMap((u) => [u.title, u.body]),
    ...pageSteps(tool).map(stepText),
    ...pageFaq(tool).flatMap((f) => [f.question, f.answer]),
  ];
}

/**
 * Sentences — with a "That includes …" sentence kept with the one before it,
 * since that is how the pages extended a refusal to restricted files ("Loading
 * stops with … . That includes files that open freely …").
 */
function sentences(text: string): string[] {
  // A quotation is one unit: the retired message had two sentences in it.
  const KEEP = "§§";
  const guarded = text.replace(/["“][^"”]*["”]/g, (q) =>
    q.replace(/([.!?]) /g, `$1${KEEP}`),
  );
  const out: string[] = [];
  for (const raw of guarded.split(/(?<=[.!?]["”]?)\s+(?=["“A-Z])/)) {
    const piece = raw.split(KEEP).join(" ");
    if (out.length > 0 && /^(?:That|This|It) (?:also )?includes?\b/.test(piece))
      out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}

/** A file that opens freely and only carries its author's restrictions. */
const RESTRICTED_FILE =
  /\bopens?\b[^.]{0,30}\b(?:freely|without a password|in (?:a|any|every|your) viewer)|\banyone can open\b|\b(?:only )?(?:forbids|restricts?|restricting|blocks?|blocked|locks?|locked)\b[^.]{0,20}\b(?:printing|copying|editing|edits|changes)\b|\bowner[- ]password[- ]only\b/i;
/** Encrypted files in general, not one kind of them. */
const ANY_ENCRYPTED =
  /\b(?:any|all|every)\b[^.]{0,20}\bencrypt\w*|\bencryption of any kind\b|\bencrypted PDFs?\b(?!,? (?:that|which|needing))/i;
/** The file is turned away. */
const REFUSED =
  /\b(?:refus\w*|reject\w*|stop(?:s|ped)?|turned away|turns? (?:it )?away)\b/i;
/** The file is read or converted after all. */
const GETS_THROUGH =
  /\blike any other\b|\bno obstacle\b|\bconverts?\b|\bis (?:read|converted|opened)\b/i;
/** The copy says the user is told "password-protected". */
const SAYS_PASSWORD_PROTECTED =
  /["“]password-protected["”]|password-protected[^.]{0,20}\b(?:message|note|error)\b|\b(?:message|note|error)\b[^.]{0,40}\bpassword-protected\b|This PDF is password-protected/i;

/** The sentences of `text` that make a claim `meets` contradicts. */
function falseClaims(text: string, meets: Restricted): string[] {
  return sentences(text).filter((s) => {
    const restricted = RESTRICTED_FILE.test(s);
    // A writing tool refuses a restricted file too — in the words of the
    // restrictions, not "password-protected" — so it may say neither that it
    // is called password-protected nor that it gets through.
    if (meets === "refuses")
      return (
        restricted && (SAYS_PASSWORD_PROTECTED.test(s) || GETS_THROUGH.test(s))
      );
    // A reader that opens restricted files (pdfjs, or the editors that honour
    // the author's grant): neither they, nor encrypted files as a whole, are
    // refused or called password-protected.
    return (
      (restricted || ANY_ENCRYPTED.test(s)) &&
      (REFUSED.test(s) || SAYS_PASSWORD_PROTECTED.test(s))
    );
  });
}

/** Every sentence the probe's verdicts are told in. */
const REAL_MESSAGES: readonly string[] = [
  ...ENCRYPTED_PDF_MESSAGES,
  ...Object.values(LOCKED_PDF_COPY),
];

/** What the components can render, comments stripped — the other place a quoted message may come from. */
function componentSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return componentSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [withoutComments(readFileSync(full, "utf8"))]
      : [];
  });
}
const COMPONENTS = componentSources(
  path.join(process.cwd(), "src", "components"),
);

/**
 * A quoted message about a lock that nothing says: shaped like the refusal
 * the pages quoted ("This PDF …", or "… first"), and found neither in the
 * verdicts' sentences nor in any component. Read per string, so a quotation
 * is never paired across two answers.
 */
function invented(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]{4,})["”]/g)]
    .map((m) => m[1]!)
    .filter((quote) => /password|encrypt|unlock|restrict|lock/i.test(quote))
    .filter((quote) => /^This PDF\b|\bfirst\b/i.test(quote))
    .filter(
      (quote) =>
        !REAL_MESSAGES.some((m) => m.includes(quote)) &&
        !COMPONENTS.some((c) => c.includes(quote)),
    );
}

const served = tools.map((tool) => ({
  tool,
  meets: restrictedFileMeets(tool.slug),
  text: servedText(tool),
}));

describe("encryption claims on tool pages match the runner's reader", () => {
  it("health check: readers derived for the runners, and the corpus is the size of the catalogue", () => {
    const by = (m: Restricted) =>
      served
        .filter((s) => s.meets === m)
        .map((s) => s.tool.slug)
        .sort();
    // The pdfjs runners (`single-pdf-reader.test.ts` holds that set) mount
    // these four pages; Compress is the one that offers the worker.
    expect(by("opens")).toEqual([
      "pdf-to-jpg",
      "pdf-to-markdown",
      "pdf-to-png",
      "pdf-to-text",
    ]);
    expect(by("offers-worker")).toEqual(["compress-pdf"]);
    // 2026-10-29: the two tools that fill a restricted file's form.
    expect(by("opens-protected")).toEqual(["edit-pdf", "fill-forms"]);
    expect(by("refuses").length).toBeGreaterThan(15);
    // Bounded both ways: a corpus that shrank would pass vacuously.
    expect(served.length).toBe(tools.length);
    const mentions = served.flatMap((s) =>
      s.text.flatMap(sentences).filter((x) => RESTRICTED_FILE.test(x)),
    );
    expect(mentions.length).toBeGreaterThan(8);
    expect(mentions.length).toBeLessThan(400);
  });

  it("POSITIVE CONTROLS: the sentences these pages shipped are caught", () => {
    // pdf-to-text's FAQ before 2026-10-06 — a pdfjs reader.
    expect(
      falseClaims(
        "No. Any encrypted PDF is stopped while loading with a password-protected message, even one that opens freely in a viewer and only forbids copying.",
        "opens",
      ),
    ).toHaveLength(1);
    // compress-pdf's FAQ — the worker is offered.
    expect(
      falseClaims(
        "A password-protected file, even one that opens freely but restricts printing or editing, is refused with a request to unlock it first, and an unreadable file gets an error instead of a download.",
        "offers-worker",
      ),
    ).toHaveLength(1);
    // grayscale-pdf's FAQ — a writing tool, refused in the verdict's words.
    expect(
      falseClaims(
        'No. Any encrypted PDF is turned away as soon as you choose it, with a "password-protected" message, and that includes a file that opens without a password but carries an owner password restricting printing or copying.',
        "refuses",
      ),
    ).toHaveLength(1);
    // pdf-to-jpg's intro: encrypted files as a whole, no restricted marker.
    expect(
      falseClaims(
        "Encrypted PDFs stop at the loading step with a request to unlock them first.",
        "opens",
      ),
    ).toHaveLength(1);
    // rotate-pdf's FAQ: the restriction in the NEXT sentence.
    expect(
      falseClaims(
        'Not while it is encrypted: opening one stops with "This PDF is password-protected. Unlock it first, then try again." That includes a PDF anyone can open but whose author blocked printing or copying.',
        "refuses",
      ),
    ).toHaveLength(1);
    // A pdfjs reader MAY say a file that needs a password is refused.
    expect(
      falseClaims(
        "Only a PDF that needs a password to open is refused, with a message saying it is password-protected.",
        "opens",
      ),
    ).toEqual([]);
    // The other direction: a writing tool's page may not say a restricted
    // file gets through (the pdfjs pages' new sentence, on a pdf-lib tool).
    expect(
      falseClaims(
        "A PDF that opens without a password converts even if its author restricted printing or copying.",
        "refuses",
      ),
    ).toHaveLength(1);
    // A writing tool MAY say a restricted file is refused.
    expect(
      falseClaims(
        "A PDF that opens without a password but restricts editing is refused with a message naming those restrictions.",
        "refuses",
      ),
    ).toEqual([]);
    // The retired quotation is not a sentence any surface says.
    expect(
      invented(
        'Loading stops with "This PDF is password-protected. Unlock it first, then try again."',
      ),
    ).toHaveLength(1);
    expect(invented(`It says "${ENCRYPTED_PDF_MESSAGES[0]}"`)).toEqual([]);
    // header-footer's FAQ: the retired sentence, cut down to its last words.
    expect(
      invented('an encrypted PDF gets "Unlock it first" instead of the editor'),
    ).toEqual(["Unlock it first"]);
    // The component corpus is read, and is what clears a label: Compress
    // renders this link, so quoting it is quoting the product.
    expect(COMPONENTS.length).toBeGreaterThan(50);
    expect(
      invented('it shows "Unlock PDF with its password" under the note'),
    ).toEqual([]);
    expect(
      invented('it shows "Unlock PDF with its password first" under the note'),
    ).toEqual(["Unlock PDF with its password first"]);
  });

  for (const { tool, meets, text } of served) {
    it(`${tool.slug}`, () => {
      expect(
        text.flatMap(invented),
        "quotes a message no surface says",
      ).toEqual([]);
      if (meets === null) return;
      expect(
        text.flatMap((t) => falseClaims(t, meets)),
        `a restricted file ${meets} on ${tool.slug}`,
      ).toEqual([]);
    });
  }
});
