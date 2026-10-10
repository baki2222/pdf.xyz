/**
 * The round-trip fidelity proof: every committed fixture through the REAL PDF
 * to PowerPoint engine, the deck back to PDF through the REAL presentation
 * engine, compared page by page against its source (`./fidelity`) — with both
 * controls required to FAIL the same bound.
 *
 * Run inside the built worker image by `pnpm worker:pptx-fidelity-proof`
 * (`.github/workflows/container.yml`), the one CI place where pdftotext and
 * LibreOffice are both installed: CI's unit job has neither, and no vitest
 * suite runs in the image. Its injectable parts are what the image wires —
 * `pdfOfficeExportDeps` and the LibreOffice runner behind PowerPoint to PDF —
 * and `src/deploy/worker-pptx-fidelity-proof.test.ts` walks the chain from the
 * workflow step to that call.
 *
 * Output is content-free: fixture names, page numbers and scores.
 *
 * ── PARTIAL CONTROLS (since 2026-10-11) ─────────────────────────────────────
 *
 * The blank and text-only decks are GROSS controls: both sit near 1.0, so a
 * bound can fail them and still license a stretched or cropped picture. The
 * review of 2026-10-11 found exactly that. So on every multi-page fixture the
 * faithful deck is also altered in ONE picture on ONE slide — moved 18 pt,
 * stretched 10%, cropped 15% — and each altered deck must FAIL. Each
 * alteration is read back from the slide XML before it is trusted: a control
 * whose mutation did not land is a green that should have been red.
 */
import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  FIDELITY_BOUND,
  roundTripFidelity,
  type FidelityBound,
  type FidelityReport,
  type PptxToPdf,
} from "./fidelity";
import { runPdfOfficeExport, type PdfOfficeExportDeps } from "./engine";

export interface ProofFixture {
  name: string;
  pdf: Uint8Array;
}

export interface PptxFidelityProofDeps {
  /** The engine's deps, as the worker builds them. */
  exportDeps: PdfOfficeExportDeps;
  /** The presentation engine that turns a deck back into a PDF. */
  toPdf: PptxToPdf;
  fixtures: readonly ProofFixture[];
  /**
   * NEGATIVE CONTROL: the text-only deck this tool shipped until 2026-10-10,
   * built from the same extraction. It must FAIL on every fixture.
   */
  textOnlyDeck: (pages: ExtractedPdfText["pages"]) => Promise<Uint8Array>;
  /** NEGATIVE CONTROL: a deck of empty slides, one per page. */
  blankDeck: (pageCount: number) => Promise<Uint8Array>;
  bound?: FidelityBound;
}

/** The partial defects every multi-page fixture's deck is altered into. */
export const PICTURE_ALTERATIONS = ["move18pt", "stretch10", "crop15"] as const;
export type DeckAlteration = (typeof PICTURE_ALTERATIONS)[number];

const EMU_PER_POINT = 12_700;

/**
 * The deck with the LARGEST picture on slide `slide` (1-based) altered one
 * way, and whether the alteration is in the slide XML afterwards (read back,
 * not assumed). Only that one `p:pic` changes.
 */
