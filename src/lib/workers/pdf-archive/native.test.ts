import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  createNativeGhostscriptPdfARunner,
  ghostscriptPdfAArgs,
  nativePdfArchiveDeps,
  probeGhostscriptFromConfig,
} from "./native";
import type { NativePdfArchiveConfig } from "./native-config";

const config: NativePdfArchiveConfig = {
  enabled: true,
  binary: "gs",
  overridden: false,
  timeoutMs: 10_000,
  maxInputBytes: 1000,
  maxOutputBytes: 1000,
  tmpDir: "/tmp",
};
const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

function fsStub(output = PDF) {
  return {
    mkdtemp: vi.fn(async () => "/tmp/pdfxyz-pdfa-1"),
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => output),
    rm: vi.fn(async () => {}),
  };
}

describe("Ghostscript PDF/A native runner", () => {
  it("builds fixed PDF/A argv without a shell", () => {
    expect(ghostscriptPdfAArgs("/in.pdf", "/out.pdf")).toEqual([
      "-dPDFA=2",
      "-dBATCH",
      "-dNOPAUSE",
      "-dNOOUTERSAVE",
      "-dSAFER",
      "-dQUIET",
      "-sProcessColorModel=DeviceRGB",
      "-sDEVICE=pdfwrite",
      "-dPDFACompatibilityPolicy=1",
      "-sOutputFile=/out.pdf",
      "/in.pdf",
    ]);
  });

  it("converts in an isolated temp dir and always cleans up", async () => {
    const exec = vi.fn(async () => ({ code: 0, timedOut: false }));
    const fs = fsStub();
    const runner = createNativeGhostscriptPdfARunner(config, { exec, fs });
    const output = await runner.convertToPdfA(PDF, { standard: "PDF/A-2b" });
    expect([...output.bytes]).toEqual([...PDF]);
    expect(output.notes).toEqual([]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      join("/tmp/pdfxyz-pdfa-1", "input.pdf"),
      PDF,
    );
    expect(exec).toHaveBeenCalledWith(
      "gs",
      expect.arrayContaining(["-dPDFA=2"]),
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(fs.rm).toHaveBeenCalledWith("/tmp/pdfxyz-pdfa-1", {
      recursive: true,
      force: true,
    });
  });

  it("fails on non-zero or unusable output", async () => {
    await expect(
      createNativeGhostscriptPdfARunner(config, {
        exec: vi.fn(async () => ({ code: 1, timedOut: false })),
        fs: fsStub(),
      }).convertToPdfA(PDF, { standard: "PDF/A-2b" }),
    ).rejects.toThrow(/failed/i);

    await expect(
      createNativeGhostscriptPdfARunner(config, {
        exec: vi.fn(async () => ({ code: 0, timedOut: false })),
        fs: fsStub(new TextEncoder().encode("nope")),
      }).convertToPdfA(PDF, { standard: "PDF/A-2b" }),
    ).rejects.toThrow(/usable PDF/i);
  });

  it("probes config and returns deps only when Ghostscript is available", () => {
    expect(
      probeGhostscriptFromConfig(config, { resolveOnPath: () => true }),
    ).toBe(true);
    expect(
      nativePdfArchiveDeps({}, { resolveOnPath: () => false }).ghostscript,
    ).toBeUndefined();
    expect(
      nativePdfArchiveDeps({}, { resolveOnPath: () => true }).ghostscript,
    ).toBeDefined();
  });
});

describe("the WHOLE Ghostscript stream, end to end through the runner", () => {
  /**
   * Ghostscript's complete stdout+stderr for a run, as the runner receives it.
   *
   * Provenance: banner/copyright/licence/"Processing pages"/"Page N" are verbatim
   * from a clean production run (gs 10.00.0); the DOCINFO line is verbatim from
   * the transparency-document run with the production argv. The repetition of
   * "Page N" for N > 1 follows gs's documented one-line-per-page behaviour.
   *
   * These tests exist because the first version of this file used ONLY the two
   * DOCINFO lines — a faithful excerpt of the stream, which is not a faithful
   * fixture of it. Against the real thing, the shipped code reported
   * `hadNotes: true` for a conversion that removed nothing.
   */
  const DELETION =
    "Text string detected in DOCINFO cannot be represented in XMP for PDF/A1, discarding DOCINFO";

  /** What gs prints WITH `-dQUIET`: stderr only. */
  function quietStream(deletions: number): string {
    return Array.from({ length: deletions }, () => DELETION).join("\n");
  }

  function wholeStream(pages: number, deletions: number): string {
    return [
      "GPL Ghostscript 10.00.0 (2022-09-21)",
      "Copyright (C) 2022 Artifex Software, Inc. All rights reserved.",
      "This software is supplied under the GNU AGPLv3 and comes with NO WARRANTY:",
      "see the file COPYING for full details.",
      `Processing pages 1 through ${pages}.`,
      ...Array.from({ length: pages }, (_, i) => `Page ${i + 1}`),
      ...Array.from({ length: deletions }, () => DELETION),
    ].join("\n");
  }

  /**
   * An exec that behaves like Ghostscript does: `-dQUIET` suppresses the banner
   * and per-page block on stdout and leaves the warnings on stderr untouched.
   *
   * Measured on the production worker, this exact argv:
   *
   *     flag       stdout    stderr   DOCINFO deletion notices
   *     (none)     7 lines   2 lines  present
   *     -dQUIET    0 lines   2 lines  PRESENT
   *
   * The stub INSPECTS THE ARGV rather than returning a fixed string, so these
   * tests pin the flag's effect through the runner. A stub that ignored the argv
   * would have been testing the sanitizer instead — and the sanitizer is
   * deliberately not the thing that removes this noise.
   */
  function execLikeGhostscript(pages: number, deletions: number) {
    return vi.fn(async (_command: string, args: readonly string[]) => ({
      code: 0,
      timedOut: false,
      diagnostics: args.includes("-dQUIET")
        ? quietStream(deletions)
        : wholeStream(pages, deletions),
    }));
  }

  it("a CLEAN conversion reports NOTHING removed", async () => {
    // Fails against 363f6ab: the banner and page lines survived sanitizing, so a
    // conversion that removed nothing came back with notes — and the panel
    // rendered the AGPL licence under "The converter changed or removed some
    // content." `-dQUIET` is what makes the empty case reachable at all.
    const runner = createNativeGhostscriptPdfARunner(config, {
      exec: execLikeGhostscript(1, 0),
      fs: fsStub(),
    });
    const out = await runner.convertToPdfA(PDF, { standard: "PDF/A-2b" });
    expect(out.notes).toEqual([]);
  });

  it("a 5-page conversion shows the deletion notice, not a count of it", async () => {
    // Fails against 363f6ab: banner (4) + "Processing pages" (1) + five "Page N"
    // lines filled the ten slots, so the only line that mattered was pushed into
    // "N further message(s) not shown." The feature failed hardest on the
    // documents most worth archiving.
    const runner = createNativeGhostscriptPdfARunner(config, {
      exec: execLikeGhostscript(5, 2),
      fs: fsStub(),
    });
    const out = await runner.convertToPdfA(PDF, { standard: "PDF/A-2b" });
    expect(out.notes).toContain(DELETION);
  });

  it("a 20-page conversion shows the deletion notice, not a count of it", async () => {
    const runner = createNativeGhostscriptPdfARunner(config, {
      exec: execLikeGhostscript(20, 2),
      fs: fsStub(),
    });
    const out = await runner.convertToPdfA(PDF, { standard: "PDF/A-2b" });
    expect(out.notes).toContain(DELETION);
    expect(out.notes.join(" ")).not.toMatch(/further message/);
  });
});
