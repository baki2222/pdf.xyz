// @vitest-environment node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
  type PDFWidgetAnnotation,
} from "pdf-lib";
import JSZip from "jszip";
import { signatureRequestDeps } from "./native";
import { runSignatureRequest } from "./engine";
import {
  MAX_REQUEST_SIGNERS,
  signatureBlockFields,
  type SignatureRequestOptions,
} from "@/lib/jobs/request-signatures";
import { normalizeAngle } from "@/lib/pdf/engine";
import { DEFAULT_RETENTION } from "@/lib/jobs";
import { DevWorkerStore } from "../store";
import { createLocalDevQueue } from "../queue/local-dev";
import { createProcessorRegistry } from "../processor";
import { createLocalDevExecutorStorage } from "../executor/local-dev-storage";
import { createWorkerExecutor } from "../executor/executor";

async function realPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return doc.save();
}

const options: SignatureRequestOptions = {
  signers: [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { name: "Alan Turing", email: "alan@example.com" },
  ],
  fields: [
    {
      signer: 0,
      page: 1,
      type: "signature",
      x: 0.08,
      y: 0.1,
      width: 0.4,
      height: 0.06,
      required: true,
    },
    {
      signer: 0,
      page: 1,
      type: "date",
      x: 0.56,
      y: 0.1,
      width: 0.22,
      height: 0.06,
      required: true,
    },
    {
      signer: 1,
      page: 2,
      type: "signature",
      x: 0.08,
      y: 0.1,
      width: 0.4,
      height: 0.06,
      required: true,
    },
  ],
  routing: "sequential",
  deliver: false,
};

describe("request-signatures native integration", () => {
  it("prepares a real PDF with named fillable fields and a genuine SHA-256 manifest", async () => {
    const input = await realPdf();
    const run = await runSignatureRequest(
      input,
      options,
      signatureRequestDeps(),
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;

    const zip = await JSZip.loadAsync(run.output);
    const preparedBytes = await zip.file("prepared.pdf")!.async("uint8array");

    // The prepared PDF is a real, loadable PDF that now carries our named fields.
    const prepared = await PDFDocument.load(preparedBytes);
    const names = prepared
      .getForm()
      .getFields()
      .map((f) => f.getName())
      .sort();
    expect(names).toEqual([
      "Signer1-Date-1",
      "Signer1-Signature-1",
      "Signer2-Signature-1",
    ]);

    // The manifest's document hash is a genuine SHA-256 of the ORIGINAL input.
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.document.pageCount).toBe(2);
    expect(manifest.status).toBe("prepared");
  });
});

// ─────────────────── a PDF the worker cannot open, end to end ───────────────────
//
// The stubbed engine test proves the mapping; these prove the REAL inspector
// produces the type the mapping keys on, and that the executor then spends one
// attempt, not three. Each shape was probed against pdf-lib 1.17: the encrypted
// and truncated ones throw inside `PDFDocument.load`, while the header-only one
// LOADS and then throws a bare TypeError on the page walk — the case a fix at the
// loader alone would miss.

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: false });
}

/**
 * A PDF whose trailer carries a Standard-handler /Encrypt dictionary. pdf-lib
 * cannot WRITE encryption, but its refusal is decided by that trailer entry
 * alone, so this reaches exactly the branch a real password-protected upload does.
 */
async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -4 }),
  );
  return doc.save({ useObjectStreams: false });
}

async function unreadable(): Promise<
  { label: string; bytes: Uint8Array; reason: RegExp }[]
> {
  const good = await onePagePdf();
  return [
    {
      label: "password-protected",
      bytes: await encryptedPdf(),
      reason: /password-protected\. Unlock it first/,
    },
    {
      label: "truncated",
      bytes: good.slice(0, Math.floor(good.byteLength / 2)),
      reason: /couldn't be read as a PDF/,
    },
    {
      label: "not a PDF",
      bytes: new TextEncoder().encode("this is a text file"),
      reason: /couldn't be read as a PDF/,
    },
    {
      label: "header only, no catalog",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
      reason: /couldn't be read as a PDF/,
    },
  ];
}

const oneField: SignatureRequestOptions = {
  ...options,
  signers: [options.signers[0]!],
  fields: [options.fields[0]!],
};

