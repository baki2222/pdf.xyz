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
 *   - target size (2026-10-31): every rung of the ladder run alone and its
 *     size and image encoders REPORTED (sizes are not monotonic in DPI on
 *     the real engine); then a reachable target must come back met at the
 *     first rung, top down, whose lone run fit, with every sharper rung over
 *     it, in colour, pages verified; and an unreachable one not met after
 *     every rung, at the smallest size any rung made;
 *   - page orientation (2026-11-06, audit #21): a four-page file, mostly
 *     sideways (a /Rotate 90 portrait, two landscape pages of vertical text)
 *     with one upright portrait, through the deep step at the default
 *     resolution. Its /ebook preset sets `/All`, one decision for the whole
 *     document; the same deep step with the flag taken out must turn a page
 *     (positive control: measured, it turned all four); every output page
 *     DISPLAYS as its input page did
 *     (MediaBox turned by /Rotate: gs moves a /Rotate 90 into the page content,
 *     which changes /Rotate and not the page a reader sees, so /Rotate alone
 *     is not the property), the input really has all three shapes (the fixture is
 *     not vacuous), and the file read back is the ENGINE's (smaller, every
 *     page) — the no-worse swap hands back the original, which would pass
 *     blind. Runs only where Ghostscript is installed, like the rest;
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
import {
  DEFAULT_TARGET_DPI,
  runCompression,
  type CompressionDeps,
} from "./compression/engine";
import {
  fixtureVerdict,
  orientationVerdict,
  pageOrientations,
  rotationProofPdf,
} from "./compression/rotation-proof";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import {
  TARGET_DPI_LADDER,
  targetRungs,
  type TargetRung,
} from "./compression/target-ladder";
import { DEFAULT_IMAGE_QUALITY } from "@/lib/pdf/compress-image-quality";
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

/**
 * Each image XObject's encoder in a PDF, as `Filter@Width` — what Ghostscript
 * chose per rung, which is why rung sizes are not monotonic in DPI.
 */
async function imageFilters(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const filter = dict.get(PDFName.of("Filter"));
    const name =
      filter instanceof PDFName
        ? filter.decodeText()
        : filter instanceof PDFArray
          ? filter
              .asArray()
              .map((f) => (f instanceof PDFName ? f.decodeText() : "?"))
              .join(",")
          : "none";
    out.push(`${name}@${String(dict.get(PDFName.of("Width")) ?? "?")}`);
  }
  return out.length > 0 ? out : ["no-image"];
}

export interface OptionsProofDeps {
  compression: CompressionDeps;
  /**
   * The same compression engine with `-dAutoRotatePages` taken out of its argv,
   * so the deep step's /ebook preset decides (`/All`). The rotation check's
   * positive control: it must turn a page of the fixture, or "rotation kept"
   * cannot fail on this Ghostscript. Absent: the control FAILS.
   */
  compressionAutoRotating?: CompressionDeps;
  /**
   * The engine entry the target-size checks call; the real `runCompression`
   * unless a test swaps in a wrong one to show the checks can fail.
   */
  compress?: typeof runCompression;
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

  // ── page orientation (2026-11-06, audit #21) ────────────────────────────
  // The argv test proves `-dAutoRotatePages=/None` is ASKED for; this reads
  // back what the engine did with it (see `./compression/rotation-proof`).
  const rotationInput = await rotationProofPdf();
  const wanted = await pageOrientations(rotationInput);
  const fixture = fixtureVerdict(wanted);
  check(fixture.ok, "rotation fixture", fixture.detail);
  // ADDED the same day, after the first in-image run: with the fixture's
  // first version (three pages) the deep step turned nothing even with its
  // flag deleted, so "rotation kept" passed whatever the argv said. The
  // engine itself must show the check can fail: the same deep step, flag
  // taken out, has to turn a page.
  if (!deps.compressionAutoRotating) {
    check(
      false,
      "rotation control",
      "no compression engine without -dAutoRotatePages is wired, so nothing shows 'rotation kept' can fail",
    );
  } else {
    const control = await runCompression(
      rotationInput,
      { profile: "deep", targetDpi: DEFAULT_TARGET_DPI },
      deps.compressionAutoRotating,
    );
    if (!control.ok) {
      check(false, "rotation control", `${control.kind}: ${control.message}`);
    } else {
      const left = orientationVerdict(
        wanted,
        await pageOrientations(control.output),
      );
      check(
        !left.ok,
        "rotation control",
        left.ok
          ? `the deep step without -dAutoRotatePages turned no page${control.output === rotationInput ? " (the original came back: the no-worse rule)" : ""}, so 'rotation kept' cannot fail on this Ghostscript (or the control's argv still carries the flag): ${left.detail}`
          : `without -dAutoRotatePages the deep step turns the fixture: ${left.detail}`,
      );
    }
  }
  const rotated = await runCompression(
    rotationInput,
    { profile: "deep", targetDpi: DEFAULT_TARGET_DPI },
    deps.compression,
  );
  if (!rotated.ok) {
    check(false, "rotation run", `${rotated.kind}: ${rotated.message}`);
  } else {
    check(
      rotated.output !== rotationInput &&
        rotated.meta.outputBytes < rotated.meta.originalBytes &&
        rotated.meta.pageCheck === "verified" &&
        rotated.meta.pagesOut === wanted.length,
      "rotation engine output",
      `${rotated.meta.originalBytes} -> ${rotated.meta.outputBytes} B, pageCheck ${rotated.meta.pageCheck}, pages out ${rotated.meta.pagesOut}`,
    );
    const verdict = orientationVerdict(
      wanted,
      await pageOrientations(rotated.output),
    );
    check(verdict.ok, "rotation kept", verdict.detail);
  }

