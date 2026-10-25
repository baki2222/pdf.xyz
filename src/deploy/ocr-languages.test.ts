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
 * What the text cannot see — that the Debian package really carries the
 * traineddata Tesseract loads under that code — is asked of the BUILT image by
 * `pnpm worker:ocr-languages-proof` (`tesseract --list-langs` against this same
 * list; wired in `container.yml`, held by `worker-ocr-languages-proof.test.ts`).
 *
 * 2026-10-25: the packs are read from the worker stage's `apt-get install`
 * arguments, not from every `tesseract-ocr-*` token in the file. The first
 * spelling matched comments too, so a pack named only in a comment counted as
 * installed — a set widened by prose (CLAUDE.md rule 4).
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

/** The package tokens the `worker` stage passes to `apt-get install`. */
function workerAptPackages(dockerfile: string): string[] {
  const logical = dockerfile
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\\\r?\n/g, " ")
    .split("\n");
  const out: string[] = [];
  let inWorker = false;
  for (const line of logical) {
    const from = /^\s*FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      inWorker = from[1] === "worker";
      continue;
    }
    if (!inWorker || !/^\s*RUN\b/.test(line)) continue;
    for (const cmd of line.replace(/^\s*RUN\s+/, "").split(/&&|;/)) {
      const m = /\bapt-get\s+install\b(.*)$/.exec(cmd);
      if (!m) continue;
      out.push(
        ...m[1]!
          .trim()
          .split(/\s+/)
          .filter((t) => t && !t.startsWith("-")),
      );
    }
  }
  return out;
}

/** Every `tesseract-ocr-*` language package the worker stage installs. */
function installedLanguagePackages(dockerfile = DOCKERFILE): Set<string> {
  return new Set(
    workerAptPackages(dockerfile).filter((p) => p.startsWith("tesseract-ocr-")),
  );
}

/** Advertised languages whose pack the given Dockerfile does not install. */
function missingPacks(dockerfile: string): string[] {
  const installed = installedLanguagePackages(dockerfile);
  return OCR_LANGUAGES.map((l) => l.code)
    .filter((code) => !installed.has(packageFor(code)))
    .map((code) => `${code} (needs ${packageFor(code)})`);
}

/**
 * The languages asked for on 2026-10-25 (the most-used scripts iLovePDF reads
 * that pdf.xyz did not), as Tesseract codes. A corpus, not a copy of
 * `OCR_LANGUAGES`: each one must be offered, so dropping one from the list —
 * or from the image, through the test above — is a named failure.
 */
const REQUESTED_2026_10_25 = [
  "hin",
  "ara",
  "rus",
  "ukr",
  "jpn",
  "chi_sim",
  "chi_tra",
  "kor",
  "tur",
  "vie",
  "tha",
  "ind",
  "pol",
  "nld",
  "ell",
  "heb",
  "fas",
  "urd",
  "tam",
  "tel",
  "mar",
  "guj",
  "pan",
  "nep",
  "msa",
  "fil",
  "swa",
];

/**
 * Requested languages taken back out, each with the evidence. `pan`: in the
 * built image (container run 40154227317) OCR PDF failed on the Punjabi
 * sample — "The OCR engine could not process this file" — while every other
 * Indic pack read its sample back word for word.
 */
const WITHDRAWN_2026_10_25: Record<string, string> = {
  pan: "the OCR engine failed on it in the built image",
};

describe("OCR language packs match the languages the product offers", () => {
  it("HEALTH: the parse reads the worker stage's whole install list", () => {
    const all = workerAptPackages(DOCKERFILE);
    expect(all).toContain("tesseract-ocr");
    expect(all).toContain("ocrmypdf");
    // Bounded on both sides: a parse that lost the continuation lines reads
    // a handful of packages, one that read the whole file reads comments.
    expect(installedLanguagePackages().size).toBeGreaterThanOrEqual(34);
    expect(installedLanguagePackages().size).toBeLessThan(130);
  });

  it("offers a meaningful number of languages", () => {
    expect(OCR_LANGUAGES.length).toBeGreaterThanOrEqual(34);
  });

  it("offers every language requested on 2026-10-25, except the ones the image proof withdrew", () => {
    const offered = new Set<string>(OCR_LANGUAGES.map((l) => l.code));
    expect(
      REQUESTED_2026_10_25.filter(
        (c) => !offered.has(c) && !(c in WITHDRAWN_2026_10_25),
      ),
    ).toEqual([]);
    // A withdrawn language is really withdrawn — menu AND image — so
    // re-adding it is a change to this record, not a silent drift.
    for (const code of Object.keys(WITHDRAWN_2026_10_25)) {
      expect(offered.has(code), code).toBe(false);
      expect(installedLanguagePackages().has(packageFor(code)), code).toBe(
        false,
      );
    }
  });

  it("installs a Tesseract pack for every advertised language", () => {
    // A language here but not in the image is a promise the worker cannot keep:
    // Tesseract exits non-zero and the user is told their file is the problem.
    expect(missingPacks(DOCKERFILE)).toEqual([]);
  });

  it("POSITIVE CONTROL: a pack removed from the install line, or left only in a comment, is caught", () => {
    const line = "      tesseract-ocr-tam \\\n";
    expect(DOCKERFILE).toContain(line);
    const removed = DOCKERFILE.replace(line, "");
    expect(missingPacks(removed)).toEqual(["tam (needs tesseract-ocr-tam)"]);
    const commented = DOCKERFILE.replace(line, "#     tesseract-ocr-tam \\\n");
    expect(missingPacks(commented)).toEqual(["tam (needs tesseract-ocr-tam)"]);
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
