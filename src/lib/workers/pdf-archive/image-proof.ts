/**
 * The PDF/A proof that runs INSIDE the built worker image
 * (`pnpm worker:pdfa-proof`, run by `.github/workflows/container.yml`).
 *
 * Why it exists: every other PDF/A check in this repository runs where
 * Ghostscript is not installed. The argv, the prefix file, and the output gate
 * are each unit-tested against stubs and pdf-lib fixtures — which proves the
 * code asks the right question and says nothing about whether Ghostscript
 * 10.x, under `-dSAFER`, with the image's own ICC profile, actually produces a
 * file that answers it. This does: the real runner, the real engine, the real
 * gate, on a generated document, in the image that ships.
 *
 * It also exercises the password classification for real, because the image
 * has qpdf: an OPEN-password file must come back `password_required`, and a
 * permissions-only file must NOT (it opens without a password; rejecting it
 * would break files that convert today).
 *
 * And page orientation (2026-11-06): the fixture `worker:options-proof` runs
 * through compress-pdf (`../compression/rotation-proof`), here through the PDF/A
 * conversion. Every page must display as it did; the input must really hold
 * the shapes the default heuristic turns; and, as the positive control, the
 * same conversion with `-dAutoRotatePages` taken out of the argv must turn at
 * least one page. Measured on the production image before the flag existed:
 * the production argv turned three of the fixture's four pages. Without the
 * control, a Ghostscript whose default stopped turning pages would pass this
 * blind, as compress-pdf's check did on the fixture's first version.
 *
 * Content-free output: statuses and counts only — no path, no document text.
 */
import { PDFDocument, rgb } from "pdf-lib";
import {
  runPdfToPdfA,
  type PdfArchiveDeps,
  type PdfArchiveRun,
} from "./engine";
import { inspectPdfAMarkers } from "./pdfa-markers";
import {
  fixtureVerdict,
  orientationVerdict,
  pageOrientations,
  rotationProofPdf,
} from "../compression/rotation-proof";

export const PDFA_PROOF_PASS = 0;
export const PDFA_PROOF_FAIL = 1;
/** The engine is not available in this image (no gs, or no ICC profile). */
export const PDFA_PROOF_UNAVAILABLE = 2;

export interface PdfAProofSeams {
  /** The document to convert. Defaults to {@link pdfaProofInput}. */
  input?: Uint8Array;
  /**
   * Encrypt `bytes` with qpdf. `user` empty = permissions-only (opens without a
   * password). Absent → the password checks are reported as not run, and the
   * proof FAILS: in the image qpdf is required, so its absence is a defect.
   */
  encrypt?: (
    bytes: Uint8Array,
    user: string,
    owner: string,
  ) => Promise<Uint8Array>;
  /**
   * The same PDF/A engine with `-dAutoRotatePages` taken out of its argv, so
   * Ghostscript runs its default `/PageByPage`. The rotation check's positive
   * control: it must turn a page of the fixture, or "rotation kept" cannot fail
   * on this Ghostscript. Absent: the control FAILS, like a missing encryptor.
   */
  autoRotating?: PdfArchiveDeps;
  log?: (line: string) => void;
}

/** A failed run as `kind` or `kind/reason`: statuses only. */
function runFailure(run: Exclude<PdfArchiveRun, { ok: true }>): string {
  return `${run.kind}${"reason" in run ? `/${run.reason}` : ""}`;
}

/**
 * The default proof input: device RGB colour — the case an OutputIntent exists
 * for. The in-image script adds a line of NON-embedded standard-font text on
 * top (PDF/A requires every font embedded, so Ghostscript must embed one); it
 * does that in `scripts/`, because text in `src/` must come through the font
 * chooser and this document is not a user-facing drawing.
 */
export async function pdfaProofInput(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([400, 300]).drawRectangle({
    x: 40,
    y: 40,
    width: 320,
    height: 60,
    color: rgb(0.85, 0.2, 0.1),
  });
  return doc.save();
}

