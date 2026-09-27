// @vitest-environment node
/**
 * The tests repair-pdf never had: ones that hand it a DAMAGED file.
 *
 * `repair-pdf` shells out to `qpdf input.pdf output.pdf`, which is genuinely
 * qpdf's recover-and-rewrite mode. But nothing ever reached it. The engine's own
 * preflight ran `looksLikePdf` on the INPUT, and `looksLikePdf` requires `%%EOF`
 * within the last 2 KiB — so a truncated PDF, the commonest damage and the exact
 * file a user brings to a repair tool, was rejected as `invalid_pdf` (422, "The
 * input could not be read as a PDF") and qpdf was never spawned.
 *
 * Every existing test handed it a WELL-FORMED PDF. That is why a tool that
 * refused its entire reason to exist looked healthy for as long as it did.
 *
 * The floor did not go away, it moved: repair now requires a PDF HEADER and
 * nothing else. "Accepts anything" is not the goal; "accepts the damage it
 * exists to repair" is.
 */
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { runOptimizeWeb, runRepair, type QpdfStructureRunner } from "./engine";
import { QpdfRefusedError, type QpdfRefusalReason } from "./errors";
import { isLinearized } from "@/lib/pdf/linearization";
import { linearizedPdf } from "@/tests/linearized-pdf-fixture";

/** A real, well-formed PDF. */
async function healthyPdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: false });
}

/**
 * A real PDF with its tail cut off — no trailer, no xref, no `%%EOF`.
 * This is the file a user brings to a repair tool.
 */
async function damagedPdf(): Promise<Uint8Array> {
  const whole = await healthyPdf(6);
  return whole.slice(0, Math.floor(whole.byteLength * 0.6));
}

/** A qpdf that records what it was handed and returns a healthy PDF. */
function recordingQpdf(warnings: string[] = []): QpdfStructureRunner & {
  seen: Uint8Array[];
} {
  const seen: Uint8Array[] = [];
  return {
    seen,
    async repair(input) {
      seen.push(input);
      return { bytes: await healthyPdf(6), warnings };
    },
    async linearize(input) {
      seen.push(input);
      return { bytes: linearizedPdf(), warnings };
    },
  };
}

describe("repair-pdf accepts the damage it exists to repair", () => {
  it("hands a TRUNCATED pdf to qpdf instead of refusing it at the door", async () => {
    const damaged = await damagedPdf();
    const qpdf = recordingQpdf();

    const run = await runRepair(damaged, { qpdf });

    // The load-bearing assertion: qpdf was actually spawned. Before this change
    // `seen` stayed empty and the run came back `invalid_pdf`.
    expect(qpdf.seen).toHaveLength(1);
    expect(qpdf.seen[0]).toEqual(damaged);
    expect(run.ok).toBe(true);
  });

  it("still refuses bytes that are not a PDF at all", async () => {
    // The floor moved; it did not disappear. Without a header there is no
    // document to recover and qpdf would only burn a subprocess to say so.
    const notAPdf = new Uint8Array(4096).fill(0x41);
    const qpdf = recordingQpdf();

    const run = await runRepair(notAPdf, { qpdf });

    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("invalid_pdf");
    expect(qpdf.seen).toHaveLength(0);
  });

  it("still refuses a file too short to be a document", async () => {
    const qpdf = recordingQpdf();
    const run = await runRepair(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      qpdf,
    });
    expect(run.ok).toBe(false);
    expect(qpdf.seen).toHaveLength(0);
  });

  /**
   * INVERTED 2026-09-27. This asserted only `kind: "invalid_pdf"`, and the
   * docblock it quoted said the user "is pointed at repair". The message was
   * "The input could not be read as a PDF." — no pointer — and nothing read it.
   * A truncated PDF is not "not a PDF": it has a header and lost its tail, which
   * is exactly what Repair PDF accepts. So it is its own kind now, final, and
   * the sentence names the tool that takes it.
   */
  it("optimize-web refuses a TRUNCATED pdf and names Repair PDF, without running qpdf", async () => {
    const damaged = await damagedPdf();
    const qpdf = recordingQpdf();

    const run = await runOptimizeWeb(damaged, { qpdf });

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("damaged");
    expect(run.message).toMatch(/Repair PDF/);
    expect(qpdf.seen).toHaveLength(0);
    // The same bytes are what repair-pdf exists for: it hands them to qpdf.
    const repair = await runRepair(damaged, { qpdf });
    expect(repair.ok).toBe(true);
    expect(qpdf.seen).toHaveLength(1);
  });

  it("optimize-web does NOT send bytes that are not a PDF at all to Repair PDF", async () => {
    // Repair refuses these too (no header, nothing to rebuild), so naming it
    // here would send the user to a second refusal.
    const notAPdf = new Uint8Array(4096).fill(0x41);
    const qpdf = recordingQpdf();
    const optimize = await runOptimizeWeb(notAPdf, { qpdf });
    const repair = await runRepair(notAPdf, { qpdf });
    expect(!optimize.ok && optimize.kind).toBe("invalid_pdf");
    expect(!repair.ok && repair.kind).toBe("invalid_pdf");
    expect(!optimize.ok && optimize.message).not.toMatch(/Repair PDF/);
    expect(qpdf.seen).toHaveLength(0);
  });

  it("still validates the OUTPUT strictly — a repair that produces rubble fails", async () => {
    const damaged = await damagedPdf();
    const qpdf: QpdfStructureRunner = {
      async repair() {
        return { bytes: new Uint8Array(64).fill(0x41), warnings: [] };
      },
      async linearize() {
        return { bytes: new Uint8Array(64).fill(0x41), warnings: [] };
      },
    };
    const run = await runRepair(damaged, { qpdf });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });
});

