/**
 * `pnpm worker:options-proof` — the worker options added 2026-10-24, run
 * through the REAL engines inside the built worker image: Ghostscript's
 * grayscale (compress-pdf) and qpdf's permission restrictions (protect-pdf).
 *
 * Why it exists: every unit test of these runs where neither binary is
 * installed, so they prove the code ASKS the right question (the argv), never
 * that the binary ANSWERS it. A Ghostscript that ignored
 * `-sColorConversionStrategy=Gray`, or a qpdf that wrote a /P other than the
 * one asked for, would pass all of them. Here the engine runs with the real
 * runner and each output is read back:
 *
 *   - grayscale: every image of the output is one colour component
 *     (`grayscaleVerdict`), the input demonstrably was not (positive control),
 *     and a colour run of the same file still reads as colour (the reader is
 *     not blind to colour);
 *   - target size (2026-10-31): every rung of the ladder run alone, its size
 *     measured, and the sizes must descend (the ladder's one assumption about
 *     the engine); then a target just over the 150 DPI rung must come back
 *     met AT 150 DPI, in colour, pages verified, and a target under the floor
 *     must come back not met after ONE run, at the floor's own size;
 *   - permissions: the output's /P, read without a password
 *     (`readEncryptPermissions`), withholds exactly the switches asked for at
 *     both key lengths; qpdf's OWN `--show-encryption` reports the same /P (a
 *     second, independent reader); and an unrestricted run still grants
 *     everything (default unchanged);
 *   - page layout (2026-10-25, HTML and Webpage to PDF): the image's
 *     Chromium, through `runHtmlToPdf`, prints the proof page A4 landscape
 *     (every page box read back), as ONE page holding its first and last
 *     line, and at a desktop and a phone screen width (the page's own
 *     width-dependent text read back); the default render of the same page
 *     — several Letter pages, laid out narrow — fails each of those verdicts
 *     (the control).
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = an engine is missing from
 * this image. No user document, secret, queue or store is touched; output is
 * content-free (check names, counts and /P integers).
 */
