// @native-canvas
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { getToolBySlug } from "@/lib/tools";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";
import { optimizeLossless } from "./analyze";
import {
  ENCRYPTED_PDF_MESSAGES,
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
  PDF_NEEDS_PASSWORD_MESSAGE,
  PDF_RESTRICTED_MESSAGE,
  RESTRICTED_OPENERS,
  RESTRICTED_OPENERS_SENTENCE,
  UNLOCK_TOOL_HREF,
  UNLOCK_TOOL_NAME,
  probePdfEncryption,
  type PdfjsOpener,
} from "./encryption";
import {
  PdfEncryptedError,
  getPageRotations,
  pdfLoadError,
  UNREADABLE_PDF_MESSAGE,
} from "./engine";
import { extractPdfImages } from "./extract-images";
import { overlayPdf } from "./overlay";

/**
 * An encrypted PDF that OPENS WITHOUT A PASSWORD (only its author's editing
 * restrictions are set) was refused by every in-browser tool with "This PDF is
 * password-protected" and sent to Unlock PDF — which then demanded a password
 * the user never had. The fixtures are real Standard-security-handler files
 * (see `@/tests/encrypted-pdf-fixture`), so each case below runs a file
 * through the same reader a user's file meets.
 *
 * pdf.js's modern build needs `DOMMatrix`, which Node lacks, so the probe is
 * driven here with the legacy build via the loader seam. The same function,
 * with the browser loader, is what the runners call.
 */
const legacyPdfjs = async (): Promise<PdfjsOpener> =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsOpener;
const legacyProbe = (bytes: Uint8Array) =>
  probePdfEncryption(bytes, legacyPdfjs);

async function pdfLibRefusal(bytes: Uint8Array): Promise<unknown> {
  try {
    await PDFDocument.load(bytes);
  } catch (err) {
    return err;
  }
  throw new Error("fixture health: pdf-lib loaded an encrypted fixture");
}

describe("the fixtures are what they claim (health check)", () => {
  it("pdf-lib refuses BOTH — the refusal alone cannot tell them apart", async () => {
    for (const bytes of [ownerOnlyEncryptedPdf(), userPasswordEncryptedPdf()]) {
      const err = await pdfLibRefusal(bytes);
      expect(String((err as Error).message)).toMatch(/encrypt/i);
    }
  });

  it("pdf.js opens the owner-only file with no password and refuses the other", async () => {
    expect(await legacyProbe(ownerOnlyEncryptedPdf())).toBe(
      "opens-without-password",
    );
    expect(await legacyProbe(userPasswordEncryptedPdf())).toBe(
      "needs-password",
    );
  });

  it("an unencrypted PDF opens (positive control), junk is unknown, not a guess", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await legacyProbe(await doc.save())).toBe("opens-without-password");
    expect(
      await legacyProbe(new TextEncoder().encode("PK\u0003\u0004 not a pdf")),
    ).toBeNull();
  });

  it("a probe whose pdf.js cannot load reports null", async () => {
    expect(
      await probePdfEncryption(ownerOnlyEncryptedPdf(), () =>
        Promise.reject(new Error("chunk load failed")),
      ),
    ).toBeNull();
  });
});

