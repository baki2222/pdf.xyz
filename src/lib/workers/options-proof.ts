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
 *   - permissions: the output's /P, read without a password
 *     (`readEncryptPermissions`), withholds exactly the switches asked for at
 *     both key lengths; qpdf's OWN `--show-encryption` reports the same /P (a
 *     second, independent reader); and an unrestricted run still grants
 *     everything (default unchanged).
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
import { colourImagePdf } from "@/lib/workers/compression/colour-image-pdf";
import { runCompression, type CompressionDeps } from "./compression/engine";
import { grayscaleVerdict, hasColourImage } from "./compression/image-colour";
import { runProtect, type PdfSecurityDeps } from "./pdf-security/engine";
import { readEncryptPermissions } from "./pdf-security/permission-bits";
import type { PdfKeyLength } from "@/lib/jobs/pdf-security";

export interface OptionsProofDeps {
  compression: CompressionDeps;
  pdfSecurity: PdfSecurityDeps;
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