  // ── target size (2026-10-31) ────────────────────────────────────────────
  // INVERTED the same day. This section first asserted that each rung's size
  // descends with resolution — the ladder's assumption, not its property —
  // and the real Ghostscript failed it (run 41164786989: 150 DPI 579,622 B
  // over 300 DPI 347,330 B). Now every rung is measured alone and REPORTED
  // (with the encoder Ghostscript chose for each image, the cause), and the
  // checks are the properties a reader relies on, judged against those
  // independent sizes:
  //  - met: the file is at or under the target, every sharper rung the
  //    ladder tried was over it, and the rung chosen is the first one, top
  //    down, whose lone run fit;
  //  - not met: every rung ran and was over the target, and the file is the
  //    smallest the ladder made — the smallest of the lone runs too.
  // 1380 px over 3 in is 460 DPI: above 1.5x the top rung, so every rung
  // downsamples (`noisePhotoPdf`).
  const compress = deps.compress ?? runCompression;
  // Since audit compress-pdf#4 (2026-11-08) a rung is a resolution AND a
  // JPEG level: below 72 DPI the ladder lowers the level at 72. Every rung,
  // JPEG ones included, gets its lone run, and the checks below compare the
  // ladder with those — the same properties, over the longer ladder.
  const rungs = targetRungs(TARGET_DPI_LADDER[0]);
  const key = (r: Pick<TargetRung, "dpi" | "quality">) =>
    `${r.dpi}:${r.quality}`;
  const lone = (r: TargetRung) => ({
    profile: "deep" as const,
    targetDpi: r.dpi,
    ...(r.quality === DEFAULT_IMAGE_QUALITY ? {} : { imageQuality: r.quality }),
  });
  // Each fixture is built once: the noise photo is the one the checks use,
  // and its lone runs are the independent sizes they are judged against.
  const photo = await noisePhotoPdf({ px: 1380, inches: 3, pages: 2 });
  const single = new Map<string, number>();
  const smoothSingle = new Map<string, number>();
  for (const kind of ["noise", "smooth"] as const) {
    const sample =
      kind === "noise"
        ? photo
        : await noisePhotoPdf({ px: 1380, inches: 3, pages: 2, kind });
    const parts: string[] = [];
    for (const rung of rungs) {
      const r = await runCompression(sample, lone(rung), deps.compression);
      if (r.ok && r.meta.target === undefined) {
        (kind === "noise" ? single : smoothSingle).set(
          key(rung),
          r.output.length,
        );
      }
      parts.push(
        r.ok
          ? `${key(rung)} ${r.output.length} B ${(await imageFilters(r.output)).join("+")}`
          : `${key(rung)} ${r.kind}`,
      );
    }
    log(`INFO target rungs, ${kind} photo: ${parts.join(", ")}`);
  }
  const sizes = rungs.map((r) => single.get(key(r)) ?? Number.NaN);
  check(
    sizes.every(Number.isFinite) && new Set(sizes).size > 1,
    "target rungs differ",
    `the resolution changes the file: ${rungs.map((r, i) => `${key(r)} ${sizes[i]} B`).join(", ")}`,
  );
  // The JPEG axis does something on an ordinary photo (audit
  // compress-pdf#4): at the 72 DPI floor, the lowest level makes a smaller
  // file than the preset's own. The smooth photo, because AutoFilter may
  // keep the noise one lossless, where no JPEG level applies (the INFO
  // lines above name the encoder of every rung).
  const floorRungs = rungs.filter((r) => r.dpi === rungs.at(-1)!.dpi);
  const atDefault = smoothSingle.get(key(floorRungs[0]!));
  const atLowest = smoothSingle.get(key(floorRungs.at(-1)!));
  check(
    floorRungs.length > 1 &&
      atDefault !== undefined &&
      atLowest !== undefined &&
      atLowest < atDefault,
    "image quality lowers the file",
    `smooth photo at the floor: ${floorRungs.map((r) => `${key(r)} ${smoothSingle.get(key(r))} B`).join(", ")}`,
  );
  // Met: just over the SECOND-smallest rung. Two rungs fit, and the answer
  // must be the sharper of them — not the smallest file — while the top rung
  // is over the target, so a sharper rung is tried and missed first.
  // Over DISTINCT sizes (review of 4624d037): when AutoFilter keeps the
  // noise photo lossless, its JPEG rungs at the floor tie, and the second-
  // smallest of ALL sizes was the smallest again, so the guard below failed
  // the proof on its own fixture.
  // And "distinct" means more than 1% apart (container run 42431179352, PR
  // #287): on the real engine the lossless noise photo's JPEG rungs at the
  // floor were 7 B bigger than the preset's run (the PostScript the level
  // sends, the image unchanged), so exact distinctness kept that near-tie as
  // the second size and the target fitted the smallest rung again.
  const bySize: number[] = [];
  for (const size of [...new Set(sizes)].sort((a, b) => a - b)) {
    if (bySize.length === 0 || size > bySize.at(-1)! * 1.01) bySize.push(size);
  }
  const metTarget = bySize[1]! + 512;
  const want = rungs.find((r) => (single.get(key(r)) ?? Infinity) <= metTarget);
  const smallest = rungs[sizes.indexOf(bySize[0]!)];
  if (
    !(sizes[0]! > metTarget) ||
    want === undefined ||
    smallest === undefined ||
    key(want) === key(smallest)
  ) {
    check(
      false,
      "target met",
      `fixture: the top rung (${sizes[0]} B) must be over ${metTarget} B, and the sharpest fit (${want && key(want)}) must not be the smallest file (${smallest && key(smallest)})`,
    );
  } else {
    const met = await compress(
      photo,
      { profile: "deep", targetDpi: rungs[0]!.dpi, targetBytes: metTarget },
      deps.compression,
    );
    const t = met.ok ? met.meta.target : undefined;
    const at = t
      ? t.tried.findIndex((a) => a.dpi === t.dpi && a.quality === t.quality)
      : -1;
    const sharperMissed =
      !!t &&
      at >= 0 &&
      t.tried.slice(0, at).every((a) => (a.bytes ?? 0) > metTarget);
    check(
      met.ok &&
        t?.met === true &&
        met.output.length <= metTarget &&
        t.tried[at]?.bytes === met.output.length &&
        sharperMissed &&
        t.dpi === want.dpi &&
        t.quality === want.quality &&
        met.meta.pageCheck === "verified" &&
        (await hasColourImage(met.output)),
      "target met",
      met.ok
        ? `target ${metTarget} B: ${met.output.length} B at ${t?.dpi}:${t?.quality} (first lone fit ${key(want)}) after ${t?.attempts} runs [${t?.tried.map((a) => `${key(a)}:${a.bytes}`).join(" ")}], sharper rungs all over: ${sharperMissed}, pages ${met.meta.pageCheck}`
        : `${met.kind}: ${met.message}`,
    );
  }
  // Not met: under every rung, so nothing fits — the smallest file made.
  const smallestAlone = Math.min(...sizes);
  const missTarget = Math.max(MIN_TARGET_BYTES, smallestAlone - 1024);
  if (!(smallestAlone > missTarget)) {
    check(
      false,
      "target not met",
      `fixture: the smallest rung (${smallestAlone} B) must be over ${MIN_TARGET_BYTES} B`,
    );
  } else {
    const miss = await compress(
      photo,
      { profile: "deep", targetDpi: rungs[0]!.dpi, targetBytes: missTarget },
      deps.compression,
    );
    const t = miss.ok ? miss.meta.target : undefined;
    const triedBytes = t ? t.tried.map((a) => a.bytes ?? Infinity) : [];
    check(
      miss.ok &&
        t?.met === false &&
        t.attempts === rungs.length &&
        triedBytes.every((b) => b > missTarget) &&
        miss.output.length === Math.min(...triedBytes) &&
        Math.abs(miss.output.length - smallestAlone) <= 512,
      "target not met",
      miss.ok
        ? `target ${missTarget} B: ${miss.output.length} B at ${t?.dpi}:${t?.quality} after ${t?.attempts} runs [${t?.tried.map((a) => `${key(a)}:${a.bytes}`).join(" ")}], smallest lone run ${smallestAlone} B, met ${t?.met}`
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
