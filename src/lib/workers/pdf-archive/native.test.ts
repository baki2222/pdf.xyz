import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { GhostscriptRunError } from "./engine";
import {
  createNativeGhostscriptPdfARunner,
  ghostscriptPdfAArgs,
  nativePdfArchiveDeps,
  pdfaDefinition,
  probeGhostscriptFromConfig,
} from "./native";
import {
  DEFAULT_PDFA_ICC_PROFILE,
  type NativePdfArchiveConfig,
} from "./native-config";

const config: NativePdfArchiveConfig = {
  enabled: true,
  binary: "gs",
  overridden: false,
  iccProfile: DEFAULT_PDFA_ICC_PROFILE,
  qpdfBinary: "qpdf",
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
  it("builds fixed PDF/A argv without a shell — the documented recipe", () => {
    // INVERTED, not deleted. Until this change the expected argv here was
    //
    //   -dPDFA=2 -dBATCH -dNOPAUSE -dNOOUTERSAVE -dSAFER -dQUIET
    //   -sProcessColorModel=DeviceRGB -sDEVICE=pdfwrite
    //   -dPDFACompatibilityPolicy=1 -sOutputFile=/out.pdf /in.pdf
    //
    // i.e. this test PINNED the defect: no PDFA_def prefix, so no OutputIntent,
    // and ProcessColorModel instead of ColorConversionStrategy. It went green on
    // every build while the output carried a PDF/A claim validators reject.
    expect(
      ghostscriptPdfAArgs("/in.pdf", "/out.pdf", "/def.ps", "/icc/srgb.icc"),
    ).toEqual([
      "-dPDFA=2",
      "-dBATCH",
      "-dNOPAUSE",
      "-dNOOUTERSAVE",
      "-dSAFER",
      "--permit-file-read=/icc/srgb.icc",
      "-dQUIET",
      "-sColorConversionStrategy=RGB",
      "-sDEVICE=pdfwrite",
      "-dPDFACompatibilityPolicy=1",
      "-sOutputFile=/out.pdf",
      "/def.ps",
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

  it("probes config and returns deps only when Ghostscript AND its ICC profile are available", () => {
    const present = { resolveOnPath: () => true, fileExists: () => true };
    expect(probeGhostscriptFromConfig(config, present)).toBe(true);
    expect(
      nativePdfArchiveDeps({}, { ...present, resolveOnPath: () => false })
        .ghostscript,
    ).toBeUndefined();
    expect(nativePdfArchiveDeps({}, present).ghostscript).toBeDefined();
  });

  it("reports NOT available when the ICC profile is missing, whatever gs says", () => {
    // Ghostscript on PATH is wiring, not the capability: without the profile
    // the OutputIntent cannot be embedded and every output fails the PDF/A
    // gate. `ready: true` there would refuse every job after the user uploaded.
    const seen: string[] = [];
    const fileExists = (p: string) => {
      seen.push(p);
      return p !== DEFAULT_PDFA_ICC_PROFILE;
    };
    expect(
      probeGhostscriptFromConfig(config, {
        resolveOnPath: () => true,
        fileExists,
      }),
    ).toBe(false);
    // Health check: the probe asked about THE profile the argv will permit.
    expect(seen).toContain(config.iccProfile);
    expect(
      nativePdfArchiveDeps({}, { resolveOnPath: () => true, fileExists })
        .ghostscript,
    ).toBeUndefined();
  });
});

describe("the PDF/A prefix the runner hands Ghostscript", () => {
  /** Run one conversion and capture exactly what Ghostscript would receive. */
  async function capture() {
    const fs = fsStub();
    const exec = vi.fn(async (_command: string, _args: readonly string[]) => ({
      code: 0,
      timedOut: false,
    }));
    await createNativeGhostscriptPdfARunner(config, {
      exec,
      fs,
    }).convertToPdfA(PDF, { standard: "PDF/A-2b" });
    const argv = [...exec.mock.calls[0]![1]];
    const written = new Map(
      fs.writeFile.mock.calls.map((call) => {
        const [file, data] = call as unknown as [string, Uint8Array];
        return [file, new TextDecoder().decode(data)] as const;
      }),
    );
    return { argv, written };
  }

  it("runs the prefix it WROTE, immediately before the input", async () => {
    const { argv, written } = await capture();
    const inputPath = argv.at(-1)!;
    const defPath = argv.at(-2)!;
    expect(inputPath).toBe(join("/tmp/pdfxyz-pdfa-1", "input.pdf"));
    // The argument before the input is a file this run wrote, not a path the
    // image is merely assumed to have.
    expect(written.has(defPath)).toBe(true);
    expect(defPath).not.toBe(inputPath);
  });

  it("embeds exactly the ICC path it permits, and permits exactly the configured one", async () => {
    const { argv, written } = await capture();
    const def = written.get(argv.at(-2)!)!;
    const embedded = /\/ICCProfile \((.*)\) def/.exec(def)?.[1];
    const permitted = argv
      .find((a) => a.startsWith("--permit-file-read="))
      ?.slice("--permit-file-read=".length);
    expect(embedded).toBe(config.iccProfile);
    expect(permitted).toBe(config.iccProfile);
  });

  it("declares the PDF/A OutputIntent, and does not overwrite the user's title", async () => {
    const { argv, written } = await capture();
    const def = written.get(argv.at(-2)!)!;
    expect(def).toContain("/S /GTS_PDFA1");
    expect(def).toContain("/DestOutputProfile {icc_PDFA}");
    expect(def).toContain(
      "[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark",
    );
    // The stock PDFA_def.ps sets /Title (Title); run as-is it would rename
    // every user's document "Title".
    expect(def).not.toContain("DOCINFO");
  });

  it("escapes a profile path so it cannot end the PostScript string early", () => {
    expect(pdfaDefinition(String.raw`/a (b)\c.icc`)).toContain(
      String.raw`/ICCProfile (/a \(b\)\\c.icc) def`,
    );
  });

  it("redacts the prefix and profile paths from what the user is shown", async () => {
    const exec = vi.fn(async (_c: string, args: readonly string[]) => ({
      code: 0,
      timedOut: false,
      diagnostics: `could not read ${args.at(-2)} or ${config.iccProfile}`,
    }));
    const out = await createNativeGhostscriptPdfARunner(config, {
      exec,
      fs: fsStub(),
    }).convertToPdfA(PDF, { standard: "PDF/A-2b" });
    expect(out.notes.join(" ")).not.toContain(config.iccProfile);
    expect(out.notes.join(" ")).not.toContain("pdfa-def.ps");
  });
});

describe("why a conversion failed travels as a type, not a sentence", () => {
  type ExecResult = { code: number; timedOut: boolean; spawnError?: string };
  const withQpdf = { resolveOnPath: () => true, fileExists: () => true };

  function runnerWith(
    impl: (command: string) => Promise<ExecResult>,
    fs = fsStub(),
    seams: {
      resolveOnPath?: () => boolean;
      fileExists?: () => boolean;
    } = withQpdf,
  ) {
    const exec = vi.fn(
      async (
        command: string,
        _args: readonly string[],
        _options: unknown,
      ): Promise<ExecResult> => impl(command),
    );
    return {
      exec,
      run: () =>
        createNativeGhostscriptPdfARunner(config, {
          ...seams,
          exec,
          fs,
        }).convertToPdfA(PDF, { standard: "PDF/A-2b" }),
    };
  }

  async function reasonOf(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GhostscriptRunError);
    return (error as GhostscriptRunError).reason;
  }

  const gsFails =
    (qpdfExit: number) =>
    async (command: string): Promise<ExecResult> =>
      command === "qpdf"
        ? { code: qpdfExit, timedOut: false }
        : { code: 1, timedOut: false };

  it("a non-zero exit on an unencrypted file is engine_exit", async () => {
    const { run } = runnerWith(gsFails(2));
    expect(await reasonOf(run())).toBe("engine_exit");
  });

  it("a timeout is timeout: the up-front probe ran, and no second probe follows", async () => {
    // qpdf exit 2: not encrypted. Then Ghostscript times out.
    const { run, exec } = runnerWith(async (cmd) =>
      cmd === "qpdf"
        ? { code: 2, timedOut: false }
        : { code: -1, timedOut: true },
    );
    expect(await reasonOf(run())).toBe("timeout");
    expect(exec.mock.calls.map((call) => call[0])).toEqual(["qpdf", "gs"]);
  });

  it("a process that never started is spawn", async () => {
    const { run } = runnerWith(async () => ({
      code: -1,
      timedOut: false,
      spawnError: "ENOENT",
    }));
    expect(await reasonOf(run())).toBe("spawn");
  });

  it("a temp dir that cannot be created is io", async () => {
    const fs = fsStub();
    fs.mkdtemp.mockRejectedValueOnce(new Error("EMFILE"));
    const { run } = runnerWith(async () => ({ code: 0, timedOut: false }), fs);
    expect(await reasonOf(run())).toBe("io");
  });

  it("exit 0 with no output file is bad_output", async () => {
    const fs = fsStub();
    fs.readFile.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    // qpdf: exit 2, not encrypted — so the missing output is the file's fault.
    const { run } = runnerWith(
      async (cmd) => ({ code: cmd === "qpdf" ? 2 : 0, timedOut: false }),
      fs,
    );
    expect(await reasonOf(run())).toBe("bad_output");
  });

  it("gs fails AND qpdf says an open password is needed: password_required", async () => {
    const { run, exec } = runnerWith(gsFails(0));
    expect(await reasonOf(run())).toBe("password_required");
    expect(exec).toHaveBeenLastCalledWith(
      "qpdf",
      ["--requires-password", join("/tmp/pdfxyz-pdfa-1", "input.pdf")],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("gs exits 0 with nothing usable on an open-password PDF: still password_required", async () => {
    // Whether Ghostscript exits non-zero on a file it cannot open or exits 0
    // having written nothing is its choice; the user's fix is the same.
    const { run } = runnerWith(
      async (cmd) =>
        cmd === "qpdf"
          ? { code: 0, timedOut: false }
          : { code: 0, timedOut: false },
      fsStub(new TextEncoder().encode("")),
    );
    expect(await reasonOf(run())).toBe("password_required");
  });

  it("an owner-password-only PDF (qpdf exit 3: encrypted, openable) is NOT a password problem", async () => {
    // `--is-encrypted` or an /Encrypt check would say "encrypted" here and turn
    // away permission-restricted files Ghostscript converts today.
    const { run } = runnerWith(gsFails(3));
    expect(await reasonOf(run())).toBe("engine_exit");
  });

  it("without qpdf on the worker, a gs failure stays engine_exit and qpdf is never run", async () => {
    const { run, exec } = runnerWith(gsFails(0), fsStub(), {
      resolveOnPath: () => false,
      fileExists: () => true,
    });
    expect(await reasonOf(run())).toBe("engine_exit");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  /*
   * INVERTED 2026-10-08. This was "the happy path never pays for the qpdf
   * probe": it pinned asking about an open password ONLY after Ghostscript had
   * failed. The image proof (`worker:pdfa-proof`, first run in CI that day)
   * locked a PDF with an open password and the conversion came back ok —
   * Ghostscript did not fail, so nothing asked. The probe now runs first.
   */
  it("the probe runs BEFORE Ghostscript: an open-password PDF is refused even if gs would 'succeed'", async () => {
    // qpdf exit 0: needs a password. Ghostscript would exit 0 with a PDF.
    const { run, exec } = runnerWith(async () => ({
      code: 0,
      timedOut: false,
    }));
    expect(await reasonOf(run())).toBe("password_required");
    expect(exec.mock.calls.map((call) => call[0])).toEqual(["qpdf"]);
  });

  it("the happy path pays exactly one probe, and it comes first", async () => {
    const { run, exec } = runnerWith(async (cmd) => ({
      code: cmd === "qpdf" ? 2 : 0,
      timedOut: false,
    }));
    await run();
    expect(exec.mock.calls.map((call) => call[0])).toEqual(["qpdf", "gs"]);
  });

  it("COMPOSED: the real exec seam reports a missing binary as spawn, not as the file's fault", async () => {
    // No stubbed exec: Node's execFile really fails to start a binary that does
    // not exist, and the default seam must say so in a way the runner types as
    // retryable. Real temp dir too, under the OS temp root, removed after.
    const realTmp = await mkdtemp(join(tmpdir(), "pdfxyz-pdfa-test-"));
    try {
      const runner = createNativeGhostscriptPdfARunner(
        {
          ...config,
          binary: "pdfxyz-no-such-ghostscript-binary",
          tmpDir: realTmp,
        },
        { resolveOnPath: () => false },
      );
      expect(
        await reasonOf(runner.convertToPdfA(PDF, { standard: "PDF/A-2b" })),
      ).toBe("spawn");
    } finally {
      await rm(realTmp, { recursive: true, force: true });
    }
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