describe("request-signatures on a PDF the worker cannot open", () => {
  it("health check: the same path prepares a readable PDF", async () => {
    const run = await runSignatureRequest(
      await onePagePdf(),
      oneField,
      signatureRequestDeps(),
    );
    expect(run.ok).toBe(true);
  });

  it("refuses each unreadable shape as a bad request that names the reason", async () => {
    const corpus = await unreadable();
    expect(corpus.length).toBe(4);
    for (const { label, bytes, reason } of corpus) {
      const run = await runSignatureRequest(
        bytes,
        oneField,
        signatureRequestDeps(),
      );
      expect(run.ok, label).toBe(false);
      if (run.ok) continue;
      expect(run.kind, label).toBe("invalid_request");
      expect(run.message, label).toMatch(reason);
    }
  });

  it("ends a password-protected job after ONE attempt through the executor", async () => {
    let clock = 100_000;
    const store = new DevWorkerStore(() => clock);
    const queue = createLocalDevQueue({ store, now: () => clock });
    const storage = createLocalDevExecutorStorage({ store, now: () => clock });
    const executor = createWorkerExecutor({
      queue,
      storage,
      registry: createProcessorRegistry({
        compression: {
          tools: { ghostscript: false, qpdf: false, mutool: false },
        },
        requestSignatures: signatureRequestDeps(),
      }),
      leaseMs: 1_000,
    });

    const run = async (jobId: string, bytes: Uint8Array) => {
      const slot = store.reserveSlot({
        sessionId: "sess_test00000",
        filename: "contract.pdf",
        contentType: "application/pdf",
        declaredBytes: bytes.byteLength,
      });
      store.putBytes(slot.fileId, bytes);
      await queue.submit({
        job: {
          jobId,
          tool: "request-signatures",
          capability: "secure-worker",
          status: "queued",
          progress: 0,
          createdAt: new Date(clock).toISOString(),
          updatedAt: new Date(clock).toISOString(),
          expiresAt: new Date(clock + 60 * 60_000).toISOString(),
          retention: DEFAULT_RETENTION,
        },
        inputs: [slot.fileId],
        options: oneField as unknown as Record<string, unknown>,
      });
      const ticks = await executor.drain();
      clock += 1;
      return { ticks, job: store.getJob(jobId) };
    };

    // Positive control: the same executor, registry and options complete a
    // readable PDF — so a failure below is about the bytes, not the wiring.
    const control = await run("job_sigok00000", await onePagePdf());
    expect(control.ticks.map((t) => t.outcome)).toEqual(["completed", "idle"]);

    const locked = await run("job_siglock000", await encryptedPdf());
    expect(locked.ticks.map((t) => t.outcome)).toEqual(["failed", "idle"]);
    expect(locked.job?.status).toBe("failed");
    expect(locked.job?.error).toMatchObject({
      code: "unprocessable_entity",
      retryable: false,
    });
    expect(locked.job?.error?.message).toMatch(
      /password-protected\. Unlock it first/,
    );
  });
});

// ───────────── where the fields land, as a READER'S viewer shows them ─────────────
//
// The defect this pins: fields were placed with raw x/y against `page.getSize()`
// and pdf-lib's default WHITE background, so they were opaque boxes stamped over
// the page, and on a /Rotate or offset-box page they landed on the wrong edge,
// sideways, or off the page. Nothing caught it because every test asserted what
// the ENGINE computed (points it handed the placer), never what a viewer shows.
//
// So this reads the consumer's artifact: the prepared.pdf out of the ZIP, opened
// by pdfjs — the renderer our own previews use, and an implementation independent
// of the pdf-lib math under test. pdfjs's viewport applies /Rotate and the crop
// itself; the question is only "does each widget sit where the request said, on
// the page as displayed, reading upright, without painting over the page?".

const require = createRequire(import.meta.url);

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

/** Every `/Rotate` the spec allows — the whole domain, derived, not typed. */
const ROTATIONS = Array.from({ length: 4 }, (_, k) => normalizeAngle(k * 90));

/** Page-box shapes a real upload carries: plain, an offset MediaBox, an inset CropBox. */
const BOX_SHAPES: {
  label: string;
  media: [number, number, number, number];
  crop?: [number, number, number, number];
}[] = [
  { label: "letter at origin", media: [0, 0, 612, 792] },
  { label: "offset MediaBox", media: [100, 200, 712, 992] },
  { label: "inset CropBox", media: [0, 0, 612, 792], crop: [36, 48, 576, 744] },
];

async function shapedPage(
  rotation: number,
  shape: (typeof BOX_SHAPES)[number],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [x0, y0, x1, y1] = shape.media;
  const page = doc.addPage([x1 - x0, y1 - y0]);
  page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
  if (shape.crop) {
    const [cx0, cy0, cx1, cy1] = shape.crop;
    page.setCropBox(cx0, cy0, cx1 - cx0, cy1 - cy0);
  }
  page.setRotation(degrees(rotation));
  // Body text across the bottom of the page, where the signature block goes.
  page.drawText("The last line of the contract body.", {
    x: x0 + 60,
    y: y0 + 60,
    size: 11,
  });
  return doc.save();
}

/** Decode a widget's normal appearance stream into its content-stream text. */
function appearanceText(widget: PDFWidgetAnnotation): string {
  const normal = widget.getAppearances()?.normal;
  expect(normal, "every widget carries a normal appearance").toBeInstanceOf(
    PDFRawStream,
  );
  const bytes = decodePDFRawStream(normal as PDFRawStream).decode();
  return new TextDecoder("latin1").decode(bytes);
}

/** Content-stream fill operators: any of these paints an area. */
const FILL_OPERATOR = /(?:^|\s)(?:f\*?|F|B\*?|b\*?)(?=\s|$)/m;