export async function runPdfAImageProof(
  deps: PdfArchiveDeps,
  seams: PdfAProofSeams = {},
): Promise<number> {
  const log = seams.log ?? ((line: string) => console.log(line));
  if (!deps.ghostscript) {
    log(
      "UNAVAILABLE: the PDF/A engine is not wired in this image (Ghostscript or its sRGB ICC profile is missing).",
    );
    return PDFA_PROOF_UNAVAILABLE;
  }
  let failed = false;
  const check = (ok: boolean, name: string, detail: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (!ok) failed = true;
  };
  const input = seams.input ?? (await pdfaProofInput());

  const plain = await runPdfToPdfA(input, deps);
  if (!plain.ok) {
    log(
      `FAIL plain document: ${plain.kind}${"reason" in plain ? `/${plain.reason}` : ""}`,
    );
    failed = true;
  } else {
    // The engine already gated on this; asked again here so the proof's verdict
    // does not depend on the engine remembering to.
    const markers = await inspectPdfAMarkers(plain.output);
    if (!markers.ok) {
      log(`FAIL plain document: ${markers.problems.join("; ")}`);
      failed = true;
    } else {
      log(
        `PASS plain document: declares PDF/A-${markers.part}${markers.conformance?.toLowerCase()} with a /GTS_PDFA1 output intent; ${plain.meta.outputBytes} bytes; ${plain.meta.notes.length} engine note(s)`,
      );
    }
  }

  // ── page orientation (2026-11-06) ────────────────────────────────────────
  // The argv test proves `-dAutoRotatePages=/None` is ASKED for; this reads
  // back what Ghostscript did with it. Before the password checks, which
  // return early when no encryptor is wired.
  const rotationInput = await rotationProofPdf();
  const wanted = await pageOrientations(rotationInput);
  const fixture = fixtureVerdict(wanted);
  check(fixture.ok, "rotation fixture", fixture.detail);
  if (!seams.autoRotating) {
    check(
      false,
      "rotation control",
      "no engine without -dAutoRotatePages is wired, so nothing shows 'rotation kept' can fail",
    );
  } else {
    const control = await runPdfToPdfA(rotationInput, seams.autoRotating);
    if (!control.ok) {
      check(false, "rotation control", runFailure(control));
    } else {
      const left = orientationVerdict(
        wanted,
        await pageOrientations(control.output),
      );
      check(
        !left.ok,
        "rotation control",
        left.ok
          ? `the conversion without -dAutoRotatePages turned no page, so 'rotation kept' cannot fail on this Ghostscript (or the control's argv still carries the flag): ${left.detail}`
          : `without -dAutoRotatePages Ghostscript turns the fixture: ${left.detail}`,
      );
    }
  }
  const archived = await runPdfToPdfA(rotationInput, deps);
  if (!archived.ok) {
    check(false, "rotation run", runFailure(archived));
  } else {
    const kept = orientationVerdict(
      wanted,
      await pageOrientations(archived.output),
    );
    check(kept.ok, "rotation kept", kept.detail);
  }

  if (!seams.encrypt) {
    log("FAIL password checks: no encryptor wired (qpdf is required here).");
    return PDFA_PROOF_FAIL;
  }

  const locked = await runPdfToPdfA(
    await seams.encrypt(input, "pdfxyz-proof-open", "pdfxyz-proof-owner"),
    deps,
  );
  if (!locked.ok && locked.kind === "password_required") {
    log("PASS open-password document: refused as password_required");
  } else {
    log(
      `FAIL open-password document: expected password_required, got ${locked.ok ? "ok" : locked.kind}`,
    );
    failed = true;
  }

  const restricted = await runPdfToPdfA(
    await seams.encrypt(input, "", "pdfxyz-proof-owner"),
    deps,
  );
  if (!restricted.ok && restricted.kind === "password_required") {
    log(
      "FAIL permissions-only document: refused as password_required, but it opens without one",
    );
    failed = true;
  } else {
    log(
      `PASS permissions-only document: not treated as password-protected (${restricted.ok ? "converted" : `${restricted.kind}${"reason" in restricted ? `/${restricted.reason}` : ""}`})`,
    );
  }

  return failed ? PDFA_PROOF_FAIL : PDFA_PROOF_PASS;
}
