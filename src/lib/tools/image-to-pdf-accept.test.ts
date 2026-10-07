// @vitest-environment node
/**
 * An image tool's "In:" row names exactly the formats its runner takes.
 *
 * The tool page renders `In: {tool.accept.join(", ")}` (and the OG card the
 * same), so `accept` is a claim to the reader about which files go in. Until
 * 2026-10-08 JPG to PDF served "In: JPG, JPEG" and PNG to PDF "In: PNG",
 * while both runners took PNG and JPEG alike: `isImageAllowedForKind` stopped
 * filtering by tool when the decoder began following each file's bytes, and
 * each page's own steps and FAQ said the other format works. The row was the
 * one surface nothing held to the gate.
 *
 * So this holds `accept` to the gate both ways, over every format the
 * catalogue can name (`MIME_BY_FORMAT`): a format is listed exactly when a
 * file of it passes `isImageAllowedForKind` AND the picker offers it
 * (`imagePickerAccept`). The tools are the ones the image-to-pdf runner
 * mounts on, through the page's dispatch, and the check runs for EVERY kind,
 * so it does not depend on which kind `tool-runner.tsx` passes to which slug.
 *
 * Widening `accept` also moved `converterToPdfFor`: a .png matched JPG to PDF
 * first in catalogue order. The last test holds it to each format's own tool.
 */
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import { MIME_BY_FORMAT } from "@/lib/jobs/mime-by-format";
import {
  imagePickerAccept,
  isImageAllowedForKind,
  type ImagePdfKind,
} from "@/lib/pdf/image-to-pdf";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { converterToPdfFor } from "@/lib/uploads/pick-check";

/** Every kind, exhaustively: adding one to the type breaks this line. */
const KINDS = Object.keys({ jpg: true, png: true } satisfies Record<
  ImagePdfKind,
  true
>) as ImagePdfKind[];

const SLUGS = supportedToolSlugs.filter(
  (s) => getRunnerKind(s) === "image-to-pdf",
);
const FORMATS = Object.keys(MIME_BY_FORMAT);

/** Does the runner of `kind` take a file of catalogue format `format`? */
function takes(kind: ImagePdfKind, format: string): boolean {
  const ext = `.${format.toLowerCase()}`;
  const mime = MIME_BY_FORMAT[format]![0]!;
  const picker = imagePickerAccept(kind).split(",");
  return (
    isImageAllowedForKind(kind, { name: `a${ext}`, type: mime }) &&
    picker.includes(ext)
  );
}

/** Where `accept` and the runner disagree, for one tool. */
function disagreements(accept: readonly string[]): string[] {
  return KINDS.flatMap((kind) =>
    FORMATS.filter((f) => takes(kind, f) !== accept.includes(f)).map(
      (f) =>
        `${kind}: ${f} is ${takes(kind, f) ? "taken" : "refused"} but ${accept.includes(f) ? "listed" : "not listed"}`,
    ),
  );
}

describe("an image tool's In row names the formats its runner takes", () => {
  it("finds the image tools and a corpus with both verdicts (health)", () => {
    expect(SLUGS.length).toBeGreaterThanOrEqual(2);
    expect(KINDS.length).toBeGreaterThanOrEqual(2);
    for (const kind of KINDS) {
      expect(FORMATS.filter((f) => takes(kind, f)).length).toBeGreaterThan(2);
      expect(FORMATS.filter((f) => !takes(kind, f)).length).toBeGreaterThan(5);
    }
  });

  it("positive control: the lists that shipped disagree with the runner", () => {
    expect(disagreements(["JPG", "JPEG"])).toContain(
      "jpg: PNG is taken but not listed",
    );
    expect(disagreements(["PNG"])).toContain(
      "png: JPG is taken but not listed",
    );
    // And the other direction: a listed format the runner refuses.
    expect(disagreements(["JPG", "JPEG", "PNG", "PDF"])).toContain(
      "jpg: PDF is refused but listed",
    );
  });

  it.each(SLUGS)("%s lists exactly what its runner takes", (slug) => {
    expect(disagreements(getToolBySlug(slug)!.accept)).toEqual([]);
  });

  it("a file of an image format is sent to the tool named for that format", () => {
    for (const slug of SLUGS) {
      const own = getToolBySlug(slug)!.accept[0]!;
      expect(converterToPdfFor(`a.${own.toLowerCase()}`)?.slug).toBe(slug);
    }
  });
});