export async function alterDeckPicture(
  pptx: Uint8Array,
  slide: number,
  kind: DeckAlteration,
): Promise<{ bytes: Uint8Array; landed: boolean; detail: string }> {
  const zip = await JSZip.loadAsync(pptx);
  const part = `ppt/slides/slide${slide}.xml`;
  const xml = (await zip.file(part)?.async("string")) ?? "";
  const pics = xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
  const area = (pic: string) => {
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(pic);
    return ext ? Number(ext[1]) * Number(ext[2]) : 0;
  };
  const target = pics
    .filter((p) => /<p:cNvPr [^>]*name="Picture /.test(p))
    .sort((a, b) => area(b) - area(a))[0];
  if (!target)
    return {
      bytes: pptx,
      landed: false,
      detail: `no picture on slide ${slide}`,
    };
  let altered = target;
  let want = "";
  if (kind === "move18pt") {
    altered = target.replace(/<a:off x="(-?\d+)"/, (_, x: string) => {
      want = `<a:off x="${Number(x) + 18 * EMU_PER_POINT}"`;
      return want;
    });
  } else if (kind === "stretch10") {
    altered = target.replace(/<a:ext cx="(\d+)"/, (_, cx: string) => {
      want = `<a:ext cx="${Math.round(Number(cx) * 1.1)}"`;
      return want;
    });
  } else {
    const src = /<a:srcRect([^/]*)\/>/.exec(target);
    const attr = (name: string) =>
      Number(new RegExp(`${name}="(-?\\d+)"`).exec(src?.[1] ?? "")?.[1] ?? 0);
    const [l, t, r, b] = ["l", "t", "r", "b"].map(attr) as [
      number,
      number,
      number,
      number,
    ];
    // 15% more of what shows is cut from the right.
    const right = Math.round(r + 0.15 * (100_000 - l - r));
    want = `<a:srcRect l="${l}" t="${t}" r="${right}" b="${b}"/>`;
    altered = src
      ? target.replace(src[0], want)
      : target.replace(
          /(<a:blip [^>]*\/>|<a:blip [\s\S]*?<\/a:blip>)/,
          `$1${want}`,
        );
  }
  const next = xml.replace(target, altered);
  zip.file(part, next);
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const readBack =
    (await (await JSZip.loadAsync(bytes)).file(part)?.async("string")) ?? "";
  const landed = want !== "" && altered !== target && readBack.includes(want);
  return {
    bytes,
    landed,
    detail: landed
      ? `${kind} on slide ${slide}`
      : `${kind} did not land on slide ${slide}`,
  };
}

export interface PptxFidelityProofResult {
  ok: boolean;
  lines: string[];
}

const fmt = (r: FidelityReport) =>
  `${r.pass ? "PASS" : "FAIL"} ${r.detail} [${r.pages.map((p) => p.score.toFixed(3)).join(" ")}]${r.pictures.length ? ` pictures [${r.pictures.map((p) => `p${p.page}:${p.score.toFixed(3)}`).join(" ")}]` : ""}`;

export async function runPptxFidelityProof(
  deps: PptxFidelityProofDeps,
): Promise<PptxFidelityProofResult> {
  const bound = deps.bound ?? FIDELITY_BOUND;
  const lines: string[] = [];
  let partials = 0;
  let ok = deps.fixtures.length >= 4;
  if (!ok)
    lines.push(
      `only ${deps.fixtures.length} fixture(s): too few to prove anything`,
    );
  for (const fixture of deps.fixtures) {
    const run = await runPdfOfficeExport(
      "pdf-to-powerpoint",
      fixture.pdf,
      deps.exportDeps,
    );
    if (!run.ok) {
      ok = false;
      lines.push(`${fixture.name}: export FAILED (${run.kind})`);
      continue;
    }
    const subject = await roundTripFidelity(
      fixture.pdf,
      run.output,
      deps.toPdf,
      bound,
    );
    lines.push(`${fixture.name}: faithful deck ${fmt(subject)}`);
    if (!subject.pass) ok = false;

    // The controls go through the SAME comparator and bound, or they prove
    // nothing about it.
    const extract = deps.exportDeps.extract;
    const pages = extract ? (await extract(fixture.pdf)).pages : [];
    const textOnly = await roundTripFidelity(
      fixture.pdf,
      await deps.textOnlyDeck(pages),
      deps.toPdf,
      bound,
    );
    lines.push(`${fixture.name}: text-only control ${fmt(textOnly)}`);
    if (textOnly.pass) {
      ok = false;
      lines.push(
        `${fixture.name}: the text-only control PASSED — the bound cannot see a missing picture`,
      );
    }
    const blank = await roundTripFidelity(
      fixture.pdf,
      await deps.blankDeck(run.meta.pageCount),
      deps.toPdf,
      bound,
    );
    lines.push(`${fixture.name}: blank control ${fmt(blank)}`);
    if (blank.pass) {
      ok = false;
      lines.push(
        `${fixture.name}: the blank control PASSED — the bound cannot see an empty slide`,
      );
    }

    // Partial controls: one picture on one slide, wrong in one way.
    if (run.meta.pageCount < 2) continue;
    partials++;
    for (const kind of PICTURE_ALTERATIONS) {
      const altered = await alterDeckPicture(run.output, 2, kind);
      if (!altered.landed) {
        ok = false;
        lines.push(
          `${fixture.name}: the ${kind} control is broken — ${altered.detail}`,
        );
        continue;
      }
      const report = await roundTripFidelity(
        fixture.pdf,
        altered.bytes,
        deps.toPdf,
        bound,
      );
      lines.push(`${fixture.name}: ${altered.detail} control ${fmt(report)}`);
      if (report.pass) {
        ok = false;
        lines.push(
          `${fixture.name}: the ${kind} control PASSED — the bound licenses a ${kind} picture`,
        );
      }
    }
  }
  if (partials === 0) {
    ok = false;
    lines.push("no multi-page fixture: the partial controls never ran");
  }
  return { ok, lines };
}
