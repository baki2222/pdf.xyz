// @vitest-environment node
/**
 * The Repair PDF deployment proof must send DAMAGE and read what was rebuilt.
 *
 * Until 2026-09-27 `scripts/worker-prove-tools.ts` proved repair-pdf with a
 * healthy PDF named `broken.pdf` and `expect: isPdf` — `%PDF-` at byte 0. It
 * exercised qpdf's exit 0 and nothing a damaged file goes through, so a
 * regression on that path (a soundness gate refusing files with no `%%EOF`,
 * warnings lost between the engine and the job record) would have left the
 * proof green.
 *
 * Three layers, because each can be right while the proof is wrong:
 *  1. the fixtures are damaged the way their names say — checked by the
 *     makers themselves, with controls showing the check discriminates;
 *  2. the verdict fails every way a repair can mislead, and passes on the job
 *     record the REAL worker chain writes (not a record typed here);
 *  3. the script's repair-pdf specs USE them — read as source through the
 *     TypeScript parser, since the script runs on import — and the refusal
 *     regexes they carry match the messages the real chain produces.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { DevWorkerStore } from "@/lib/workers/store";
import { createLocalDevQueue } from "@/lib/workers/queue/local-dev";
import { createProcessorRegistry } from "@/lib/workers/processor";
import { createPdfStructureProcessor } from "@/lib/workers/processor/pdf-structure";
import { createLocalDevExecutorStorage } from "@/lib/workers/executor/local-dev-storage";
import { createWorkerExecutor } from "@/lib/workers/executor/executor";
import {
  nativePdfStructureDeps,
  type QpdfStructureExecResult,
} from "@/lib/workers/pdf-structure/native";
import {
  damageProblems,
  recoverablyDamagedPdf,
  repairProofVerdict,
  unrecoverablePdf,
} from "./repair-proof-fixtures";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const SCRIPT = fileURLToPath(
  new URL("../../scripts/worker-prove-tools.ts", import.meta.url),
);

async function healthy(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  return doc.save({ useObjectStreams: false });
}

/** Native qpdf deps whose rewrite answers `main`, probe answers `probe`. */
function qpdfDeps(
  main: QpdfStructureExecResult,
  probe: QpdfStructureExecResult,
  output: Uint8Array,
) {
  return nativePdfStructureDeps(
    {},
    {
      resolveOnPath: () => true,
      exec: async (_c, args) =>
        args[0] === "--requires-password" ? probe : main,
      fs: {
        mkdtemp: async (p) => `${p}dir`,
        writeFile: async () => {},
        readFile: async () => output,
        rm: async () => {},
      },
    },
  );
}

describe("the fixtures are damaged the way their names say", () => {
  it("the recoverable fixture: header, trailer, no startxref, no %%EOF", async () => {
    expect(
      damageProblems(await recoverablyDamagedPdf(), "recoverable"),
    ).toEqual([]);
  });

  it("the unrecoverable fixture: header, and nothing to rebuild from", async () => {
    expect(damageProblems(await unrecoverablePdf(), "unrecoverable")).toEqual(
      [],
    );
  });

  it("POSITIVE CONTROL: the check sees a healthy file, and tells the two apart", async () => {
    expect(damageProblems(await healthy(), "recoverable")).toEqual(
      expect.arrayContaining([
        "%%EOF in the last 2 KiB",
        "a startxref pointer survives",
      ]),
    );
    expect(
      damageProblems(await recoverablyDamagedPdf(), "unrecoverable"),
    ).toContain("a trailer survives — qpdf may recover it");
    expect(damageProblems(await unrecoverablePdf(), "recoverable")).toContain(
      "no trailer — qpdf cannot reconstruct without one",
    );
  });
});

