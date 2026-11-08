/**
 * Child process for the security-in-browser hostile matrix. Run by
 * `security-in-browser.hostile.test.ts` as
 *
 *   node --import tsx security-in-browser.runner.ts <cells.json> <start>
 *
 * and never imported by a test: a synchronous hang in the code under test
 * would freeze whatever thread it runs on, so it runs HERE, where the parent
 * can kill it and record the cell as hung. `cells.json` is a list of
 * `[fixtureId, entry]`; cells run from `<start>`, each announced on stdout as
 * `S <i>` and settled as `R <i> <json>`.
 *
 * Memory is watched by a worker thread (it keeps running while the main
 * thread is stuck): past {@link RSS_LIMIT_MB} it writes `M <i> <mb>` to
 * stderr and kills this process, and the parent records the cell as a
 * memory blow-up. The worker also keeps the peak RSS of each cell.
 */
import { readFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  SECURITY_FIXTURES,
  type Entry,
  type FixtureSpec,
} from "./security-in-browser.cells";

const RSS_LIMIT_MB = Number(process.env.HOSTILE_RSS_LIMIT_MB ?? 1536);

const shared = new SharedArrayBuffer(16);
const peak = new Float64Array(shared, 0, 1);
const current = new Int32Array(shared, 8, 1);
const monitor = new Worker(
  `
  const { workerData } = require("node:worker_threads");
  const { writeSync } = require("node:fs");
  const peak = new Float64Array(workerData.shared, 0, 1);
  const current = new Int32Array(workerData.shared, 8, 1);
  setInterval(() => {
    const mb = process.memoryUsage.rss() / 1048576;
    if (mb > peak[0]) peak[0] = mb;
    if (mb > workerData.limit) {
      writeSync(2, "M " + Atomics.load(current, 0) + " " + Math.round(mb) + "\\n");
      process.kill(process.pid, "SIGKILL");
    }
  }, 50);
  `,
  { eval: true, workerData: { shared, limit: RSS_LIMIT_MB } },
);
monitor.unref();

const out = (line: string) => writeSync(1, `${line}\n`);

// Resolved from the project root: this file may run as CommonJS under tsx.
const requireHere = createRequire(`${process.cwd()}/package.json`);
async function pdfjsLegacy() {
  return import(
    pathToFileURL(requireHere.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  );
}

const bytesCache = new Map<string, Uint8Array>();
async function bytesOf(f: FixtureSpec): Promise<Uint8Array> {
  let b = bytesCache.get(f.id);
  if (!b) {
    b = await f.build();
    bytesCache.set(f.id, b);
  }
  return b.slice();
}

const MARKERS = [
  "/OpenAction",
  "/JavaScript",
  "hostile-js-marker",
  "/Launch",
  "cmd.exe",
  "/EmbeddedFiles",
  "hostile-embedded-marker",
  "javascript:alert(1)",
];

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

function startsWith(whole: Uint8Array, prefix: Uint8Array): boolean {
  if (whole.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++)
    if (whole[i] !== prefix[i]) return false;
  return true;
}

async function pdfLibPages(bytes: Uint8Array): Promise<number | string> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPageCount();
  } catch (e) {
    return `pdf-lib refused: ${(e as Error).message.slice(0, 120)}`;
  }
}

/** The part of a decrypted copy a reader can check. */
async function inspectPlain(plain: Uint8Array) {
  const { countDigitalSignatures } =
    await import("@/lib/pdf/digital-signatures");
  const t = latin1(plain);
  return {
    plainBytes: plain.length,
    plainPages: await pdfLibPages(plain),
    plainHasEncrypt: /\/Encrypt\b/.test(t),
    plainSignatures: countDigitalSignatures(plain),
    // writePlain re-emits every string as hex, so a marker is looked for in
    // both spellings (a plain-text search alone missed `cmd.exe` once).
    markers: MARKERS.filter((m) => {
      const h = Buffer.from(m, "latin1").toString("hex");
      return t.includes(m) || t.includes(h) || t.includes(h.toUpperCase());
    }),
  };
}

