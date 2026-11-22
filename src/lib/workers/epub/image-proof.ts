/**
 * The EPUB to PDF proof: the fixture books through the REAL engine
 * (`runEpubToPdf`) and the Chromium runner it is given, each PDF read back
 * with pdf.js (`./proof`). Run inside the built worker image by
 * `pnpm worker:epub-proof` (`.github/workflows/container.yml`), and locally,
 * against a real Chromium, by `epub.chromium.test.ts`.
 *
 * What passes:
 *  - the EPUB 3 book: chapters in spine order on their own pages, the PNG
 *    drawn, the stylesheet's heading colour, the nav as the outline, the
 *    chapter script NOT run (`epub3Verdict`);
 *  - the CONTROL: the same verdict FAILS the same book with its spine
 *    reversed — a verdict that passes a wrong book proves nothing;
 *  - the EPUB 2 book: the NCX as the outline (`epub2Verdict`);
 *  - the fixed-layout book: one page per page at its viewport;
 *  - the font-obfuscated book converts, with its one font (bytes that are
 *    no font) left out;
 *  - a real font obfuscated with the IDPF method is restored and EMBEDDED
 *    in the PDF (its PostScript name in the font dictionaries);
 *  - a linear="no" notes file prints after the last chapter, and is counted;
 *  - nothing was fetched from the network, though the book asked for a
 *    remote image (the runner's request and fetch observers);
 *  - and the refusals — DRM, a ZIP bomb, a .docx named .epub, a spine that
 *    escapes the root — each named, each BEFORE Chromium (call count 0).
 *
 * Pure: the runner, the observers and the books are passed in.
 */
import type { ChromiumPackageRunner } from "../html-render/engine";
import { runEpubToPdf, type EpubRun } from "./engine";
import type { EpubRefusal } from "./package";
import {
  EPUB_NOTES_MARK,
  EPUB_REMOTE_IMAGE,
  OFL_FONT_POSTSCRIPT_NAME,
  pdfFontNames,
  epub2Verdict,
  epub3Verdict,
  fixedLayoutVerdict,
  readEpubPdf,
} from "./proof";

type Book = () => Promise<Uint8Array>;

export interface EpubImageProofDeps {
  readonly chromium: ChromiumPackageRunner;
  /** Every URL the renderer asked for, as its `onRequest` seam saw them. */
  readonly requests: () => readonly string[];
  /** How many times the render network was asked to resolve or fetch. */
  readonly fetches: () => number;
  readonly books: {
    readonly epub3: Book;
    readonly epub3Reversed: Book;
    readonly epub2: Book;
    readonly fixedLayout: Book;
    readonly fontObfuscated: Book;
    /** A real font, obfuscated with the IDPF method (epub-to-pdf#4). */
    readonly fontRestored: Book;
    /** A book with a linear="no" notes file (epub-to-pdf#3). */
    readonly nonLinear: Book;
    readonly drm: Book;
    readonly zipBomb: Book;
    readonly docxNamedEpub: Book;
    readonly escapingSpine: Book;
  };
}

