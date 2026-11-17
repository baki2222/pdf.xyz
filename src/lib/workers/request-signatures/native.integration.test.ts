// @vitest-environment node
// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
  degrees,
  type PDFWidgetAnnotation,
} from "pdf-lib";
import JSZip from "jszip";
import { signatureRequestDeps } from "./native";
import { runSignatureRequest } from "./engine";
import {
  MAX_REQUEST_SIGNERS,
  REQUEST_SIGNATURE_FIELD_TYPES,
  signatureBlockFields,
  type RequestSignatureFieldType,
  type SignatureRequestOptions,
} from "@/lib/jobs/request-signatures";
import { readPdfFrames } from "@/lib/pdf/page-frame";
import {
  addField,
  moveField,
  resizeField,
  toRequestFields,
  type FrameSize,
  type LayoutField,
} from "@/lib/signatures/request-layout";
import {
  PDF_ENCRYPTED_UNKNOWN_MESSAGE,
  PDF_NEEDS_PASSWORD_MESSAGE,
} from "@/lib/pdf/encryption";
import { userPasswordEncryptedPdf } from "@/tests/encrypted-pdf-fixture";
import { PdfEngineError, normalizeAngle } from "@/lib/pdf/engine";
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

/**
 * What the loader says of an encrypted upload: one of the three sentences
 * `@/lib/pdf/encryption` writes, each naming Unlock PDF.
 *
 * AMENDED at the merge of wave1/l06-copy-other (2026-09-28), history kept. This
 * was /password-protected\. Unlock it first/, the loader's one sentence for
 * every encrypted file. Since L06 the loader asks pdf.js which lock the file
 * has: the fixture above carries no /O or /U, so no reader can open it and the
 * true answer is the "could not tell" sentence — which is also what the worker
 * says in production, where the browser pdf.js build does not load under Node.
 * What this test protects is unchanged: the loader's own reason reaches the
 * user, once, as a non-retryable bad request.
 *
 * NARROWED 2026-10-06, history kept. The amendment above matched ANY of the
 * three encryption sentences. This fixture has exactly one true answer — no
 * reader can open it, so "could not tell" — and the test environment yields
 * it deterministically; the alternation would have stayed green had the
 * probe told this unopenable file "It opens without a password" or that it
 * needs one, both false of it. So it is that one sentence, anchored, as
 * tool-faq-substance.test.ts pins it for the same shape. A file that DOES
 * need a password is a second case, so the chain is also checked on a file
 * the probe can classify — under the test environment's pdf.js (the legacy
 * build `src/tests/setup.ts` installs); in production the worker cannot load
 * the browser build, and says the "could not tell" sentence for it too.
 */
const exactly = (message: string) =>
  new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const ENCRYPTED_REASON = exactly(PDF_ENCRYPTED_UNKNOWN_MESSAGE);
const NEEDS_PASSWORD_REASON = exactly(PDF_NEEDS_PASSWORD_MESSAGE);

async function unreadable(): Promise<
  { label: string; bytes: Uint8Array; reason: RegExp }[]