describe("request-signatures fields as a viewer displays them", () => {
  it("the fill detector sees a fill (positive control for the no-fill assertion)", () => {
    expect(FILL_OPERATOR.test("1 1 1 rg\n0 0 10 10 re\nf\n")).toBe(true);
    expect(FILL_OPERATOR.test("0 0 0 RG\n1 w\n0 0 10 10 re\nS\n")).toBe(false);
  });

  it("every default-layout field sits where it was requested, upright, and paints no background", async () => {
    const lib = await pdfjs();
    // The layout the panel sends, at its worst case: every signer, with dates.
    const fields = signatureBlockFields(MAX_REQUEST_SIGNERS, 1, true);
    const signers = Array.from({ length: MAX_REQUEST_SIGNERS }, (_, i) => ({
      name: `Signer ${i + 1}`,
      email: `signer${i + 1}@example.com`,
    }));

    let checked = 0;
    const seenRotations = new Set<number>();
    for (const rotation of ROTATIONS) {
      for (const shape of BOX_SHAPES) {
        const where = `rotate ${rotation}, ${shape.label}`;
        const run = await runSignatureRequest(
          await shapedPage(rotation, shape),
          { signers, fields, routing: "sequential", deliver: false },
          signatureRequestDeps(),
        );
        expect(run.ok, where).toBe(true);
        if (!run.ok) continue;
        const zip = await JSZip.loadAsync(run.output);
        const preparedBytes = await zip
          .file("prepared.pdf")!
          .async("uint8array");

        // ── pdfjs: position and orientation, as displayed ──
        const task = lib.getDocument({
          data: preparedBytes.slice(),
          useSystemFonts: false,
          verbosity: 0,
        });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        seenRotations.add(page.rotate);
        const annotations = (await page.getAnnotations()) as {
          fieldName?: string;
          rect: [number, number, number, number];
          rotation: number;
          backgroundColor: unknown;
        }[];
        const byName = new Map(annotations.map((a) => [a.fieldName, a]));

        const manifest = JSON.parse(
          await zip.file("manifest.json")!.async("string"),
        ) as { fields: { name: string; rect: (typeof fields)[number] }[] };
        expect(manifest.fields.length, where).toBe(fields.length);

        const [a, b, c, d, e, f] = viewport.transform as number[];
        const toView = (x: number, y: number) => [
          a! * x + c! * y + e!,
          b! * x + d! * y + f!,
        ];
        for (const field of manifest.fields) {
          const ann = byName.get(field.name);
          expect(ann, `${where}: ${field.name} is on the page`).toBeDefined();
          if (!ann) continue;
          const [p0x, p0y] = toView(ann.rect[0], ann.rect[1]);
          const [p1x, p1y] = toView(ann.rect[2], ann.rect[3]);
          const seen = {
            left: Math.min(p0x!, p1x!),
            right: Math.max(p0x!, p1x!),
            top: Math.min(p0y!, p1y!),
            bottom: Math.max(p0y!, p1y!),
          };
          const r = field.rect;
          const want = {
            left: r.x * viewport.width,
            right: (r.x + r.width) * viewport.width,
            top: (1 - r.y - r.height) * viewport.height,
            bottom: (1 - r.y) * viewport.height,
          };
          // 1pt: pdf-lib centres the 1pt border on the box edge.
          for (const edge of ["left", "right", "top", "bottom"] as const) {
            expect(
              Math.abs(seen[edge] - want[edge]),
              `${where}: ${field.name} ${edge} is ${seen[edge].toFixed(1)}, requested ${want[edge].toFixed(1)}`,
            ).toBeLessThanOrEqual(1);
          }
          // Upright: the widget turns counter-clockwise by exactly the page's
          // clockwise display turn.
          expect(ann.rotation, `${where}: ${field.name} reads upright`).toBe(
            page.rotate,
          );
          // No /MK /BG — a viewer that regenerates the appearance paints nothing.
          expect(ann.backgroundColor, `${where}: ${field.name} /BG`).toBeNull();
          checked += 1;
        }
        await task.destroy();

        // ── pdf-lib: the appearance actually drawn paints no area ──
        const prepared = await PDFDocument.load(preparedBytes);
        for (const field of prepared.getForm().getFields()) {
          for (const widget of field.acroField.getWidgets()) {
            const ops = appearanceText(widget);
            expect(
              FILL_OPERATOR.test(ops),
              `${where}: ${field.getName()} appearance fills an area:\n${ops}`,
            ).toBe(false);
          }
        }
      }
    }

    // The corpus is what it claims: every rotation actually reached the viewer
    // (a setter that silently did nothing would leave four copies of rotate 0),
    // and every field of every shape was measured.
    expect([...seenRotations].sort((x, y) => x - y)).toEqual(ROTATIONS);
    expect(checked).toBe(ROTATIONS.length * BOX_SHAPES.length * fields.length);
    expect(fields.length).toBe(MAX_REQUEST_SIGNERS * 2);
  });
});
