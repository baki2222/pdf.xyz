/**
 * The CHILD half of the page-structure hostile matrix
 * (`page-structure.hostile.test.ts` is the supervisor). Run as
 * `node --import tsx page-structure.cells.ts <plan.json>`; never imported by
 * a test.
 *
 * Why a child process: pdf-lib and pdf.js do most of their work
 * synchronously, so a hostile file that loops forever or inflates a gigabyte
 * blocks the event loop and no in-process timeout ever fires. Here the
 * supervisor owns the clock (it kills this process when a cell overruns) and
 * a watchdog THREAD owns the memory bound (it kills the process from the
 * side when RSS passes the limit, which a blocked main thread cannot do).
 *
 * Protocol: one line per event on stdout, prefixed `@@CELL ` so library
 * logging cannot be mistaken for a result:
 *   {"t":"start","i":n}   cell n begins
 *   {"t":"done","i":n,"r":{...}}   cell n's outcome
 *   {"t":"memory","rss":bytes}     written by the watchdog just before kill
 */
import { readFileSync, writeSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { openForBatch } from "@/components/tools/runner/batch/open-for-batch";
import {
  deletePages,
  extractPages,
  getPageCount,
  getPageRotations,
  loadPdf,
  mergePdfs,
  organizePages,
  PdfEncryptedError,
  PdfEngineError,
  rotatePages,
  setPageRotations,
  splitPdf,
} from "@/lib/pdf/engine";
import { mergeAlternating } from "@/lib/pdf/merge-alternate";
import { DEFAULT_N_UP_OPTIONS, nUpPdf, type NUpCount } from "@/lib/pdf/n-up";
import { countPdfPagesDetailed } from "@/lib/pdf/page-count";
import { countPagesWithPdfjs } from "@/lib/pdf/pdfjs-page-count";
import { loadPdfjs } from "@/lib/pdf/pdfjs";
import { probePdf } from "@/lib/pdf/probe";
import { buildSplitParts, oddEvenParts } from "@/lib/pdf/split-parts";
import { splitPagesInHalf } from "@/lib/pdf/split-half";
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import type { Rotation } from "@/lib/pdf/types";
import { controlPdf, PAGE_STRUCTURE_FIXTURES } from "./page-structure.fixtures";

export const RSS_LIMIT = 1536 * 1024 * 1024;

export interface PlannedCell {
  readonly engine: string;
  readonly fixture: string;
}

export interface OutputFile {
  readonly name?: string;
  readonly bytes: number;
  readonly reload: string;
  readonly pages?: number;
  readonly pdfjsPages?: number | string;
  readonly rotations?: number[];
  readonly boxes?: number[][];
  /** Number tokens no PDF reader accepts, found in decoded streams/boxes. */
  readonly badNumbers?: string[];
  readonly markers?: string[];
  /** Active-content keys still present in the output. */
  readonly active?: string[];
}

export type CellResult =
  | {
      outcome: "refused";
      name: string;
      message: string;
      kind?: string;
      verdict?: string | null;
      ms: number;
    }
  | { outcome: "threw"; name: string; message: string; at?: string; ms: number }
  | { outcome: "output"; files: OutputFile[]; extra?: unknown; ms: number }
  | { outcome: "value"; value: unknown; ms: number }
  | { outcome: "fixture-error"; message: string; ms: number }
  | { outcome: "hang"; ms: number }
  | { outcome: "memory"; rss: number; ms: number }
  | { outcome: "crash"; code: number | null; tail: string; ms: number };

const emit = (o: unknown) => writeSync(1, `@@CELL ${JSON.stringify(o)}\n`);

/* ------------------------------------------------------------------ *
 *  Output inspection.
 * ------------------------------------------------------------------ */

const BAD_NUMBER =
  /(?<![\w/#])(NaN|-?Infinity|undefined|\d(?:\.\d+)?[eE][+-]?\d+)(?![\w])/g;
const MARKERS = ["FIRST", "SECOND"];
const ACTIVE: [string, RegExp][] = [
  ["JavaScript", /\/S\s*\/JavaScript/],
  ["Launch", /\/S\s*\/Launch/],
  ["javascript:URI", /\(javascript:/i],
  ["EmbeddedFiles", /\/EmbeddedFiles/],
  ["OpenAction", /\/OpenAction/],
  ["AA", /\/AA\s*<</],
];

async function inspect(bytes: Uint8Array, name?: string): Promise<OutputFile> {
  const lib = await import("pdf-lib");
  let doc;
  try {
    doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    return {
      name,
      bytes: bytes.length,
      reload: `error: ${(e as Error).message}`,
    };
  }
  const pages = doc.getPages();
  const rotations = pages.slice(0, 8).map((p) => p.getRotation().angle);
  const boxes = pages.slice(0, 3).map((p) => {
    const m = p.getMediaBox();
    const c = p.getCropBox();
    return [m.x, m.y, m.width, m.height, c.width, c.height];
  });
  const bad = new Set<string>();
  for (const b of boxes)
    for (const n of b) if (!Number.isFinite(n)) bad.add(`box:${n}`);
  const markers = new Set<string>();
  // Markers count only in what a page DRAWS: its content streams and the
  // XObjects its resources name (one level, which is where n-up puts the
  // embedded page). An orphan object left behind by an in-place save draws
  // nothing.
  const drawn = new Set<unknown>();
  for (const p of pages) {
    const c = p.node.Contents();
    if (c instanceof lib.PDFArray)
      for (let i = 0; i < c.size(); i += 1) drawn.add(c.lookup(i));
    else if (c) drawn.add(c);
    const xo = p.node.Resources()?.lookup(lib.PDFName.of("XObject"));
    if (xo instanceof lib.PDFDict)
      for (const k of xo.keys()) drawn.add(xo.lookup(k));
  }
  let dicts = "";
  let decodedBudget = 32 * 1024 * 1024;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof lib.PDFRawStream) {
      const sub = obj.dict.get(lib.PDFName.of("Subtype"));
      if (sub === lib.PDFName.of("Image")) continue;
      if (obj.dict.has(lib.PDFName.of("Length1"))) continue;
      dicts += obj.dict.toString().slice(0, 4096);
      if (decodedBudget <= 0) continue;
      try {
        const data = lib
          .decodePDFRawStream(obj)
          .getBytes(Math.min(2 * 1024 * 1024, decodedBudget));
        decodedBudget -= data.length;
        const s = Buffer.from(data).toString("latin1");
        for (const m of s.matchAll(BAD_NUMBER)) bad.add(m[1]!);
        if (drawn.has(obj))
          for (const k of MARKERS) if (s.includes(`(${k})`)) markers.add(k);
      } catch {
        /* undecodable stream: not this inspector's question */
      }
    } else if (dicts.length < 4 * 1024 * 1024) {
      dicts += `${obj.toString()}\n`;
    }
  }
  for (const m of dicts.matchAll(BAD_NUMBER)) bad.add(`dict:${m[1]}`);
  const active = ACTIVE.filter(([, re]) => re.test(dicts)).map(([k]) => k);
  let pdfjsPages: number | string;
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      ...PDFJS_DOCUMENT_DEFAULTS,
    });
    const d = await task.promise;
    pdfjsPages = d.numPages;
    await d.getPage(1);
    await task.destroy();
  } catch (e) {
    pdfjsPages = `error: ${(e as Error).name}: ${(e as Error).message}`;
  }
  return {
    name,
    bytes: bytes.length,
    reload: "ok",
    pages: pages.length,
    pdfjsPages,
    rotations,
    boxes,
    badNumbers: [...bad].slice(0, 8),
    markers: [...markers],
    active,
  };
}

