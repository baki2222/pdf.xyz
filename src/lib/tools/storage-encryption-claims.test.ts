// @vitest-environment node
/**
 * No sentence a visitor can read may call the worker, the storage, or a file
 * at rest ENCRYPTED. What is encrypted is the CONNECTION, and only that is
 * verified.
 *
 * ── THE DEFECT (found 2026-10-10, the legal-pages sweep, row 11) ────────────
 *
 * Fourteen worker panels said "{tool} runs on an encrypted secure worker";
 * the Protect/Unlock and OCR panels said "files are encrypted in transit and
 * at rest"; fifteen guide sentences said "an encrypted, isolated worker"; the
 * FAQ, the status page, the workspace, the home page's security section and
 * every processor's readiness line said the same in other words. None of it
 * was checked by anything, and the code supports none of it:
 *
 *  - the storage client sets no server-side-encryption header, so whether R2
 *    encrypts an upload at rest is the provider's behaviour, not ours, and it
 *    is recorded nowhere a test can read;
 *  - the worker writes every document into a per-job temp directory on a disk
 *    whose encryption is unknown;
 *  - the queue's append-only file, which holds job options, sits on the web
 *    host's disk, encryption likewise unknown.
 *
 * The one field-level encryption verified in production is the SEALING of
 * Protect/Unlock passwords in the queue (2026-10-09). It covers no file.
 *
 * ── THE SET (house rule 4) ──────────────────────────────────────────────────
 *
 * Not the copy walk (`copyFiles()`): readiness lines a status page shows live
 * in `src/lib/workers`, and the walk does not reach them. The set is every
 * string literal, template chunk and JSX text in every non-test source file
 * under `src`, read by the TypeScript parser — so a comment can never trip it
 * and a sentence can never hide in one. A health check requires the set to
 * contain the copy walk.
 *
 * ── EXIT CONDITION — THE PROPERTY (house rule 2) ────────────────────────────
 *
 * A sentence may call a file encrypted at rest — or the worker, server or
 * storage encrypted — only when EVERY place a file's bytes rest is verified
 * encrypted at rest in production: the object store, the worker's temp disk,
 * the queue's append-only file and its backups. Not when one of them is, and
 * not when a header is added to the code: a header is the mechanism.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { copyFiles } from "./copy-surface";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/**
 * The shapes, each with sentences that SHIPPED and that it must catch (house
 * rule 1, both directions: every shipped sentence is caught, and every
 * pattern catches one).
 */
const STORAGE_ENCRYPTION_CLAIMS: {
  pattern: RegExp;
  shipped: string[];
}[] = [
  {
    pattern: /\bat\s+rest\b/i,
    shipped: [
      "your browser: files are encrypted in transit and at rest, processed in a temporary per-job folder that is erased when the job ends",
      "your browser: files are encrypted in transit and at rest, recognized in a temporary per-job folder",
    ],
  },
  {
    pattern: /\bencrypted,?\s+(?:and\s+)?(?:isolated|auto-delet\w*)\b/i,
    shipped: [
      "Convert a PDF into an editable Word (DOCX) file on an encrypted, isolated worker that deletes the input when the job finishes.",
      "OCR a scanned PDF so its text becomes searchable and selectable — processed on an encrypted, auto-deleting worker, no account needed.",
      "use encrypted, auto-deleting workers, and each tool clearly labels where it runs.",
      "Files uploaded (encrypted, auto-deleted)",
      "use TLS in transit and encrypted, isolated workers.",
    ],
  },
  {
    pattern:
      /\bencrypted\s+(?:secure[- ])?(?:workers?|servers?|storage|buckets?)\b/i,
    shipped: [
      " runs on an encrypted secure worker",
      "Running this uploads your file to the encrypted secure worker, which recognizes text and then deletes the input.",
      "Secure-worker and AI tools upload your file to an encrypted worker,",
      "Your file is uploaded directly to short-lived, encrypted storage over a pre-signed URL.",
      "Files transfer directly between the browser and encrypted storage — never through this app server.",
    ],
  },
  {
    pattern: /\b(?:worker|server|storage)\s+is\s+encrypted\b/i,
    shipped: [
      "The file travels over an encrypted connection, the worker is encrypted and isolated, and it deletes the input when the job finishes.",
    ],
  },
];

/** Sentences about encryption that are TRUE and must never trip the list. */
const SPARED = [
  "Your file uploads over an encrypted connection.",
  "Traffic between your browser and this site is encrypted in transit.",
  "Password-protect a PDF with real AES encryption.",
  "Encrypted upload",
  "Encrypted when it leaves",
  "This PDF is encrypted, so it needs its password to open.",
  "an encrypted PDF that only restricts printing",
];

/** Every non-test `.ts`/`.tsx` under `src`. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)
      ? [full]
      : [];
  });
}

/** The text a reader could be shown: literals, template chunks, JSX text. */
function readableStrings(file: string, text?: string): string[] {
  const source = text ?? readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.map((s) => s.replace(/\s+/g, " ")).filter((s) => /\S/.test(s));
}

function offenders(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files)
    for (const s of readableStrings(file))
      for (const { pattern } of STORAGE_ENCRYPTION_CLAIMS)
        if (pattern.test(s)) found.push(`${rel(file)}: ${s.trim()}`);
  return found;
}

describe("the shapes catch what shipped and spare what is true", () => {
  it("every shipped sentence is caught, and every pattern catches one", () => {
    for (const { pattern, shipped } of STORAGE_ENCRYPTION_CLAIMS) {
      expect(shipped.length, String(pattern)).toBeGreaterThan(0);
      for (const s of shipped)
        expect(
          s,
          `${String(pattern)} misses a sentence it was written from`,
        ).toMatch(pattern);
    }
  });

  it("true sentences about encryption are spared", () => {
    for (const s of SPARED)
      for (const { pattern } of STORAGE_ENCRYPTION_CLAIMS)
        expect(s, `${String(pattern)} trips on honest text`).not.toMatch(
          pattern,
        );
  });
});

describe("no readable string claims encryption at rest", () => {
  const files = sourceFiles();

  it("the set is the whole source tree, and contains the copy walk (health)", () => {
    // Implausibly small means the walk broke.
    expect(files.length).toBeGreaterThan(500);
    const set = new Set(files.map(rel));
    const outside = copyFiles()
      .map(rel)
      .filter((f) => !set.has(f));
    expect(outside).toEqual([]);
  });

  it("positive control: a sentence planted in real copy is found through the same reader", () => {
    // catalog-how.ts since 2026-10-24: the How-it-works steps, this sentence
    // among them, left the client catalogue (catalog.ts) for it.
    const file = path.join(SRC, "lib", "tools", "catalog-how.ts");
    const real = readFileSync(file, "utf8");
    const planted = real.replace(
      "Upload your PDF over an encrypted connection.",
      "Upload your PDF to an encrypted worker.",
    );
    expect(planted).not.toBe(real);
    const hits = readableStrings(file, planted).filter((s) =>
      STORAGE_ENCRYPTION_CLAIMS.some(({ pattern }) => pattern.test(s)),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("no source file says it", () => {
    const found = offenders(files);
    expect(
      found,
      `claims encryption at rest, or of the worker/storage:\n  ${found.join("\n  ")}`,
    ).toEqual([]);
    // Budget, not assertion (2026-10-30): up to 3.3 s on CI's slower 4-vCPU
    // runners in the full unit run (26 logs, 10-24..10-30), against vitest's
    // 5-second default. The work is the same; the runner is not.
    // `src/tests/timeout-headroom.ts` names the next test past half its budget
    // on every CI run.
  }, 30_000);
});
