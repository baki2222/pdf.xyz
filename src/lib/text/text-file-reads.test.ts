// @vitest-environment node
/**
 * No browser module turns a user's file into text with `Blob.text()`.
 *
 * `Blob.text()` is UTF-8 or nothing: every byte that is not valid UTF-8
 * becomes U+FFFD, silently. Text to PDF and Markdown to PDF both read their
 * picked file that way, so a Windows-1252 note arrived as "caf� �q�" and a
 * Notepad "Unicode" save as U+FFFD plus a NUL between every letter — and the
 * PDF was reported as created. `decodeTextFile` is the reader that honours the
 * file's own encoding; this guard keeps it the only one.
 *
 * ── THE CORPUS, DERIVED ─────────────────────────────────────────────────────
 *
 * Every non-test module git would track (`--cached --others`, so a new file is
 * in the set before it is committed) that begins with the `"use client"`
 * directive — i.e. every module that runs where a user's File exists. Not a
 * list of runners: a list cannot see the text tool written next month. The set
 * is bounded below, and the rule must be EXERCISED by it: at least two of
 * these modules call `decodeTextFile`, so "no `.text()`" is not vacuously true
 * over modules that read no files at all.
 *
 * ── WHAT IT CANNOT CATCH ────────────────────────────────────────────────────
 *
 * It is syntactic. A zero-argument `.text()` is flagged whatever the receiver
 * is — a `Response` read in a client module would be flagged too, and the fix
 * there is to read it deliberately (`decodeTextFile(await res.blob())`, or say
 * why UTF-8 is guaranteed). It does not see a File handed to a helper in a
 * module without the directive and read there; on 2026-09-27 no such helper
 * exists.
 */
import { describe, expect, it } from "vitest";
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const ROOT = resolve(__dirname, "..", "..", "..");

function clientModules(): { file: string; source: string }[] {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        /\.(ts|tsx)$/.test(line) && !/\.(test|spec)\.(ts|tsx)$/.test(line),
    );
  const out: { file: string; source: string }[] = [];
  for (const file of listed) {
    let source: string;
    try {
      source = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue; // listed as untracked-then-deleted; nothing to read
    }
    if (isClientModule(file, source)) out.push({ file, source });
  }
  return out;
}

/** The first statement is the `"use client"` directive — read by the parser, not a regex. */
function isClientModule(file: string, source: string): boolean {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const first = sf.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

interface Scan {
  /** Zero-argument `<expr>.text()` calls, as `line: code`. */
  blobText: string[];
  /** Calls to `decodeTextFile(...)`. */
  decodes: number;
}

function scan(file: string, source: string): Scan {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result: Scan = { blobText: [], decodes: 0 };
  const visit = (node: TS.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "text" &&
        node.arguments.length === 0
      ) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        result.blobText.push(`${line}: ${node.getText(sf)}`);
      }
      if (ts.isIdentifier(callee) && callee.text === "decodeTextFile") {
        result.decodes++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}

describe("a user's text file is decoded in its own encoding", () => {
  it("the detector sees the defect it was written for (positive control)", () => {
    // The line both runners shipped, verbatim, inside a client module.
    const before = `"use client";
async function read(file: File) {
  const text = await file.text();
  return text;
}`;
    expect(isClientModule("before.tsx", before)).toBe(true);
    expect(scan("before.tsx", before).blobText).toEqual(["3: file.text()"]);
    // And it reads code, not prose: a comment naming the call is not a call.
    const commented = `"use client";
// Not \`file.text()\`, which is UTF-8 or nothing.
async function read(file: File) {
  return decodeTextFile(file);
}`;
    expect(scan("after.tsx", commented)).toEqual({ blobText: [], decodes: 1 });
    expect(isClientModule("server.ts", `export const x = 1;`)).toBe(false);
  });

  it("no client module reads a Blob with .text()", () => {
    const modules = clientModules();
    // Bound the corpus: 78 client modules on 2026-09-27. A walk that found a
    // handful would pass every assertion below for the wrong reason.
    expect(modules.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    let decoders = 0;
    for (const { file, source } of modules) {
      const found = scan(file, source);
      for (const hit of found.blobText) offenders.push(`${file}:${hit}`);
      if (found.decodes > 0) decoders++;
    }
    expect(
      offenders,
      "Blob.text() decodes as UTF-8 and turns every other byte into U+FFFD, silently. Read a user's file with decodeTextFile() from @/lib/text/decode-text-file",
    ).toEqual([]);
    // The rule is exercised by the code it governs, not vacuously true.
    expect(decoders).toBeGreaterThanOrEqual(2);
    // A parse of every client module: ~0.45 s alone, and it outgrew vitest's
    // 5 s default under a loaded full run once the home desk added its client
    // modules (timed out once on 2026-10-10, 2/2 green alone) — the same class
    // as 2b20baa7 (raster-boundary).
  }, 30_000);
});