> {
  const good = await onePagePdf();
  return [
    {
      label: "encrypted, unclassifiable",
      bytes: await encryptedPdf(),
      reason: ENCRYPTED_REASON,
    },
    {
      label: "needs a password to open",
      bytes: userPasswordEncryptedPdf(),
      reason: NEEDS_PASSWORD_REASON,
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
    expect(corpus.length).toBe(5);
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
    expect(locked.job?.error?.message).toMatch(ENCRYPTED_REASON);
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

/**
 * Two pages of one shape (`shapedPage`'s boxes and rotation on each), for a
 * layout that spans pages.
 */
async function shapedTwoPages(
  rotation: number,
  shape: (typeof BOX_SHAPES)[number],
): Promise<Uint8Array> {
  const one = await PDFDocument.load(await shapedPage(rotation, shape));
  const doc = await PDFDocument.create();
  const [a, b] = await doc.copyPages(one, [0, 0]);
  doc.addPage(a!);
  doc.addPage(b!);
  return doc.save();
}

/**
 * The placement editor's corpus (audit #21, 2026-11-17): boxes a reader can
 * produce with `@/lib/signatures/request-layout` — pushed into all four
 * corners, every type, a labelled Name box and a labelled resized Text box,
 * on two pages, for two signers — through the real engine and read back by
 * pdf.js on every rotation and box shape. The scratch round trip that
 * justified the editor's coordinate model (24 fields, worst edge 0.5 pt),
 * made permanent.
 */
function editorLayout(frames: readonly FrameSize[]) {
  const [p1, p2] = frames as [FrameSize, FrameSize];
  let layout: LayoutField[] = [];
  const push = (
    preset: Parameters<typeof addField>[1],
    owner: number,
    page: 1 | 2,
    dx: number,
    dy: number,
  ) => {
    const frame = page === 1 ? p1 : p2;
    layout = addField(layout, preset, owner, page, frame);
    const last = layout.length - 1;
    layout[last] = moveField(layout[last]!, dx, dy, frame);
  };
  push("signature", 1, 1, -1, -1); // bottom-left
  push("initials", 1, 1, 1, 1); // top-right
  push("name", 2, 1, -1, 1); // top-left, labelled Name
  push("date", 2, 2, 1, -1); // bottom-right, page 2
  push("text", 1, 2, 0.1, 0.2); // off-centre, page 2
  const last = layout.length - 1;
  layout[last] = {
    ...resizeField(layout[last]!, 0.1, 0.05, p2),
    label: "Notes",
  };
  return toRequestFields(
    layout,
    new Map([
      [1, 0],
      [2, 1],
    ]),
  );
}

describe("request-signatures: boxes the placement editor makes land where it drew them", () => {
  it("every corner, type, label and page, on every rotation and box shape, within 1 pt, upright, no fill", async () => {
    const lib = await pdfjs();
    const signers = [
      { name: "Ada Lovelace", email: "ada@example.com" },
      { name: "Alan Turing", email: "alan@example.com" },
    ];
    let checked = 0;
    let fieldsPerRun = 0;
    const seenRotations = new Set<number>();
    for (const rotation of ROTATIONS) {
      for (const shape of BOX_SHAPES) {
        const where = `rotate ${rotation}, ${shape.label}`;
        const input = await shapedTwoPages(rotation, shape);
        const read = await readPdfFrames(input);
        expect(read?.frames.length, where).toBe(2);
        const fields = editorLayout(read!.frames);
        fieldsPerRun = fields.length;
        // Health: the corpus is what it says — every type, two pages, labels.
        expect(new Set(fields.map((f) => f.type))).toEqual(
          new Set(REQUEST_SIGNATURE_FIELD_TYPES),
        );
        expect(new Set(fields.map((f) => f.page))).toEqual(new Set([1, 2]));
        expect(fields.some((f) => f.x === 0 && f.y === 0)).toBe(true);
        expect(
          fields.some(
            (f) =>
              Math.abs(f.x + f.width - 1) < 1e-3 &&
              Math.abs(f.y + f.height - 1) < 1e-3,
          ),
        ).toBe(true);
        // …and differs from the starting block (a no-op editor would not).
        expect(fields).not.toEqual(signatureBlockFields(2, 1, true));

        const run = await runSignatureRequest(
          input,
          { signers, fields, routing: "parallel", deliver: false },
          signatureRequestDeps(),
        );
        expect(run.ok, where).toBe(true);
        if (!run.ok) continue;
        const zip = await JSZip.loadAsync(run.output);
        const preparedBytes = await zip
          .file("prepared.pdf")!
          .async("uint8array");
        const manifest = JSON.parse(
          await zip.file("manifest.json")!.async("string"),
        ) as {
          fields: {
            name: string;
            page: number;
            label?: string;
            rect: (typeof fields)[number];
          }[];
        };
        expect(manifest.fields.length, where).toBe(fields.length);
        expect(
          manifest.fields.map((f) => f.label ?? null),
          `${where}: labels in the manifest`,
        ).toEqual(fields.map((f) => f.label ?? null));

        const task = lib.getDocument({
          data: preparedBytes.slice(),
          useSystemFonts: false,
          verbosity: 0,
        });
        const doc = await task.promise;
        for (const pageNumber of [1, 2]) {
          const page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          seenRotations.add(page.rotate);
          const annotations = (await page.getAnnotations()) as {
            fieldName?: string;
            rect: [number, number, number, number];
            rotation: number;
            backgroundColor: unknown;
          }[];
          const byName = new Map(annotations.map((a) => [a.fieldName, a]));
          const [a, b, c, d, e, f] = viewport.transform as number[];
          const toView = (x: number, y: number) => [
            a! * x + c! * y + e!,
            b! * x + d! * y + f!,
          ];
          for (const field of manifest.fields.filter(
            (m) => m.page === pageNumber,
          )) {
            const ann = byName.get(field.name);
            expect(
              ann,
              `${where}: ${field.name} on page ${pageNumber}`,
            ).toBeDefined();
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
            for (const edge of ["left", "right", "top", "bottom"] as const)
              expect(
                Math.abs(seen[edge] - want[edge]),
                `${where}: ${field.name} ${edge} is ${seen[edge].toFixed(1)}, requested ${want[edge].toFixed(1)}`,
              ).toBeLessThanOrEqual(1);
            expect(ann.rotation, `${where}: ${field.name} upright`).toBe(
              page.rotate,
            );
            expect(
              ann.backgroundColor,
              `${where}: ${field.name} /BG`,
            ).toBeNull();
            checked += 1;
          }
        }
        await task.destroy();

        const prepared = await PDFDocument.load(preparedBytes);
        for (const field of prepared.getForm().getFields())
          for (const widget of field.acroField.getWidgets())
            expect(
              FILL_OPERATOR.test(appearanceText(widget)),
              `${where}: ${field.getName()} appearance fills an area`,
            ).toBe(false);
      }
    }
    expect([...seenRotations].sort((x, y) => x - y)).toEqual(ROTATIONS);
    expect(fieldsPerRun).toBe(5);
    expect(checked).toBe(ROTATIONS.length * BOX_SHAPES.length * fieldsPerRun);
  }, 60_000);
});

/**
 * An uploaded form with a field pdf-lib must redraw: its value is in `/V` and
 * its widget has NO appearance, so `doc.save()` regenerates it with the form's
 * WinAnsi Helvetica — adding the signer fields is enough to trigger that, since
 * `getForm()` is what arms `save()` to regenerate at all.
 */
async function formNeedingRegeneration(value: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const field = form.createTextField("existing.city");
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
  for (const widget of field.acroField.getWidgets()) {
    widget.dict.delete(PDFName.of("AP"));
  }
  field.acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
  form.markFieldAsClean(field.ref);
  return doc.save({ updateFieldAppearances: false });
}

const oneSignerField = [
  {
    name: "Signer1-Signature-1",
    page: 1,
    x: 50,
    y: 100,
    width: 200,
    height: 40,
  },
];

describe("request-signatures native placement — existing fields pdf-lib redraws", () => {
  it("fixture health: the existing field has a value and no appearance", async () => {
    const doc = await PDFDocument.load(await formNeedingRegeneration("ঢাকা"));
    const field = doc.getForm().getTextField("existing.city");
    expect(field.getText()).toBe("ঢাকা");
    expect(field.needsAppearancesUpdate()).toBe(true);
  });

  it("refuses in words, naming the characters, instead of leaking pdf-lib's encoder error", async () => {
    const { place } = signatureRequestDeps();
    const run = place!(await formNeedingRegeneration("ঢাকা"), oneSignerField);
    await expect(run).rejects.toBeInstanceOf(PdfEngineError);
    await expect(run).rejects.toThrow(/outside it: .*ঢ/);
  });

  it("control: a Latin value is redrawn and the signer field is added", async () => {
    const { place } = signatureRequestDeps();
    const out = await place!(
      await formNeedingRegeneration("Dhaka"),
      oneSignerField,
    );
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField("existing.city").getText()).toBe("Dhaka");
    expect(form.getTextField("existing.city").needsAppearancesUpdate()).toBe(
      false,
    );
    expect(form.getFields().map((f) => f.getName())).toContain(
      "Signer1-Signature-1",
    );
  });
});

/**
 * Audit #17 (2026-11-06). Both of these used to end in the engine's bare
 * catch as `{kind: "failed"}` — "The PDF could not be prepared…", which the
 * processor maps to a RETRYABLE internal_error — so the worker re-ran a job
 * that could never succeed and the user was never told why. The unit test
 * above pins `place()` alone; these walk the composed chain.
 */
describe("request-signatures through runSignatureRequest — deterministic refusals and re-preparation", () => {
  const twoSigners: SignatureRequestOptions = {
    signers: [
      { name: "Ada Lovelace", email: "ada@example.com" },
      { name: "Alan Turing", email: "alan@example.com" },
    ],
    fields: signatureBlockFields(2, 1, true),
    routing: "parallel",
    deliver: false,
  };

  it("re-preparing a prepared PDF adds new, uniquely named fields beside the old ones", async () => {
    const first = await runSignatureRequest(
      await realPdf(),
      {
        signers: [{ name: "Ada Lovelace", email: "ada@example.com" }],
        fields: signatureBlockFields(1, 1, true),
        routing: "parallel",
        deliver: false,
      },
      signatureRequestDeps(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstPdf = await (
      await JSZip.loadAsync(first.output)
    )
      .file("prepared.pdf")!
      .async("uint8array");
    const before = (await PDFDocument.load(firstPdf))
      .getForm()
      .getFields()
      .map((f) => f.getName());
    // Health check: the first package really holds the names a second run
    // would pick by default.
    expect(before).toContain("Signer1-Signature-1");

    const again = await runSignatureRequest(
      firstPdf,
      twoSigners,
      signatureRequestDeps(),
    );
    expect(again).toMatchObject({ ok: true });
    if (!again.ok) return;
    const zip = await JSZip.loadAsync(again.output);
    const names = (
      await PDFDocument.load(
        await zip.file("prepared.pdf")!.async("uint8array"),
      )
    )
      .getForm()
      .getFields()
      .map((f) => f.getName());
    expect(new Set(names).size).toBe(names.length);
    for (const old of before) expect(names).toContain(old);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    ) as { fields: { name: string; signer: number }[] };
    expect(manifest.fields).toHaveLength(twoSigners.fields.length);
    for (const field of manifest.fields) {
      expect(names).toContain(field.name);
      expect(before).not.toContain(field.name);
      expect(field.name.startsWith(`Signer${field.signer}-`)).toBe(true);
    }
  });

  it("a form whose existing value cannot be redrawn is refused in words, not retried", async () => {
    const run = await runSignatureRequest(
      await formNeedingRegeneration("ঢাকা"),
      {
        signers: [{ name: "Ada Lovelace", email: "ada@example.com" }],
        fields: signatureBlockFields(1, 1, true),
        routing: "parallel",
        deliver: false,
      },
      signatureRequestDeps(),
    );
    expect(run).toMatchObject({ ok: false, kind: "invalid_request" });
    if (run.ok) return;
    expect(run.message).toMatch(/outside it: .*ঢ/);
  });

  it("control: the same form with a Latin value prepares", async () => {
    const run = await runSignatureRequest(
      await formNeedingRegeneration("Dhaka"),
      twoSigners,
      signatureRequestDeps(),
    );
    expect(run.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A box's label reaches the PDF as its /TU (2026-11-17).
//
// Until then a label reached manifest.json only, so a signer opening
// prepared.pdf saw a box named Signer1-Text-1 and nothing saying it was for
// their name. The label is now the field's /TU (its alternate name, which a
// viewer shows as a tooltip) and README.txt lists it under its signer; the
// field NAME does not change. Read back from the consumer's artifact by two
// readers: pdf-lib's raw /TU bytes decoded HERE (not by pdf-lib's own text
// decoder, which shares the encoder's library), and pdf.js's alternativeText,
// which is what Firefox puts in the box's title.
// ---------------------------------------------------------------------------

const cp = (...points: number[]) => String.fromCodePoint(...points);
const codePoints = (s: string) => Array.from(s, (c) => c.codePointAt(0)!);

/** One label per script the product serves, built from code points. */
const LABELS = {
  // "Nom legal" with an acute e: Latin with one letter outside ASCII.
  latin: cp(0x4e, 0x6f, 0x6d, 0x20, 0x6c, 0xe9, 0x67, 0x61, 0x6c),
  // Bengali "nam" (name): NA, vowel sign AA, MA.
  bengali: cp(0x09a8, 0x09be, 0x09ae),
  // CJK "name" plus one character outside the BMP (a surrogate pair).
  cjk: cp(0x59d3, 0x540d, 0x20bb7),
} as const;

/** Decode a PDF text string's bytes without pdf-lib: UTF-16BE behind FE FF, else one byte per character. */
function decodeTextString(bytes: Uint8Array): {
  bom: boolean;
  points: number[];
} {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const units: number[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2)
      units.push((bytes[i]! << 8) | bytes[i + 1]!);
    return { bom: true, points: codePoints(String.fromCharCode(...units)) };
  }
  return { bom: false, points: Array.from(bytes) };
}

/**
 * Every way `prepared` disagrees with `expected` (field name -> label, or
 * undefined for a box with no label), read by pdf-lib (raw /TU bytes) and by
 * pdf.js (alternativeText). Empty means every box carries exactly its label.
 */
async function tooltipProblems(
  prepared: Uint8Array,
  expected: ReadonlyMap<string, string | undefined>,
): Promise<string[]> {
  const problems: string[] = [];
  const doc = await PDFDocument.load(prepared);
  const form = doc.getForm();
  for (const [name, label] of expected) {
    const field = form.getTextField(name).acroField;
    const places = [
      { where: `${name} `, dict: field.dict },
      ...field
        .getWidgets()
        .map((w, i) => ({ where: `${name} widget ${i + 1} `, dict: w.dict })),
    ];
    if (places.length < 2) problems.push(`pdf-lib: ${name} has no widget`);
    for (const { where, dict } of places) {
      const tu = dict.lookup(PDFName.of("TU"));
      if (label === undefined) {
        if (tu !== undefined) problems.push(`pdf-lib: ${where}has a /TU`);
        continue;
      }
      if (!(tu instanceof PDFHexString || tu instanceof PDFString)) {
        problems.push(`pdf-lib: ${where}has no /TU text string`);
        continue;
      }
      const got = decodeTextString(tu.asBytes());
      if (codePoints(label).some((p) => p > 0x7f) && !got.bom)
        problems.push(`pdf-lib: ${where}/TU is not UTF-16BE behind FE FF`);
      if (got.points.join() !== codePoints(label).join())
        problems.push(
          `pdf-lib: ${where}/TU is [${got.points.join()}], label is [${codePoints(label).join()}]`,
        );
    }
  }
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: prepared.slice(),
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const seen = new Map<string, string>();
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    for (const a of (await page.getAnnotations()) as {
      fieldName?: string;
      alternativeText?: string;
    }[])
      if (a.fieldName) seen.set(a.fieldName, a.alternativeText ?? "");
  }
  await task.destroy();
  for (const [name, label] of expected) {
    if (!seen.has(name)) {
      problems.push(`pdf.js: no widget named ${name}`);
      continue;
    }
    const got = codePoints(seen.get(name)!).join();
    if (got !== codePoints(label ?? "").join())
      problems.push(`pdf.js: ${name} alternativeText is [${got}]`);
  }
  return problems;
}

const LABEL_BOXES: {
  signer: number;
  page: number;
  type: RequestSignatureFieldType;
  label?: string;
}[] = [
  { signer: 0, page: 1, type: "text", label: LABELS.latin },
  { signer: 0, page: 1, type: "signature" },
  { signer: 1, page: 2, type: "text", label: LABELS.bengali },
  { signer: 1, page: 2, type: "initials", label: LABELS.cjk },
];

const labelledOptions: SignatureRequestOptions = {
  signers: [
    { name: "Ada Lovelace", email: "ada@example.com" },
    { name: "Alan Turing", email: "alan@example.com" },
  ],
  fields: LABEL_BOXES.map((f, i) => ({
    ...f,
    x: 0.1,
    y: 0.1 + i * 0.1,
    width: 0.3,
    height: 0.05,
    required: true,
  })),
  routing: "sequential",
  deliver: false,
};

async function prepareLabelled(
  opts: SignatureRequestOptions = labelledOptions,
) {
  const run = await runSignatureRequest(
    await realPdf(),
    opts,
    signatureRequestDeps(),
  );
  expect(run.ok).toBe(true);
  if (!run.ok) throw new Error(run.message);
  const zip = await JSZip.loadAsync(run.output);
  const manifest = JSON.parse(
    await zip.file("manifest.json")!.async("string"),
  ) as { fields: { name: string; signer: number; label?: string }[] };
  return {
    prepared: await zip.file("prepared.pdf")!.async("uint8array"),
    readme: await zip.file("README.txt")!.async("string"),
    manifest,
    expected: new Map(manifest.fields.map((f) => [f.name, f.label])),
  };
}

/** Overwrite a box's /TU where the placer writes it: the field and each widget. */
function setTooltip(
  doc: PDFDocument,
  name: string,
  value: PDFHexString | PDFString,
): void {
  const field = doc.getForm().getTextField(name).acroField;
  field.dict.set(PDFName.of("TU"), value);
  for (const widget of field.getWidgets())
    widget.dict.set(PDFName.of("TU"), value);
}

describe("request-signatures: a box's label reaches prepared.pdf and README.txt", () => {
  it("corpus health: three scripts, one astral character, one box with no label, names unchanged", async () => {
    const { manifest, expected } = await prepareLabelled();
    expect([...expected.keys()]).toEqual([
      "Signer1-Text-1",
      "Signer1-Signature-1",
      "Signer2-Text-1",
      "Signer2-Initials-1",
    ]);
    expect([...expected.values()]).toEqual([
      LABELS.latin,
      undefined,
      LABELS.bengali,
      LABELS.cjk,
    ]);
    expect(manifest.fields).toHaveLength(4);
    expect(codePoints(LABELS.cjk).some((p) => p > 0xffff)).toBe(true);
    expect(LABELS.cjk.length).toBe(4); // three characters, four UTF-16 units
  });

  it("each labelled box's /TU equals its label, code point for code point, in pdf-lib and pdf.js; the unlabelled box has none", async () => {
    const { prepared, expected } = await prepareLabelled();
    expect(await tooltipProblems(prepared, expected)).toEqual([]);
  });

  it("README.txt lists each box's label under its own signer, and no line for the box without one", async () => {
    const { readme, manifest } = await prepareLabelled();
    const lines = readme.split("\n");
    const signerLine = (order: number) =>
      lines.findIndex((l) => l.startsWith(`  ${order}. `));
    const s1 = signerLine(1);
    const s2 = signerLine(2);
    expect(s1).toBeGreaterThan(-1);
    expect(s2).toBeGreaterThan(s1);
    const labelled = manifest.fields.filter((f) => f.label !== undefined);
    expect(labelled).toHaveLength(3);
    for (const f of labelled) {
      const at = lines.indexOf(`     ${f.name} label: ${f.label}`);
      expect(at, `${f.name} listed`).toBeGreaterThan(-1);
      // Under its own signer's line, before the next signer's.
      const [from, to] = f.signer === 1 ? [s1, s2] : [s2, lines.length];
      expect(at > from && at < to, `${f.name} under signer ${f.signer}`).toBe(
        true,
      );
    }
    expect(readme).not.toMatch(/Signer1-Signature-1 label:/);
    expect(readme).toContain("tooltip of its box in prepared.pdf");
  });

  it("README.txt says nothing about labels when no box has one, and no /TU is written", async () => {
    const { readme, prepared, expected } = await prepareLabelled({
      ...labelledOptions,
      fields: labelledOptions.fields.map(({ label: _drop, ...f }) => f),
    });
    expect(readme).not.toMatch(/ label: |tooltip/);
    expect([...expected.values()].every((l) => l === undefined)).toBe(true);
    expect(await tooltipProblems(prepared, expected)).toEqual([]);
  });

  it("positive control: a /TU written by a broken encoder fails the same check", async () => {
    const { prepared, expected } = await prepareLabelled();
    const hexUnits = (l: string, swap: boolean) =>
      Array.from({ length: l.length }, (_, i) => {
        const u = l.charCodeAt(i);
        const v = swap ? ((u & 0xff) << 8) | (u >> 8) : u;
        return v.toString(16).padStart(4, "0");
      }).join("");
    // Each broken encoder rewrites every /TU the engine wrote; the check must
    // catch every one, having passed the engine's own output (above).
    const broken: Record<string, (label: string) => PDFHexString | PDFString> =
      {
        "a literal string (no BOM)": (l) => PDFString.of(l),
        "UTF-16BE without its BOM": (l) => PDFHexString.of(hexUnits(l, false)),
        "UTF-16LE behind FF FE": (l) =>
          PDFHexString.of(`fffe${hexUnits(l, true)}`),
        "the wrong text": () => PDFHexString.fromText("Signer"),
      };
    for (const [what, encode] of Object.entries(broken)) {
      const doc = await PDFDocument.load(prepared);
      for (const [name, label] of expected)
        if (label !== undefined) setTooltip(doc, name, encode(label));
      const problems = await tooltipProblems(await doc.save(), expected);
      for (const [name, label] of expected)
        if (label !== undefined)
          expect(
            problems.some((p) => p.includes(` ${name} `)),
            `${what}: ${name} not caught (${problems.join("; ")})`,
          ).toBe(true);
    }
    // The other direction: a /TU on the unlabelled box is caught by both readers.
    const doc = await PDFDocument.load(prepared);
    setTooltip(doc, "Signer1-Signature-1", PDFHexString.fromText("x"));
    expect(await tooltipProblems(await doc.save(), expected)).toEqual([
      "pdf-lib: Signer1-Signature-1 has a /TU",
      "pdf-lib: Signer1-Signature-1 widget 1 has a /TU",
      "pdf.js: Signer1-Signature-1 alternativeText is [120]",
    ]);
  }, 30_000);
});
