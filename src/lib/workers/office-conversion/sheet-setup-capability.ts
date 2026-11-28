/**
 * The start-up proof, published on the heartbeat as
 * `sheetPageSetupAnyFormat`, that THIS image's Excel to PDF applies
 * Orientation and "Fit all columns on the page width" to a .csv, .xls or
 * .ods, not only to an .xlsx (audit wave 2 excel-to-pdf#1, 2026-11-28).
 *
 * WHY A PROOF AND NOT A FLAG. The worker image ships separately from the
 * web tier (CLAUDE.md rule 5), and an image built before this refuses page
 * setup on any file but .xlsx. The panel offers the two controls for those
 * files only while a fresh beat carries this key; an image built before it
 * publishes no key, which the reader parses as `false`.
 *
 * WHAT IT RUNS. Excel to PDF jobs through the executor's order
 * (`../capability-chain`), on the registry the daemon builds, whose Office
 * processor holds the image's OWN LibreOffice runner
 * (`createNativeLibreOfficePdfRunner`). Only the soffice PROCESS and its
 * disk are stand-ins: they record the arguments of each start and the
 * bytes written for it, and answer an .xlsx (for `--convert-to xlsx`) or a
 * PDF (for `pdf`), so a start-up probe launches no office suite.
 *
 * PASS requires ALL of, for a .csv and an .ods sent with Landscape and fit:
 *   (1) delivered, with exactly two soffice starts;
 *   (2) the first converts the upload itself (the file last, its own
 *       extension) to {@link XLSX_CONVERT_TARGET};
 *   (3) the second converts an .xlsx to plain `pdf`, and the workbook it
 *       was handed carries `orientation="landscape"` and `fitToWidth="1"`
 *       in its worksheet's page setup;
 * and the CONTROL: the same .csv with no page setup is ONE start, straight
 * to `pdf` (so the two starts came from the option, and the recorder
 * records).
 *
 * WHAT A PASS DOES NOT MEAN. That the image's LibreOffice saves each format
 * as an .xlsx it then prints landscape with every column on the first page
 * is a property of the real program: `pnpm worker:office-input-proof`
 * (container.yml) converts a .csv and an .ods with the options through the
 * real LibreOffice and reads the PDF's page box and first page's text.
 */
import JSZip from "jszip";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import { runThroughExecutorOrder } from "../capability-chain";
import { createProcessorRegistry } from "../processor";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import {
  createNativeLibreOfficePdfRunner,
  XLSX_CONVERT_TARGET,
  type LibreOfficeExec,
  type LibreOfficeFs,
} from "./native";
import { resolveNativeOfficeConversionConfig } from "./native-config";
import {
  FIT_COLUMNS_TO_WIDTH_OPTION,
  ORIENTATION_OPTION,
} from "./sheet-layout";
import { wideSheetXlsx } from "./sheet-layout-proof";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

/** A two-column CSV. */
export function sheetSetupProbeCsv(): Uint8Array {
  return new TextEncoder().encode("Name,City\nAnna,Riga\n");
}

/** A minimal .ods the content check accepts: its type as the first entry. */
export async function sheetSetupProbeOds(): Promise<Uint8Array> {
  const zip = new JSZip();
  const date = new Date("2026-01-01T00:00:00Z");
  zip.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet", {
    compression: "STORE",
    date,
  });
  // The stand-in soffice never reads it; the content check reads only the
  // mimetype entry above.
  zip.file("content.xml", "<office:document-content/>", { date });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** What the stand-in soffice saw: each start's arguments and input bytes. */
export interface SheetSetupProbeRecorder {
  readonly calls: string[][];
  readonly written: Uint8Array[];
  readonly exec: LibreOfficeExec;
  readonly fs: LibreOfficeFs;
}

export function sheetSetupProbeRecorder(
  xlsx: Uint8Array,
): SheetSetupProbeRecorder {
  const calls: string[][] = [];
  const written: Uint8Array[] = [];
  let n = 0;
  return {
    calls,
    written,
    exec: async (_command, args) => {
      calls.push([...args]);
      return { code: 0, timedOut: false };
    },
    fs: {
      mkdtemp: async (prefix) => `${prefix}probe-${(n += 1)}`,
      writeFile: async (_file, data) => {
        written.push(data);
      },
      readFile: async (file) => (/\.xlsx$/i.test(file) ? xlsx : PDF),
      rm: async () => {},
    },
  };
}

/** How the probe builds its registry: the daemon's own, unless a test swaps it. */
export type SheetSetupProbeRegistryBuilder = typeof createProcessorRegistry;

/**
 * True when this image's Excel to PDF saves a .csv and an .ods as .xlsx,
 * writes the chosen page setup into that .xlsx, and prints it.
 */
export async function provesSheetPageSetupAnyFormat(
  env: Record<string, string | undefined> = process.env,
  build: SheetSetupProbeRegistryBuilder = createProcessorRegistry,
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
): Promise<boolean> {
  try {
    const recorder = sheetSetupProbeRecorder(
      await wideSheetXlsx({ cols: 3, rows: 2 }),
    );
    const config = resolveNativeOfficeConversionConfig(env);
    const libreoffice = createNativeLibreOfficePdfRunner(config, {
      exec: recorder.exec,
      fs: recorder.fs,
      resolveOnPath: () => true,
      fileExists: () => true,
    });
    const registry = build({
      officeConversion: {
        libreoffice,
        limits: {
          maxInputBytes: config.maxInputBytes,
          maxOutputBytes: config.maxOutputBytes,
        },
      },
    });
    const job = (
      bytes: Uint8Array,
      filename: string,
      options: Record<string, unknown>,
    ) =>
      runThroughExecutorOrder({
        tool: "excel-to-pdf",
        input: { bytes, filename, contentType: "application/octet-stream" },
        options,
        registry,
        soundness,
        manifest,
      });
    const target = (args: readonly string[]) =>
      args[args.indexOf("--convert-to") + 1];
    const SETUP = {
      [ORIENTATION_OPTION]: "landscape",
      [FIT_COLUMNS_TO_WIDTH_OPTION]: true,
    };
    const cases = [
      ["probe.csv", sheetSetupProbeCsv()],
      ["probe.ods", await sheetSetupProbeOds()],
    ] as const;
    for (const [filename, bytes] of cases) {
      const from = recorder.calls.length;
      const ran = await job(bytes, filename, SETUP);
      if (ran.stage !== "delivered") return false;
      if (recorder.calls.length !== from + 2) return false;
      const first = recorder.calls[from]!;
      const second = recorder.calls[from + 1]!;
      const ext = filename.slice(filename.lastIndexOf("."));
      if (target(first) !== XLSX_CONVERT_TARGET) return false;
      if (!first.at(-1)?.endsWith(ext)) return false;
      if (target(second) !== "pdf") return false;
      if (!second.at(-1)?.endsWith(".xlsx")) return false;
      const book = await JSZip.loadAsync(recorder.written[from + 1]!);
      const sheet =
        (await book.file("xl/worksheets/sheet1.xml")?.async("string")) ?? "";
      if (!/<pageSetup\b[^>]*\borientation="landscape"/.test(sheet))
        return false;
      if (!/<pageSetup\b[^>]*\bfitToWidth="1"/.test(sheet)) return false;
    }
    // CONTROL: no page setup, one start, straight to PDF.
    const from = recorder.calls.length;
    const plain = await job(sheetSetupProbeCsv(), "probe.csv", {});
    if (plain.stage !== "delivered") return false;
    if (recorder.calls.length !== from + 1) return false;
    return target(recorder.calls[from]!) === "pdf";
  } catch {
    return false;
  }
}