/** The Info title a reader finds, or why it could not. */
async function titleOf(bytes: Uint8Array): Promise<string | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getTitle() ?? null;
  } catch (e) {
    return `pdf-lib refused: ${(e as Error).message.slice(0, 80)}`;
  }
}

function passwordFor(f: FixtureSpec): string {
  if (f.truth.kind === "user") return f.truth.password;
  if (f.truth.kind === "owner" && f.truth.owner) return f.truth.owner;
  throw new Error(`${f.id} has no password`);
}

/**
 * The watchdog's own positive controls (rule: a predicate needs a positive
 * control). `__hang` never yields; `__alloc` holds ever more memory. If the
 * harness records either as anything but `hang` / `memory`, every "no hang"
 * and "no blow-up" verdict in the matrix is blind.
 */
export type SelfTest = "__hang" | "__alloc";

async function run(f: FixtureSpec, entry: Entry | SelfTest): Promise<unknown> {
  if (entry === "__hang") {
    for (;;) {
      // A synchronous loop: no timer in this thread can interrupt it.
    }
  }
  if (entry === "__alloc") {
    const hold: Uint8Array[] = [];
    for (;;) hold.push(new Uint8Array(64 << 20).fill(1));
  }
  const bytes = await bytesOf(f);
  switch (entry) {
    case "classify": {
      const { classifyPdfAccess } = await import("@/lib/pdf/encryption");
      return classifyPdfAccess(bytes, await pdfjsLegacy());
    }
    case "probe": {
      const { probePdfEncryption, encryptedPdfMessage } =
        await import("@/lib/pdf/encryption");
      const lib = await pdfjsLegacy();
      const verdict = await probePdfEncryption(bytes, async () => lib);
      return { verdict, message: encryptedPdfMessage(verdict) };
    }
    case "openProtected": {
      const { openProtectedPdf } =
        await import("@/lib/pdf/security/protected-pdf");
      const r = await openProtectedPdf(bytes);
      if (r.kind !== "opened") return r;
      return {
        kind: r.kind,
        scheme: r.pdf.scheme,
        authenticatedAs: r.pdf.authenticatedAs,
        canFillForms: r.pdf.canFillForms,
        canAnnotate: r.pdf.canAnnotate,
        canAssemble: r.pdf.canAssemble,
        ...(await inspectPlain(r.pdf.plain)),
      };
    }
    case "openWrongPassword":
    case "openRightPassword": {
      const { openWithPassword } =
        await import("@/lib/pdf/security/open-with-password");
      const pw =
        entry === "openWrongPassword" ? "definitely-not-it" : passwordFor(f);
      const r = await openWithPassword(bytes, pw);
      if (r.kind !== "opened") return r;
      return { kind: r.kind, as: r.as, ...(await inspectPlain(r.plain)) };
    }
    case "openProtectedCopy": {
      const { openProtectedCopy } =
        await import("@/components/tools/runner/open-protected");
      const file = new File([bytes.slice()], `${f.id}.pdf`, {
        type: "application/pdf",
      });
      const r = await openProtectedCopy(file, bytes, "pdf-lib");
      if (!r) return null;
      return {
        pageCount: r.pageCount,
        rotations: r.rotations.slice(0, 4),
        digitalSignatures: r.digitalSignatures,
        bytes: r.bytes.length,
      };
    }
    case "readXref": {
      const { loadPdfLib } = await import("@/lib/pdf/pdf-lib");
      const { readXref } = await import("@/lib/pdf/security/document");
      const x = await readXref(await loadPdfLib(), bytes);
      return {
        entries: x.entries.size,
        usesXrefStream: x.usesXrefStream,
        startxref: x.startxref,
      };
    }
    case "signatures": {
      // The byte scan alone: what runs on every batch open.
      const { countDigitalSignatures } =
        await import("@/lib/pdf/digital-signatures");
      return { count: countDigitalSignatures(bytes) };
    }
    case "countSignatures": {
      // signed.ts over a pdf-lib parse, as Compress asks it. A pdf-lib
      // refusal is reported as such: it is the loader's, not this counter's.
      const { countSignatures } = await import("@/lib/pdf/signed");
      const { loadPdfLib } = await import("@/lib/pdf/pdf-lib");
      const lib = await loadPdfLib();
      let doc;
      try {
        // As `loadPdf` (engine.ts) loads for every caller of countSignatures:
        // no ignoreEncryption, so an encrypted file never reaches it.
        doc = await lib.PDFDocument.load(bytes);
      } catch (e) {
        return { loaded: false, why: (e as Error).message.slice(0, 100) };
      }
      return { loaded: true, count: countSignatures(lib, doc) };
    }
    case "linearization": {
      const { isLinearized, linearizationVerdict } =
        await import("@/lib/pdf/linearization");
      return {
        isLinearized: isLinearized(bytes),
        ...linearizationVerdict(bytes),
      };
    }
    case "saveChanges": {
      const { openProtectedPdf } =
        await import("@/lib/pdf/security/protected-pdf");
      const { countDigitalSignatures } =
        await import("@/lib/pdf/digital-signatures");
      const { PDFDocument } = await import("pdf-lib");
      const r = await openProtectedPdf(bytes);
      if (r.kind !== "opened") return { opened: r.kind };
      // An edit no grant guards: the Info dictionary's title.
      const doc = await PDFDocument.load(r.pdf.plain, {
        updateMetadata: false,
      });
      doc.setTitle("hostile-matrix edit");
      const edited = await doc.save({ useObjectStreams: false });
      const saved = await r.pdf.saveChanges(edited);
      const again = await openProtectedPdf(saved.bytes);
      return {
        prefixKept: startsWith(saved.bytes, bytes),
        appended: saved.bytes.length - bytes.length,
        changed: saved.changed,
        added: saved.added,
        signaturesBefore: countDigitalSignatures(bytes),
        signaturesAfter: countDigitalSignatures(saved.bytes),
        reopened: again.kind,
        reopenedPages:
          again.kind === "opened" ? await pdfLibPages(again.pdf.plain) : null,
        // Read as a reader reads it: the plain copy writes strings as hex.
        title: again.kind === "opened" ? await titleOf(again.pdf.plain) : null,
      };
    }
  }
}