export interface EpubImageProofResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export async function runEpubImageProof(
  deps: EpubImageProofDeps,
): Promise<EpubImageProofResult> {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string) => {
    ok = false;
    lines.push(`FAIL  ${line}`);
  };
  const pass = (line: string) => lines.push(`ok    ${line}`);
  const limits = { maxInputBytes: 50 * 1024 * 1024 };
  const convert = (bytes: Uint8Array) =>
    runEpubToPdf(bytes, { chromium: deps.chromium, limits });
  const judged = async (
    label: string,
    run: EpubRun,
    verdict: (r: Awaited<ReturnType<typeof readEpubPdf>>) => string[],
  ): Promise<string[] | null> => {
    if (!run.ok) {
      fail(`${label}: the engine answered ${run.kind}: ${run.message}`);
      return null;
    }
    return verdict(await readEpubPdf(run.output));
  };

  const fetchesBefore = deps.fetches();
  const epub3 = await convert(await deps.books.epub3());
  const p3 = await judged("EPUB 3", epub3, epub3Verdict);
  if (p3)
    if (p3.length) fail(`EPUB 3: ${p3.join("; ")}`);
    else
      pass(
        "EPUB 3: chapters in spine order on their own pages, image drawn, heading colour, nav outline, script not run",
      );

  const reversed = await convert(await deps.books.epub3Reversed());
  const pr = await judged("control (reversed spine)", reversed, epub3Verdict);
  if (pr)
    if (pr.some((p) => /out of spine order/.test(p)))
      pass("control: the same verdict fails the book printed in reverse");
    else
      fail(
        "control: the verdict passed a book printed in reverse — it cannot see order",
      );

  const p2 = await judged(
    "EPUB 2",
    await convert(await deps.books.epub2()),
    epub2Verdict,
  );
  if (p2)
    if (p2.length) fail(`EPUB 2: ${p2.join("; ")}`);
    else pass("EPUB 2: chapters in order, the NCX as the outline");

  const pf = await judged(
    "fixed layout",
    await convert(await deps.books.fixedLayout()),
    fixedLayoutVerdict,
  );
  if (pf)
    if (pf.length) fail(`fixed layout: ${pf.join("; ")}`);
    else pass("fixed layout: one PDF page per page, at its viewport");

  const font = await convert(await deps.books.fontObfuscated());
  const pfo = await judged("font-obfuscated", font, epub3Verdict);
  if (pfo && font.ok)
    if (pfo.length || font.meta.fontsLeftOut !== 1)
      fail(
        `font-obfuscated: ${[...pfo, `fonts left out ${font.meta.fontsLeftOut}`].join("; ")}`,
      );
    else pass("font-obfuscated: converted, its one font left out");

  // Audit epub-to-pdf#4: an obfuscated font restored, and USED — read off
  // the PDF's font dictionaries, not the engine's counters alone.
  const restored = await convert(await deps.books.fontRestored());
  const pr4 = await judged("font restored", restored, epub3Verdict);
  if (pr4 && restored.ok) {
    const names = await pdfFontNames(restored.output);
    const embedded = names.some((n) => n.includes(OFL_FONT_POSTSCRIPT_NAME));
    if (
      pr4.length ||
      !embedded ||
      restored.meta.fontsRestored !== 1 ||
      restored.meta.fontsLeftOut !== 0
    )
      fail(
        `font restored: ${[...pr4, `embedded ${embedded}`, `restored ${restored.meta.fontsRestored}`, `left out ${restored.meta.fontsLeftOut}`].join("; ")}`,
      );
    else
      pass(
        `font restored: the book's font is embedded (${OFL_FONT_POSTSCRIPT_NAME})`,
      );
  }

  // Audit epub-to-pdf#3: a linear="no" section printed after the last chapter.
  const notes = await convert(await deps.books.nonLinear());
  const pr3 = await judged("non-linear notes", notes, (r) => {
    const last = r.pages.length - 1;
    const problems = epub3Verdict(r);
    if (!(r.pages[last] ?? "").includes(EPUB_NOTES_MARK))
      problems.push("the notes are not on the last page");
    if (r.pages.slice(0, last).some((t) => t.includes(EPUB_NOTES_MARK)))
      problems.push("the notes are printed before the last page");
    return problems;
  });
  if (pr3 && notes.ok)
    if (pr3.length || notes.meta.extraSections !== 1)
      fail(
        `non-linear notes: ${[...pr3, `extra sections ${notes.meta.extraSections}`].join("; ")}`,
      );
    else pass("non-linear notes: printed after the last chapter, counted");

  const asked = deps.requests().includes(EPUB_REMOTE_IMAGE);
  const fetched = deps.fetches() - fetchesBefore;
  if (asked && fetched === 0)
    pass(
      "network: the remote image was asked for and refused; nothing fetched",
    );
  else
    fail(
      `network: remote image asked for: ${asked}; network calls: ${fetched}`,
    );

  const refusals: [string, Book, EpubRefusal["kind"]][] = [
    ["DRM", deps.books.drm, "drm"],
    ["ZIP bomb", deps.books.zipBomb, "bomb"],
    [".docx named .epub", deps.books.docxNamedEpub, "not_epub"],
    ["spine escaping the root", deps.books.escapingSpine, "escapes_root"],
  ];
  for (const [label, book, kind] of refusals) {
    let calls = 0;
    const counting: ChromiumPackageRunner = {
      renderPackage: (pkg, run) => {
        calls += 1;
        return deps.chromium.renderPackage(pkg, run);
      },
    };
    const run = await runEpubToPdf(await book(), {
      chromium: counting,
      limits,
    });
    if (run.ok || run.kind !== "refused" || run.refusal.kind !== kind)
      fail(
        `${label}: expected a "${kind}" refusal, got ${run.ok ? "a PDF" : `${run.kind}${run.kind === "refused" ? `/${run.refusal.kind}` : ""}`}`,
      );
    else if (calls !== 0)
      fail(`${label}: refused, but only after Chromium ran (${calls} call)`);
    else pass(`${label}: refused before Chromium — ${run.message}`);
  }
  return { ok, lines };
}