describe("what qpdf recovered is reported, not discarded", () => {
  it("carries the warnings onto the result meta", async () => {
    const damaged = await damagedPdf();
    const qpdf = recordingQpdf([
      "file is damaged",
      "attempting to reconstruct cross-reference table",
    ]);

    const run = await runRepair(damaged, { qpdf });

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.warnings).toEqual([
      "file is damaged",
      "attempting to reconstruct cross-reference table",
    ]);
    // A user who handed us a damaged file is entitled to know it WAS damaged,
    // not merely that a file came back.
    expect(run.meta.recoveredWithWarnings).toBe(true);
  });

  it("reports a clean run as clean rather than as unknown", async () => {
    const qpdf = recordingQpdf();
    const run = await runRepair(await healthyPdf(), { qpdf });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.warnings).toEqual([]);
    expect(run.meta.recoveredWithWarnings).toBe(false);
  });

  it("never lets a temp path reach the result", async () => {
    // qpdf names the file it is complaining about, and that name is OUR temp
    // path. The sanitizer is in native.ts; this pins the engine's own promise
    // that whatever arrives here is what ships.
    const qpdf = recordingQpdf(["input.pdf: file is damaged"]);
    const run = await runRepair(await damagedPdf(), { qpdf });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.warnings.join(" ")).not.toMatch(/[/\\]/);
  });
});

/**
 * A refusal the runner has classified must reach the engine's result AS that
 * class. The engine's `catch {}` used to turn every throw into `failed` — the
 * one kind the processor retries — so classifying in the runner alone would
 * have changed nothing a user sees.
 */
describe("a document qpdf refuses is named, not retried", () => {
  function refusing(reason: QpdfRefusalReason): QpdfStructureRunner {
    return {
      async repair() {
        throw new QpdfRefusedError(reason);
      },
      async linearize() {
        throw new QpdfRefusedError(reason);
      },
    };
  }

  const operations = [
    ["repair", runRepair],
    ["optimize-web", runOptimizeWeb],
  ] as const;

  for (const [name, run] of operations) {
    it(`${name}: a password-protected PDF is sent to Unlock PDF`, async () => {
      const result = await run(await healthyPdf(), {
        qpdf: refusing("password_protected"),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("password_protected");
      expect(result.message).toMatch(/password-protected/);
      expect(result.message).toMatch(/Unlock PDF/);
    });

    it(`${name}: an unrecoverable file is named unreadable, without naming qpdf`, async () => {
      const result = await run(await healthyPdf(), {
        qpdf: refusing("unrecoverable"),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe("unreadable");
      expect(result.message).not.toMatch(/qpdf|Unlock/i);
    });

    it(`${name}: POSITIVE CONTROL — any other throw is still "failed"`, async () => {
      const result = await run(await healthyPdf(), {
        qpdf: {
          async repair() {
            throw new Error("qpdf timed out.");
          },
          async linearize() {
            throw new Error("qpdf timed out.");
          },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("failed");
    });
  }

  it("optimize-web points a damaged file at Repair PDF; repair does not point at itself", async () => {
    const optimize = await runOptimizeWeb(await healthyPdf(), {
      qpdf: refusing("unrecoverable"),
    });
    const repair = await runRepair(await healthyPdf(), {
      qpdf: refusing("unrecoverable"),
    });
    expect(!optimize.ok && optimize.message).toMatch(/Repair PDF/);
    expect(!repair.ok && repair.message).not.toMatch(/Repair PDF/);
  });
});

/**
 * Optimize for Web promises ONE property — a linearized file — and until
 * 2026-09-27 no output was ever checked for it: any `%PDF-…%%EOF` qpdf wrote
 * went to the user as "Your web-optimized PDF is ready." A worker running the
 * rewrite without `--linearize` would have been green everywhere.
 */
describe("optimize-web delivers only a file that IS linearized", () => {
  const returning = (bytes: Uint8Array): QpdfStructureRunner => ({
    async repair() {
      return { bytes, warnings: [] };
    },
    async linearize() {
      return { bytes, warnings: [] };
    },
  });

  it("HEALTH: the two outputs differ in exactly the property under test", async () => {
    expect(isLinearized(linearizedPdf())).toBe(true);
    expect(isLinearized(await healthyPdf())).toBe(false);
  });

  it("POSITIVE CONTROL: a linearized output is delivered", async () => {
    const out = linearizedPdf();
    const run = await runOptimizeWeb(await healthyPdf(), {
      qpdf: returning(out),
    });
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.output).toBe(out);
  });

  it("a well-formed but UNlinearized output is not delivered", async () => {
    const run = await runOptimizeWeb(await healthyPdf(), {
      qpdf: returning(await healthyPdf(2)),
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("failed");
  });

  it("SCOPE: repair makes no linearization promise and is not held to one", async () => {
    const run = await runRepair(await healthyPdf(), {
      qpdf: returning(await healthyPdf(2)),
    });
    expect(run.ok).toBe(true);
  });
});

/**
 * qpdf exits 3 on a linearize too, and then its output is a RECONSTRUCTION.
 * The meta carries that for both operations; the processor used to drop it for
 * optimize-web (see processor/pdf-structure.test.ts).
 */
describe("optimize-web keeps what qpdf said about the file", () => {
  it("carries warnings from a linearize run onto the meta", async () => {
    const run = await runOptimizeWeb(await healthyPdf(), {
      qpdf: recordingQpdf(["xref table reconstructed"]),
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.meta.recoveredWithWarnings).toBe(true);
    expect(run.meta.warnings).toEqual(["xref table reconstructed"]);
  });
});

/** Silence the unused-import lint if pdf-lib tree-shakes oddly under vitest. */
void vi;
