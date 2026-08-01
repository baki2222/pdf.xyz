// @vitest-environment node
/**
 * Drift guard between what the product OFFERS for OCR and what the worker image
 * can actually recognize.
 *
 * `OCR_LANGUAGES` is a promise: it populates the language menu on the OCR tool
 * page and is the allowlist the job API validates against, so anything in it is
 * a language a user can pick and submit a document for. The recognition itself
 * needs a Tesseract `traineddata` pack, which only exists in the worker image if
 * the Dockerfile installs it — and `--no-install-recommends` means packs are
 * never pulled in implicitly.
 *
 * Those two lists lived in different files with nothing tying them together, and
 * they drifted: the image shipped `eng` alone while the menu offered thirteen
 * languages. Twelve of them failed on production, and the failure told the user
 * "The OCR engine could not process this file" — blaming their document for our
 * missing dependency, then retrying twice more because that error is classified
 * as transient. This test is the tie.
 *
 * It reads the Dockerfile as text rather than probing a built image on purpose:
 * it must fail in CI, before an image that cannot keep the promise is ever built.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OCR_LANGUAGES } from "@/lib/jobs/ocr";

const DOCKERFILE = readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");

/**
 * The Debian package for a Tesseract language code. The code is the traineddata
 * name (`chi_sim`); the package substitutes hyphens for underscores
 * (`tesseract-ocr-chi-sim`), which is the one place the two spellings differ.
 */
function packageFor(code: string): string {
  return `tesseract-ocr-${code.replace(/_/g, "-")}`;
}

/** Every `tesseract-ocr-*` package the Dockerfile installs, excluding the base. */
function installedLanguagePackages(): Set<string> {
  const found = new Set<string>();
  for (const match of DOCKERFILE.matchAll(/tesseract-ocr-[a-z0-9-]+/g)) {
    found.add(match[0]);
  }
  return found;
}

describe("OCR language packs match the languages the product offers", () => {
  it("offers a meaningful number of languages", () => {
    expect(OCR_LANGUAGES.length).toBeGreaterThan(1);
  });

  it("installs a Tesseract pack for every advertised language", () => {
    const installed = installedLanguagePackages();
    const missing = OCR_LANGUAGES.map((l) => l.code)
      .filter((code) => !installed.has(packageFor(code)))
      .map((code) => `${code} (needs ${packageFor(code)})`);
    // A language here but not in the image is a promise the worker cannot keep:
    // Tesseract exits non-zero and the user is told their file is the problem.
    expect(missing).toEqual([]);
  });

  it("advertises every language pack it installs, so none is dead weight", () => {
    const advertised = new Set(OCR_LANGUAGES.map((l) => packageFor(l.code)));
    const orphans = [...installedLanguagePackages()].filter(
      (pkg) => pkg !== "tesseract-ocr-eng" && !advertised.has(pkg),
    );
    // An installed pack nobody can select only makes the image bigger. Either
    // add the language to OCR_LANGUAGES or drop the package.
    expect(orphans).toEqual([]);
  });

  it("keeps English installed — it is the default when a request omits languages", () => {
    expect(installedLanguagePackages().has("tesseract-ocr-eng")).toBe(true);
    expect(OCR_LANGUAGES.some((l) => l.code === "eng")).toBe(true);
  });
});
