// One hostile case per process for decode-budget.test.ts (lane l01). The
// parent writes the fixture to a file first, so this process's peak RSS
// before the call is the bare runtime and the reported growth is the entry
// point's alone (building a 1 GiB bomb in-process would hide it).
//
// argv: <entry> <fixture path>
import { readFileSync } from "node:fs";
import { reportResult } from "./bounded";
import { partnerPdf } from "./stamping.fixtures";

const [entry, file] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(file!));
const peakMb = () => process.resourceUsage().maxRSS / 1024;
const before = peakMb();

function describe(err: unknown) {
  const e = err as { name?: string; message?: string; kind?: string };
  return { error: e?.name ?? "unknown", message: e?.message ?? String(err) };
}

async function run(): Promise<unknown> {
  switch (entry) {
    case "load": {
      const { loadPdf } = await import("../../lib/pdf/engine");
      return { pages: (await loadPdf(bytes)).getPageCount() };
    }
    case "rotations": {
      const { getPageRotations } = await import("../../lib/pdf/engine");
      return { pages: (await getPageRotations(bytes)).length };
    }
    case "count": {
      const { countPdfPagesDetailed } =
        await import("../../lib/pdf/page-count");
      return countPdfPagesDetailed(bytes, Number.POSITIVE_INFINITY);
    }
    case "probe": {
      const { probePdf } = await import("../../lib/pdf/probe");
      const p = await probePdf(bytes, { maxBytes: 100 * 1024 * 1024 });
      return { read: p.read, pages: p.pages };
    }
    case "watermark": {
      const { watermarkPdf } = await import("../../lib/pdf/watermark");
      const r = await watermarkPdf(bytes, "DRAFT");
      return { bytes: r.bytes.length };
    }
    case "nup": {
      const { nUpPdf, DEFAULT_N_UP_OPTIONS } =
        await import("../../lib/pdf/n-up");
      const r = await nUpPdf(bytes, { ...DEFAULT_N_UP_OPTIONS, perSheet: 4 });
      return { bytes: r.bytes.length, sheets: r.sheets };
    }
    case "overlay": {
      const { overlayPdf } = await import("../../lib/pdf/overlay");
      const r = await overlayPdf(partnerPdf(), bytes);
      return { bytes: r.bytes.length };
    }
    case "overlay-cycle": {
      // The file is both base and overlay, walked page for page, so every
      // overlay page is embedded into one destination document.
      const { overlayPdf } = await import("../../lib/pdf/overlay");
      const r = await overlayPdf(bytes, bytes, { paging: "cycle" });
      return { bytes: r.bytes.length, pages: r.pageCount };
    }
    case "extract": {
      const { extractPdfImages } = await import("../../lib/pdf/extract-images");
      const r = await extractPdfImages(bytes);
      return {
        images: r.images.map((i) => ({
          name: i.name,
          bytes: i.bytes.length,
          width: i.width,
          height: i.height,
        })),
        skipped: r.skipped,
      };
    }
    case "metadata-edit": {
      const { writePdfMetadata } = await import("../../lib/pdf/metadata");
      const r = await writePdfMetadata(bytes, {
        kind: "edit",
        values: {
          title: "Hostile",
          author: "",
          subject: "",
          keywords: "",
          creator: "",
          producer: "",
          creationDate: null,
          modificationDate: null,
        },
      });
      return { title: r.saved.title, replacedXmp: r.replacedXmp };
    }
    default:
      throw new Error(`unknown entry ${entry}`);
  }
}

run().then(
  (value) => reportResult({ ok: value, growthMb: peakMb() - before }),
  (err) => reportResult({ ...describe(err), growthMb: peakMb() - before }),
);