import {
  ALL_PERMISSIONS_ALLOWED,
  permissionMismatches,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import {
  colourImagePdf,
  noisePhotoPdf,
} from "@/lib/workers/compression/colour-image-pdf";
import { runCompression, type CompressionDeps } from "./compression/engine";
import { TARGET_DPI_LADDER, ladderRungs } from "./compression/target-ladder";
import { MIN_TARGET_BYTES } from "@/lib/pdf/compress-target";
import { grayscaleVerdict, hasColourImage } from "./compression/image-colour";
import { runProtect, type PdfSecurityDeps } from "./pdf-security/engine";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import type { PdfKeyLength } from "@/lib/jobs/pdf-security";
import {
  DEFAULT_HTML_RENDER_OPTIONS,
  type HtmlRenderOptions,
} from "@/lib/jobs/html-render-options";
import { runHtmlToPdf, type HtmlRenderDeps } from "./html-render/engine";
import {
  LAYOUT_PROOF_ENDS,
  layoutPdfText,
  layoutProofHtml,
  onePageVerdict,
  pageSizeVerdict,
  pdfPageSizes,
  viewportVerdict,
} from "./html-render/layout-proof";

export interface OptionsProofDeps {
  compression: CompressionDeps;
  pdfSecurity: PdfSecurityDeps;
  /** HTML/Webpage to PDF's renderer — the image's Chromium (2026-10-25). */
  htmlRender: HtmlRenderDeps;
  /**
   * qpdf's own reading of an encrypted file's /P (`--show-encryption`), the
   * independent bound on {@link readEncryptPermissions}. `null` = it printed
   * no `P = …` line.
   */
  qpdfShowP: (
    bytes: Uint8Array,
    ownerPassword: string,
  ) => Promise<number | null>;
  log?: (line: string) => void;
}

/** Proof-only passwords; never a user's. */
const OPEN = "pdfxyz-options-proof-open";
const OWNER = "pdfxyz-options-proof-owner";

const RESTRICTED: PdfPermissions = {
  print: false,
  copy: false,
  modify: false,
  annotate: false,
  fillForms: false,
  accessibility: true,
  assemble: false,
};
const COPY_ONLY: PdfPermissions = { ...ALL_PERMISSIONS_ALLOWED, copy: false };

export async function runWorkerOptionsProof(
  deps: OptionsProofDeps,
): Promise<0 | 1 | 2> {
  const log = deps.log ?? ((line: string) => console.log(line));
  let failed = 0;
  const check = (ok: boolean, name: string, detail: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed += 1;
  };

  if (!deps.compression.tools.ghostscript || !deps.compression.native) {
    log("MISSING Ghostscript: the grayscale proof cannot run in this image.");
    return 2;
  }
  if (!deps.pdfSecurity.qpdf) {
    log("MISSING qpdf: the permissions proof cannot run in this image.");
    return 2;
  }
  if (!deps.htmlRender.chromium) {
    log("MISSING Chromium: the page layout proof cannot run in this image.");
    return 2;
  }

  // ── HTML page layout (2026-10-25) ───────────────────────────────────────
  // Through the engine the processor calls, on the image's Chromium and
  // fonts; each verdict reads the returned PDF's page boxes and text.
  const layoutRun = async (
    name: string,
    options: Partial<HtmlRenderOptions>,
  ): Promise<{ pdf: Uint8Array; text: string } | null> => {
    const run = await runHtmlToPdf(layoutProofHtml(), deps.htmlRender, {
      ...DEFAULT_HTML_RENDER_OPTIONS,
      ...options,
    });
    if (!run.ok) {
      check(false, name, `${run.kind}: ${run.message}`);
      return null;
    }
    return { pdf: run.output, text: await layoutPdfText(run.output) };
  };
  const plainRun = await layoutRun("layout default", {});
  if (plainRun) {
    // CONTROL: without options the page is several Letter pages, narrow —
    // so each verdict below is seen to fail on a render that ignored it.
    const pages = (await pdfPageSizes(plainRun.pdf)).length;
    const letter = await pageSizeVerdict(plainRun.pdf, "Letter", "portrait");
    const notA4 = await pageSizeVerdict(plainRun.pdf, "A4", "landscape");
    const notOne = await onePageVerdict(
      plainRun.pdf,
      plainRun.text,
      LAYOUT_PROOF_ENDS,
    );
    check(
      pages > 1 && letter.ok && !notA4.ok && !notOne.ok,
      "layout control",
      `default: ${letter.detail}; A4 landscape verdict ${notA4.ok ? "PASSED (blind)" : "fails"}; one-page verdict ${notOne.ok ? "PASSED (blind)" : "fails"}`,
    );
    const narrow = viewportVerdict(plainRun.text, "narrow");
    check(narrow.ok, "layout control width", narrow.detail);
  }
  const a4 = await layoutRun("layout A4 landscape", {
    pageSize: "A4",
    orientation: "landscape",
  });
  if (a4) {
    const v = await pageSizeVerdict(a4.pdf, "A4", "landscape");
    check(v.ok, "layout A4 landscape", v.detail);
  }
  const long = await layoutRun("layout one long page", {
    onePage: true,
    pageSize: "A4",
  });
  if (long) {
    const v = await onePageVerdict(long.pdf, long.text, LAYOUT_PROOF_ENDS);
    check(v.ok, "layout one long page", v.detail);
  }
  for (const [viewport, want] of [
    ["desktop", "wide"],
    ["phone", "narrow"],
  ] as const) {
    const r = await layoutRun(`layout ${viewport}`, {
      pageSize: "A4",
      viewport,
    });
    if (r) {
      const v = viewportVerdict(r.text, want);
      check(v.ok, `layout ${viewport} screen`, v.detail);
    }
  }

  // ── grayscale ────────────────────────────────────────────────────────────
  const colour = await colourImagePdf({ components: 3, size: 96, pages: 2 });
  const before = await grayscaleVerdict(colour);
  check(!before.ok, "grayscale positive control", `input: ${before.detail}`);

  const gray = await runCompression(
    colour,
    { profile: "deep", targetDpi: 72, grayscale: true },
    deps.compression,
  );
  if (!gray.ok) {
    check(false, "grayscale run", `${gray.kind}: ${gray.message}`);
  } else {
    const verdict = await grayscaleVerdict(gray.output);
    check(verdict.ok, "grayscale output", verdict.detail);
    check(
      gray.meta.pageCheck === "verified" && gray.meta.pagesOut === 2,
      "grayscale pages",
      `pageCheck ${gray.meta.pageCheck}, pages out ${gray.meta.pagesOut}`,
    );
  }

  const kept = await runCompression(
    colour,
    { profile: "deep", targetDpi: 72 },
    deps.compression,
  );
  check(
    kept.ok && (await hasColourImage(kept.output)),
    "colour control",
    kept.ok
      ? "a run without grayscale still reads as colour"
      : `${kept.kind}: ${kept.message}`,
  );

  // ── target size (2026-10-31) ────────────────────────────────────────────
  // The ladder's one assumption about the engine — a lower resolution never
  // makes a bigger file — measured rung by rung on the real Ghostscript; then
  // both outcomes, each judged by sizes measured independently of the ladder.
  // 1380 px over 3 in is 460 DPI: above 1.5x the top rung, so every rung
  // downsamples (`noisePhotoPdf`).
  const photo = await noisePhotoPdf({ px: 1380, inches: 3, pages: 2 });
  const rungs = ladderRungs(TARGET_DPI_LADDER[0]);
  const single = new Map<number, number>();
  for (const dpi of rungs) {
    const r = await runCompression(
      photo,
      { profile: "deep", targetDpi: dpi },
      deps.compression,
    );
    if (r.ok && r.meta.target === undefined) single.set(dpi, r.output.length);
  }
  const sizes = rungs.map((dpi) => single.get(dpi) ?? Number.NaN);
  const descends =
    sizes.every((s, i) => i === 0 || s <= sizes[i - 1]!) &&
    sizes[sizes.length - 1]! < sizes[0]!;
  check(
    descends,
    "target ladder rungs descend",
    rungs.map((dpi, i) => `${dpi} DPI ${sizes[i]} B`).join(", "),
  );
  const at = (dpi: number) => single.get(dpi) ?? Number.NaN;
  // Met: just over the 150 rung, under the 200 rung — so 150 is the first fit.
  const metTarget = at(150) + 1024;
  if (!(at(200) > metTarget)) {
    check(
      false,
      "target met",
      `fixture: the 200 rung (${at(200)} B) must be over ${metTarget} B`,
    );
  } else {
    const met = await runCompression(
      photo,
      { profile: "deep", targetDpi: 300, targetBytes: metTarget },
      deps.compression,
    );
    check(
      met.ok &&
        met.meta.target?.met === true &&
        met.meta.target.dpi === 150 &&
        met.output.length <= metTarget &&
        met.meta.pageCheck === "verified" &&
        (await hasColourImage(met.output)),
      "target met",
      met.ok
        ? `target ${metTarget} B: ${met.output.length} B at ${met.meta.target?.dpi} DPI after ${met.meta.target?.attempts} runs, pages ${met.meta.pageCheck}, colour kept`
        : `${met.kind}: ${met.message}`,
    );
  }
  // Not met: under the floor, so nothing fits — one run, the smallest file.
  const missTarget = at(72) - 1024;
  if (!(missTarget >= MIN_TARGET_BYTES)) {
    check(
      false,
      "target not met",
      `fixture: the floor (${at(72)} B) must be over ${MIN_TARGET_BYTES + 1024} B`,
    );
  } else {
    const miss = await runCompression(
      photo,
      { profile: "deep", targetDpi: 150, targetBytes: missTarget },
      deps.compression,
    );
    check(
      miss.ok &&
        miss.meta.target?.met === false &&
        miss.meta.target.attempts === 1 &&
        Math.abs(miss.output.length - at(72)) <= 512,
      "target not met",
      miss.ok
        ? `target ${missTarget} B: smallest ${miss.output.length} B (floor alone ${at(72)} B) after ${miss.meta.target?.attempts} run, met ${miss.meta.target?.met}`
        : `${miss.kind}: ${miss.message}`,
    );
  }

  // ── permissions ─────────────────────────────────────────────────────────
  const plain = await colourImagePdf({ components: 1, size: 8 });
  const protectWith = async (
    keyLength: PdfKeyLength,
    permissions: PdfPermissions,
    name: string,
  ) => {
    const restricted = permissionMismatches(-4, permissions).length > 0;
    const run = await runProtect(
      plain,
      {
        password: OPEN,
        ownerPassword: restricted ? OWNER : OPEN,
        keyLength,
        permissions,
      },
      deps.pdfSecurity,
    );
    if (!run.ok) {
      check(false, name, `${run.kind}: ${run.message}`);
      return;
    }
    const ours = readEncryptPermissions(run.output);
    const theirs = await deps.qpdfShowP(run.output, restricted ? OWNER : OPEN);
    check(
      ours !== null && ours === theirs,
      `${name} /P agreement`,
      `our reader ${ours}, qpdf --show-encryption ${theirs}`,
    );
    const wrong =
      ours === null ? ["unreadable"] : permissionMismatches(ours, permissions);
    check(
      wrong.length === 0,
      name,
      wrong.length === 0
        ? `/P ${ours} grants exactly what was asked`
        : `/P ${ours} disagrees on ${wrong.join(", ")}`,
    );
  };

  await protectWith(256, RESTRICTED, "AES-256 restricted");
  await protectWith(128, RESTRICTED, "AES-128 restricted");
  await protectWith(256, COPY_ONLY, "AES-256 copy-only");
  // Default unchanged: no restriction asked, every switch granted.
  await protectWith(256, ALL_PERMISSIONS_ALLOWED, "AES-256 default");

  log(failed === 0 ? "OPTIONS PROOF: PASS" : `OPTIONS PROOF: ${failed} FAILED`);
  return failed === 0 ? 0 : 1;
}