/* ------------------------------------------------------------------ *
 *  The engines, each as the tool calls it.
 * ------------------------------------------------------------------ */

type Run = (
  x: Uint8Array,
) => Promise<{ files?: OutputFile[]; value?: unknown; extra?: unknown }>;

let ctrl1: Uint8Array | null = null;
let ctrl3: Uint8Array | null = null;
const one = async () => (ctrl1 ??= await controlPdf(1));
const three = async () => (ctrl3 ??= await controlPdf(3));
const files = async (b: Uint8Array) => ({ files: [await inspect(b)] });

export const ENGINES: Record<string, Run> = {
  loadPdf: async (x) => {
    const doc = await loadPdf(x);
    return { value: { pages: doc.getPageCount() } };
  },
  getPageCount: async (x) => ({ value: await getPageCount(x) }),
  getPageRotations: async (x) => ({ value: await getPageRotations(x) }),
  merge: async (x) => files(await mergePdfs([x, await one()])),
  mergeAlternate: async (x) => files(await mergeAlternating([x, await one()])),
  extract: async (x) => files(await extractPages(x, [0])),
  delete: async (x) => files(await deletePages(x, [0])),
  rotate: async (x) => files(await rotatePages(x, [0], 90)),
  setRotations: async (x) => {
    const r = await getPageRotations(x);
    return files(
      await setPageRotations(
        x,
        r.map((a) => ((a + 90) % 360) as Rotation),
      ),
    );
  },
  split: async (x) => {
    const n = await getPageCount(x);
    const out = await splitPdf(x, oddEvenParts("hostile", n));
    return {
      files: await Promise.all(out.map((o) => inspect(o.bytes, o.name))),
    };
  },
  organize: async (x) =>
    files(
      await organizePages(x, [
        { sourceIndex: 0, rotation: 0 },
        { sourceIndex: 0, rotation: 90 },
      ]),
    ),
  nUp: async (x) => {
    const r = await nUpPdf(x, { ...DEFAULT_N_UP_OPTIONS, perSheet: 4 });
    return {
      ...(await files(r.bytes)),
      extra: { sourcePages: r.sourcePages, sheets: r.sheets },
    };
  },
  splitHalf: async (x) => {
    const r = await splitPagesInHalf(x, {
      direction: "left-right",
      order: "left-first",
    });
    return {
      ...(await files(r.bytes)),
      extra: { sourcePages: r.sourcePages, pageCount: r.pageCount },
    };
  },
  countPdfPagesDetailed: async (x) => ({
    value: await countPdfPagesDetailed(x, 256 * 1024 * 1024),
  }),
  probePdf: async (x) => ({
    value: await probePdf(x, { maxBytes: 256 * 1024 * 1024 }),
  }),
  countPagesWithPdfjs: async (x) => ({ value: await countPagesWithPdfjs(x) }),
  openForBatch: async (x) => {
    const r = await openForBatch(
      new File([x as Uint8Array<ArrayBuffer>], "hostile.pdf", {
        type: "application/pdf",
      }),
    );
    return { value: { bytes: r.bytes.length, signatures: r.signatures } };
  },

  /* Hostile PLANS on a well-formed 3-page control (fixture "CTRL"). */
  "plan.extractNeg": async () =>
    files(await extractPages(await three(), [-1, 99, Number.NaN])),
  "plan.deleteNeg": async () =>
    files(await deletePages(await three(), [-1, 3])),
  "plan.deleteAll": async () =>
    files(await deletePages(await three(), [0, 1, 2])),
  "plan.organizeNeg": async () =>
    files(
      await organizePages(await three(), [{ sourceIndex: -1, rotation: 0 }]),
    ),
  "plan.organizeBadRotation": async () =>
    files(
      await organizePages(await three(), [
        { sourceIndex: 2, rotation: Number.NaN as Rotation },
        { sourceIndex: 0, rotation: 45 as Rotation },
      ]),
    ),
  "plan.setRotationsNaN": async () =>
    files(
      await setPageRotations(await three(), [
        Number.NaN,
        45,
        1e9,
      ] as unknown as Rotation[]),
    ),
  "plan.setRotationsShort": async () =>
    files(await setPageRotations(await three(), [90])),
  "plan.rotateTurn45": async () =>
    files(await rotatePages(await three(), [0], 45)),
  "plan.rotateTurnNaN": async () =>
    files(await rotatePages(await three(), [0], Number.NaN)),
  "plan.splitNeg": async () => {
    const out = await splitPdf(await three(), [
      { name: "a.pdf", indices: [-1, 7] },
    ]);
    return {
      files: await Promise.all(out.map((o) => inspect(o.bytes, o.name))),
    };
  },
  "plan.splitNames": async () => ({
    value: buildSplitParts(
      "../..\\evil:name?*",
      [{ start: 0, end: 0 }],
      ["..\\..\\x/\u0000y"],
    ).map((p) => p.name),
  }),
  "plan.oddEvenHuge": async () => {
    const parts = oddEvenParts("x", 2147483647);
    return { value: parts.map((p) => p.indices.length) };
  },
  "plan.mergeNegPages": async () =>
    files(await mergePdfs([await three()], { pages: [[-1, 5]] })),
  "plan.mergeAltNegPages": async () =>
    files(await mergeAlternating([await three()], { pages: [[-1]] })),
  "plan.nUpBadCount": async () =>
    files(
      (
        await nUpPdf(await three(), {
          ...DEFAULT_N_UP_OPTIONS,
          perSheet: 5 as NUpCount,
        })
      ).bytes,
    ),
  "plan.splitHalfNeg": async () =>
    files(
      (
        await splitPagesInHalf(await three(), {
          direction: "top-bottom",
          order: "left-first",
          pages: [-1, 3],
        })
      ).bytes,
    ),
};