describe("the verdict reads the record the real worker chain writes", () => {
  /** A finished repair job, built by the real executor over the local store. */
  async function completedRepair(main: QpdfStructureExecResult) {
    let clock = 100_000;
    const store = new DevWorkerStore(() => clock);
    const queue = createLocalDevQueue({ store, now: () => clock });
    const output = await healthy();
    const input = await recoverablyDamagedPdf();
    const slot = store.reserveSlot({
      sessionId: "sess_test00000",
      filename: "broken.pdf",
      contentType: "application/pdf",
      declaredBytes: input.byteLength,
    });
    store.putBytes(slot.fileId, input);
    await queue.submit({
      job: {
        jobId: "job_proof00000",
        tool: "repair-pdf",
        capability: "secure-worker",
        status: "queued",
        progress: 0,
        createdAt: new Date(clock).toISOString(),
        updatedAt: new Date(clock).toISOString(),
        expiresAt: new Date(clock + 3_600_000).toISOString(),
        retention: DEFAULT_RETENTION,
      },
      inputs: [slot.fileId],
      options: {},
    });
    await createWorkerExecutor({
      queue,
      storage: createLocalDevExecutorStorage({ store, now: () => clock }),
      registry: createProcessorRegistry({
        pdfStructure: qpdfDeps(main, { code: 2, timedOut: false }, output),
      }),
      leaseMs: 1_000,
    }).runOnce();
    clock += 1;
    // JSON round trip: what the job API serialises, not the object in memory.
    const job = JSON.parse(JSON.stringify(store.getJob("job_proof00000")));
    expect(job.status).toBe("completed");
    return { job, output };
  }

  const RECOVERED = {
    code: 3,
    timedOut: false,
    stderr: "qpdf: file is damaged\nqpdf: reconstructing xref table\n",
  };
  const CLEAN = { code: 0, timedOut: false };

  it("passes a recovery the worker reported as one", async () => {
    const { job, output } = await completedRepair(RECOVERED);
    const verdict = await repairProofVerdict(output, job, "recovered");
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.detail).toMatch(/1 warning|2 warning/);
  });

  it("passes a clean run reported clean", async () => {
    const { job, output } = await completedRepair(CLEAN);
    expect(await repairProofVerdict(output, job, "clean")).toMatchObject({
      ok: true,
    });
  });

  it("FAILS a damaged file the worker reported clean", async () => {
    const { job, output } = await completedRepair(CLEAN);
    expect(await repairProofVerdict(output, job, "recovered")).toMatchObject({
      ok: false,
    });
  });

  it("FAILS a healthy file the worker reported repaired", async () => {
    const { job, output } = await completedRepair(RECOVERED);
    expect(await repairProofVerdict(output, job, "clean")).toMatchObject({
      ok: false,
    });
  });

  it("FAILS a record with no repair block — an older worker cannot pass", async () => {
    const { job, output } = await completedRepair(RECOVERED);
    delete job.results;
    expect(await repairProofVerdict(output, job, "recovered")).toMatchObject({
      ok: false,
    });
  });

  it("FAILS bytes that are not a whole PDF", async () => {
    const { job } = await completedRepair(RECOVERED);
    expect(
      await repairProofVerdict(await unrecoverablePdf(), job, "recovered"),
    ).toMatchObject({ ok: false });
  });
});

// ─────────────────────────── the script's specs ────────────────────────────

interface RepairSpec {
  label: string | undefined;
  makeCalls: Set<string>;
  verify: { callee: string; lastArg: string | undefined } | undefined;
  from: string | undefined;
  failureCode: string | undefined;
  failureMessage: RegExp | undefined;
}

