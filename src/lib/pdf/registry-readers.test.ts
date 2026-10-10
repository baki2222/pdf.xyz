// @vitest-environment node
/**
 * Which tools open a PDF whose author restricted editing — derived from the
 * runners themselves, never typed beside them.
 *
 * A restricted PDF (an owner password, no user password) opens in every
 * viewer, and pdf.js reads it; pdf-lib refuses any /Encrypt. So a tool whose
 * runner reads with pdf.js alone takes one, and a tool that rewrites with
 * pdf-lib does not. The suggestion ranking needs that answer for every tool
 * (addendum WP-04 #71: "pdf-to-jpg, pdf-to-png, pdf-to-text and
 * pdf-to-markdown stay eligible ... Block only the pdf-lib writers").
 *
 * The registry states it as `PDFJS_READER_KINDS`; this holds the statement
 * to the code, both ways: a kind is in the set iff the runner the dispatcher
 * mounts for it passes `reader="pdfjs"` — the prop `single-pdf-reader.test.ts`
 * already binds to what each runner does with the bytes.
 *
 * The dispatcher's `case` arms are read by the shared AST reader
 * (`@/tests/tool-panel-modules`), which follows each mounted component
 * through its binding — a static import or a `next/dynamic` loader — to the
 * module that defines it. WAS a regex over `import { X } from "./x";` lines
 * in tool-runner.tsx: on the merge of #175 into WP-04..06 (fb90edbb) every
 * runner had become a loader, the regex found none of the 27, and the file
 * failed before collecting a test ("no import for <MergeRunner>").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runnerArms } from "@/tests/tool-panel-modules";
import {
  getRunnerKind,
  opensRestrictedPdfs,
  PDFJS_READER_KINDS,
  supportedToolSlugs,
  type RunnerKind,
} from "./registry";

/** kind → the runner module the dispatcher mounts for it (absolute path). */
function runnerFiles(): Map<string, string> {
  const out = new Map<string, string>();
  for (const arm of runnerArms())
    for (const kind of arm.keys) out.set(kind, arm.resolved.file);
  return out;
}

const readsWithPdfjs = (file: string) =>
  /\breader="pdfjs"/.test(readFileSync(file, "utf8"));

describe("PDFJS_READER_KINDS is what the runners do", () => {
  const files = runnerFiles();

  it("health: the dispatcher's every case is read, and maps to a file", () => {
    const kinds = new Set(
      supportedToolSlugs.map((slug) => getRunnerKind(slug)!),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(20);
    expect([...kinds].filter((k) => !files.has(k))).toEqual([]);
  });

  it("positive control: PDF to Text's runner reads with pdf.js; Rotate's does not", () => {
    expect(readsWithPdfjs(files.get("pdf-to-text")!)).toBe(true);
    expect(readsWithPdfjs(files.get("rotate")!)).toBe(false);
  });

  it('a kind is listed iff its runner passes reader="pdfjs" (both directions)', () => {
    const derived = [...files]
      .filter(([, file]) => readsWithPdfjs(file))
      .map(([kind]) => kind)
      .sort();
    expect([...PDFJS_READER_KINDS].sort()).toEqual(derived);
  });

  it("opensRestrictedPdfs answers per tool, from the set", () => {
    for (const slug of supportedToolSlugs) {
      expect(opensRestrictedPdfs(slug), slug).toBe(
        PDFJS_READER_KINDS.has(getRunnerKind(slug) as RunnerKind),
      );
    }
    expect(opensRestrictedPdfs("pdf-to-jpg")).toBe(true);
    expect(opensRestrictedPdfs("merge-pdf")).toBe(false);
    // A tool with no in-browser runner is not answered here: false.
    expect(opensRestrictedPdfs("pdf-to-word")).toBe(false);
  });
});