async function main() {
  const [, , listPath, startArg, endArg] = process.argv;
  const cells = JSON.parse(readFileSync(listPath!, "utf8")) as [
    string,
    Entry | SelfTest,
  ][];
  const byId = new Map(SECURITY_FIXTURES.map((f) => [f.id, f]));
  // Warm the shared modules once, so the first cell's time is its own.
  await pdfjsLegacy();
  const end = Math.min(cells.length, Number(endArg ?? cells.length));
  for (let i = Number(startArg ?? 0); i < end; i++) {
    const [id, entry] = cells[i]!;
    const f = byId.get(id);
    Atomics.store(current, 0, i);
    const startMb = process.memoryUsage.rss() / 1048576;
    peak[0] = startMb;
    out(`S ${i}`);
    const t0 = performance.now();
    let result: Record<string, unknown>;
    try {
      if (!f) throw new Error(`unknown fixture ${id}`);
      const value = await run(f, entry);
      result = { status: "ok", value };
    } catch (e) {
      const err = e as Error;
      result = {
        status: "threw",
        name: err?.name ?? typeof e,
        message: String(err?.message ?? e).slice(0, 300),
      };
    }
    result.ms = Math.round(performance.now() - t0);
    result.peakMb = Math.round(peak[0]!);
    // Growth, not the absolute peak: RSS is not returned to the OS after a
    // big cell, and the next, innocent cell would inherit its peak.
    result.growthMb = Math.max(0, Math.round(peak[0]! - startMb));
    out(`R ${i} ${JSON.stringify(result)}`);
  }
  process.exit(0);
}

void main();