describe("the composed chain: pdf-lib refusal → probe → the copy a user reads", () => {
  /*
   * INVERTED 2026-09-28 at the merge of wave1/l06-copy-other, history kept:
   * this required the copy to say "leave the password blank". Unlock refuses
   * an empty password and removes restrictions only with the owner password
   * that set them — the rule the other lane kept (a50c54c) — so the copy names
   * that password instead.
   */
  it("owner-only: says it opens without a password, and names the owner password Unlock needs", async () => {
    const bytes = ownerOnlyEncryptedPdf();
    const err = await pdfLoadError(
      await pdfLibRefusal(bytes),
      bytes,
      legacyProbe,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toBe(PDF_RESTRICTED_MESSAGE);
    expect(err.message).not.toMatch(/password-protected/i);
    expect(err.message).not.toMatch(/blank/i);
    expect(err.message).toMatch(/owner \(permissions\) password/);
  });

  it("user password: keeps the password copy (the old copy was right HERE)", async () => {
    const bytes = userPasswordEncryptedPdf();
    const err = await pdfLoadError(
      await pdfLibRefusal(bytes),
      bytes,
      legacyProbe,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toBe(PDF_NEEDS_PASSWORD_MESSAGE);
  });

  it("a non-encryption failure is still 'couldn't be read', with no probe", async () => {
    let probed = false;
    const err = await pdfLoadError(
      new Error("Failed to parse"),
      new Uint8Array(),
      async () => {
        probed = true;
        return null;
      },
    );
    expect(err).not.toBeInstanceOf(PdfEncryptedError);
    expect(err.message).toBe(UNREADABLE_PDF_MESSAGE);
    expect(probed).toBe(false);
  });
});

describe("every in-browser loader routes an encrypted file through the classifier", () => {
  /**
   * Behavioural: the loaders the runners actually call, fed the owner-only
   * file, with the DEFAULT (browser) probe. Whether that pdf.js can run under
   * Node depends on which globals an earlier import left behind (the legacy
   * build polyfills `DOMMatrix`), so the verdict may be either "opens" or
   * "could not tell" — and BOTH sentences are true of this file. What must
   * never come back is the "password-protected" claim this file retires.
   */
  const entryPoints: [string, (b: Uint8Array) => Promise<unknown>][] = [
    ["engine.getPageRotations (useSinglePdf on file open)", getPageRotations],
    ["analyze.optimizeLossless", optimizeLossless],
    ["extract-images.extractPdfImages", extractPdfImages],
  ];

  it.each(entryPoints)("%s", async (_name, fn) => {
    const err = await fn(ownerOnlyEncryptedPdf()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    expect([PDF_RESTRICTED_MESSAGE, PDF_ENCRYPTED_UNKNOWN_MESSAGE]).toContain(
      (err as Error).message,
    );
    expect((err as Error).message).not.toMatch(/password-protected/i);
  });

  it("overlay: the same verdict, said about the overlay file", async () => {
    const base = await PDFDocument.create();
    base.addPage();
    const err = await overlayPdf(
      await base.save(),
      ownerOnlyEncryptedPdf(),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfEncryptedError);
    const message = (err as Error).message;
    expect(message).toMatch(/^The overlay PDF /);
    expect(message).not.toMatch(/password-protected/i);
    expect(message).toContain(UNLOCK_TOOL_NAME);
  });

  /**
   * Structural, and DISCOVERED: every `PDFDocument.load(` in src/lib/pdf must
   * either read past encryption on purpose (`ignoreEncryption: true`) or send
   * its failure through `pdfLoadError`. A new loader that maps the error by
   * hand is exactly how three copies of the old sentence came to exist.
   */
  const PDF_DIR = path.join(process.cwd(), "src", "lib", "pdf");

  function loadSites(source: string): { line: number; ok: boolean }[] {
    const lines = source.split("\n");
    const sites: { line: number; ok: boolean }[] = [];
    lines.forEach((text, i) => {
      if (!/PDFDocument\.load\(/.test(text)) return;
      const window = lines.slice(i, i + 8).join("\n");
      sites.push({
        line: i + 1,
        ok:
          /ignoreEncryption:\s*true/.test(window) ||
          /pdfLoadError\(/.test(window),
      });
    });
    return sites;
  }

  it("finds the loaders (size floor) and each one is classified", () => {
    const files = readdirSync(PDF_DIR).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    const offenders: string[] = [];
    let count = 0;
    for (const f of files) {
      for (const site of loadSites(
        readFileSync(path.join(PDF_DIR, f), "utf8"),
      )) {
        count++;
        if (!site.ok) offenders.push(`${f}:${site.line}`);
      }
    }
    // engine, analyze, extract-images, page-count at the time of writing.
    expect(count).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  /*
   * The exemption above has a hole, and a surface fell through it: a loader
   * that reads past encryption on purpose and then REPORTS the lock hands its
   * callers pdf-lib's `isEncrypted`, which is true of ANY /Encrypt entry. The
   * Request Signatures panel turned that bit into "This PDF is
   * password-protected" for a file that opens in every viewer — while the
   * loaders, asked of the same bytes, said "restricted". So every module that
   * consumes such a report must ask the probe which lock it is.
   *
   * DISCOVERED both ways: the exposers are the src/lib/pdf modules that read
   * past encryption and mention `isEncrypted`; the consumers are every source
   * file under src that imports one of them and reads `.encrypted`.
   */
  const SRC_DIR = path.join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [full]
        : [];
    });
  }

  /** A consumer of `modules`' lock report that never asks which lock it is. */
  function asksNoProbe(source: string, modules: readonly string[]): boolean {
    const imports = modules.some((m) =>
      new RegExp(`from\\s+["'][^"']*/pdf/${m}["']`).test(source),
    );
    if (!imports || !/\.encrypted\b/.test(source)) return false;
    return !/\b(?:probePdfEncryption|classifyPdfAccess)\(/.test(source);
  }

  it("every consumer of a reported lock asks the probe which lock it is", () => {
    const exposers = readdirSync(PDF_DIR)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => {
        const s = readFileSync(path.join(PDF_DIR, f), "utf8");
        return /ignoreEncryption:\s*true/.test(s) && /\bisEncrypted\b/.test(s);
      })
      .map((f) => f.replace(/\.tsx?$/, ""));
    // page-frame (readPdfFrames) at the time of writing.
    expect(exposers).toContain("page-frame");

    const consumers: string[] = [];
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      const rel = path.relative(SRC_DIR, file).replace(/\\/g, "/");
      if (
        exposers.some((m) =>
          new RegExp(`from\\s+["'][^"']*/pdf/${m}["']`).test(source),
        ) &&
        /\.encrypted\b/.test(source)
      ) {
        consumers.push(rel);
      }
      if (asksNoProbe(source, exposers)) offenders.push(rel);
    }
    // The Request Signatures panel at the time of writing; an empty list
    // would make the check below vacuously true.
    expect(consumers).toContain(
      "components/tools/request-signatures-worker-panel.tsx",
    );
    expect(offenders).toEqual([]);
  });

  it("positive control: the notice that called every lock password-protected is flagged", () => {
    // The shape of the panel before 2026-10-06, reduced.
    const before = [
      'import { readPdfFrames } from "@/lib/pdf/page-frame";',
      "const encrypted = picked.info.encrypted;",
      "{encrypted && <p>This PDF is password-protected.</p>}",
    ].join("\n");
    expect(asksNoProbe(before, ["page-frame"])).toBe(true);
    const after = `${before}\nconst lock = encryptedPdfMessage(await probePdfEncryption(bytes));`;
    expect(asksNoProbe(after, ["page-frame"])).toBe(false);
  });

  it("positive control: a hand-mapped loader is flagged", () => {
    const handMapped = [
      "  try {",
      "    return await PDFDocument.load(bytes);",
      "  } catch (err) {",
      '    throw new PdfEngineError("This PDF is password-protected.");',
      "  }",
    ].join("\n");
    expect(loadSites(handMapped)).toEqual([{ line: 2, ok: false }]);
  });
});

describe("the way out is real", () => {
  it("every encrypted-file message names the tool the link opens, and that tool exists", () => {
    const tool = getToolBySlug(UNLOCK_TOOL_HREF.replace(/^\/tools\//, ""));
    expect(tool?.name).toBe(UNLOCK_TOOL_NAME);
    expect(ENCRYPTED_PDF_MESSAGES.length).toBe(3);
    for (const message of ENCRYPTED_PDF_MESSAGES) {
      expect(message).toContain(UNLOCK_TOOL_NAME);
    }
  });

  it("the tools the restricted message names exist, and are the ones that open a restricted file", () => {
    expect(PDF_RESTRICTED_MESSAGE).toContain(RESTRICTED_OPENERS_SENTENCE);
    const runners = path.join(process.cwd(), "src/components/tools/runner");
    for (const { name, href } of RESTRICTED_OPENERS) {
      const slug = href.replace(/^\/tools\//, "");
      expect(getToolBySlug(slug)?.name).toBe(name);
      expect(RESTRICTED_OPENERS_SENTENCE).toContain(name);
    }
    // The property, not the names: the runners that opt into opening a
    // restricted file are exactly these two (discovered, not listed).
    const openers = readdirSync(runners)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .filter((f) =>
        /^\s*openProtected\s*$/m.test(
          readFileSync(path.join(runners, f), "utf8"),
        ),
      )
      .sort();
    // 2026-10-30: Annotate PDF, which mounts the same editor as Edit PDF,
    // joined them (it refused restricted files until then).
    expect(openers).toEqual([
      "annotate-runner.tsx",
      "edit-runner.tsx",
      "fill-forms-runner.tsx",
    ]);
  });

  /*
   * INVERTED 2026-09-28 at the merge of wave1/l06-copy-other, history kept:
   * this required the Unlock page to offer a blank-password path. There is
   * none — an empty password is refused (parseUnlockPdfOptions) — so the page
   * must not offer one, and must name the owner password the restriction
   * messages send people there with.
   */
  it("the Unlock tool's own description offers no blank-password path, and names the owner password", () => {
    const tool = getToolBySlug("unlock-pdf");
    expect(tool?.description).not.toMatch(/blank/i);
    expect(tool?.description).toMatch(/owner|permissions/i);
  });
});