/* ------------------------------------------------------------------ *
 *  Main.
 * ------------------------------------------------------------------ */

function startWatchdog(): void {
  const w = new Worker(
    `const { writeSync } = require("node:fs");
     const limit = ${RSS_LIMIT};
     setInterval(() => {
       const rss = process.memoryUsage.rss();
       if (rss > limit) {
         writeSync(1, "@@CELL " + JSON.stringify({ t: "memory", rss }) + "\\n");
         process.kill(process.pid, "SIGKILL");
       }
     }, 20);`,
    { eval: true },
  );
  w.unref();
}

const fixtureCache = new Map<string, Uint8Array>();

async function runCell(cell: PlannedCell): Promise<CellResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let bytes: Uint8Array;
  if (cell.fixture === "CTRL") bytes = await three();
  else {
    const cached = fixtureCache.get(cell.fixture);
    if (cached) bytes = cached;
    else {
      const fx = PAGE_STRUCTURE_FIXTURES.find((f) => f.id === cell.fixture);
      try {
        if (!fx) throw new Error(`no fixture ${cell.fixture}`);
        bytes = await fx.build();
      } catch (e) {
        return { outcome: "fixture-error", message: String(e), ms: ms() };
      }
      fixtureCache.set(cell.fixture, bytes);
    }
  }
  const run = ENGINES[cell.engine];
  if (!run)
    return {
      outcome: "fixture-error",
      message: `no engine ${cell.engine}`,
      ms: ms(),
    };
  try {
    // Engines get a private copy: one may not mutate the next cell's input.
    const r = await run(bytes.slice());
    if (r.files)
      return { outcome: "output", files: r.files, extra: r.extra, ms: ms() };
    return { outcome: "value", value: r.value, ms: ms() };
  } catch (e) {
    const err = e as Error;
    if (err instanceof PdfEngineError) {
      return {
        outcome: "refused",
        name: err.name,
        message: err.message,
        ...(err.kind ? { kind: err.kind } : {}),
        ...(err instanceof PdfEncryptedError ? { verdict: err.verdict } : {}),
        ms: ms(),
      };
    }
    return {
      outcome: "threw",
      name: err?.name ?? typeof e,
      message: String(err?.message ?? e).slice(0, 400),
      at: err?.stack?.split("\n").slice(1, 3).join(" | ").trim().slice(0, 300),
      ms: ms(),
    };
  }
}

async function main(): Promise<void> {
  const plan = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
    cells: PlannedCell[];
    start: number;
  };
  startWatchdog();
  for (let i = plan.start; i < plan.cells.length; i += 1) {
    emit({ t: "start", i });
    const r = await runCell(plan.cells[i]!);
    emit({ t: "done", i, r });
  }
  process.exit(0);
}

if (process.argv[1] && /page-structure\.cells\.ts$/.test(process.argv[1])) {
  void main();
}