function repairSpecs(source: string): RepairSpec[] {
  const file = ts.createSourceFile(
    "worker-prove-tools.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const prop = (o: TS.ObjectLiteralExpression, name: string) =>
    o.properties.find(
      (p): p is TS.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(file) === name,
    )?.initializer;
  const calls = (node: TS.Node | undefined) => {
    const out = new Set<string>();
    const walk = (n: TS.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression))
        out.add(n.expression.text);
      if (ts.isIdentifier(n) && !ts.isCallExpression(n.parent)) out.add(n.text); // `make: textPdf` passes the maker itself
      ts.forEachChild(n, walk);
    };
    if (node) walk(node);
    return out;
  };
  const specs: RepairSpec[] = [];
  const walk = (n: TS.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const tool = prop(n, "tool");
      if (tool && ts.isStringLiteral(tool) && tool.text === "repair-pdf") {
        const label = prop(n, "label");
        const from = prop(n, "from");
        const verifyNode = prop(n, "verify");
        let verify: RepairSpec["verify"];
        verifyNode?.forEachChild(function find(c): void {
          if (ts.isCallExpression(c) && ts.isIdentifier(c.expression)) {
            const last = c.arguments[c.arguments.length - 1];
            verify = {
              callee: c.expression.text,
              lastArg: last && ts.isStringLiteral(last) ? last.text : undefined,
            };
          } else c.forEachChild(find);
        });
        const failure = prop(n, "expectFailure");
        let failureCode: string | undefined;
        let failureMessage: RegExp | undefined;
        if (failure && ts.isObjectLiteralExpression(failure)) {
          failureCode = prop(failure, "code")?.getText(file);
          const m = prop(failure, "message");
          if (m && ts.isRegularExpressionLiteral(m)) {
            const text = m.text;
            const end = text.lastIndexOf("/");
            failureMessage = new RegExp(
              text.slice(1, end),
              text.slice(end + 1),
            );
          }
        }
        specs.push({
          label: label && ts.isStringLiteral(label) ? label.text : undefined,
          makeCalls: calls(prop(n, "make")),
          verify,
          from: from && ts.isStringLiteral(from) ? from.text : undefined,
          failureCode,
          failureMessage,
        });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(file);
  return specs;
}

/** The refusal message the real chain produces for repair-pdf. */
async function refusalMessage(probe: number): Promise<string> {
  const result = await createPdfStructureProcessor(
    qpdfDeps(
      { code: 2, timedOut: false },
      { code: probe, timedOut: false },
      await healthy(),
    ),
  ).process({
    tool: "repair-pdf",
    options: {},
    inputs: [
      {
        fileId: "f_1234567890",
        filename: "x.pdf",
        contentType: "application/pdf",
        bytes: await recoverablyDamagedPdf(),
      },
    ],
  });
  if (result.ok) throw new Error("expected a refusal");
  return result.error.message;
}

describe("worker-prove-tools.ts proves repair-pdf on damage", () => {
  const specs = repairSpecs(readFileSync(SCRIPT, "utf8"));

  it("HEALTH: the parser finds the repair-pdf specs", () => {
    expect(specs.length).toBeGreaterThanOrEqual(4);
  });

  it("the headline repair-pdf spec sends recoverable damage and reads the recovery", () => {
    const headline = specs.find((s) => s.label === undefined);
    expect(headline?.makeCalls.has("recoverablyDamagedPdf")).toBe(true);
    expect(headline?.verify).toEqual({
      callee: "repairProofVerdict",
      lastArg: "recovered",
    });
  });

  it("a healthy file is proven to come back reported clean", () => {
    expect(
      specs.some(
        (s) =>
          s.verify?.callee === "repairProofVerdict" &&
          s.verify.lastArg === "clean",
      ),
    ).toBe(true);
  });

  it("every repair-pdf spec judges more than the envelope", () => {
    // The original defect, as a rule: `expect: isPdf` alone on repair-pdf.
    const blind = specs.filter((s) => !s.verify && !s.failureCode);
    expect(blind.map((s) => s.label ?? "repair-pdf")).toEqual([]);
  });

  it("the unrecoverable proof expects the code and the message the chain produces", async () => {
    const spec = specs.find((s) => s.makeCalls.has("unrecoverablePdf"));
    expect(spec?.failureCode).toBe("OFFICE_EXPORT_ERROR_CODES.unreadable");
    expect(OFFICE_EXPORT_ERROR_CODES.unreadable).toBe("pdf_unreadable");
    expect(await refusalMessage(2)).toMatch(spec!.failureMessage!);
    // POSITIVE CONTROL: the regex is not so loose it matches the other refusal.
    expect(await refusalMessage(0)).not.toMatch(spec!.failureMessage!);
  });

  it("the encrypted proof expects the code and the message the chain produces", async () => {
    const spec = specs.find((s) => s.from === "encrypted");
    expect(spec?.failureCode).toBe(
      "OFFICE_EXPORT_ERROR_CODES.passwordProtected",
    );
    expect(await refusalMessage(0)).toMatch(spec!.failureMessage!);
    expect(await refusalMessage(2)).not.toMatch(spec!.failureMessage!);
  });
});
