/**
 * The start-up proof, published on the heartbeat as `csvImportOptions`, that
 * THIS image's Excel to PDF opens a .csv with the delimiter and character
 * set the job chose (competitor audit #18), and refuses a value it does not
 * know.
 *
 * WHY A PROOF AND NOT A FLAG. The worker image ships separately from the web
 * tier (CLAUDE.md rule 5: merging is not shipping), and an image built before
 * the choices IGNORES `csvDelimiter` and `csvCharset` (its option parser is
 * lenient to unknown keys): it reads every CSV as comma separated and prints
 * a semicolon file as one column. Only the running image can say what it
 * does with the keys, and an image built before this module publishes no
 * key, which the reader parses as `false`.
 *
 * WHAT IT RUNS. Excel to PDF jobs through the executor's order
 * (`../capability-chain`: registry, soundness gate, processor, manifest
 * gate), on the registry the daemon builds, whose Office processor holds the
 * image's OWN LibreOffice runner (`createNativeLibreOfficePdfRunner`, the one
 * that builds the `--infilter` argument). Only the soffice PROCESS is a
 * stand-in: it records the arguments it was handed and writes a PDF, so a
 * start-up probe launches no office suite and touches no disk.
 *
 * PASS requires ALL of:
 *   (1) a semicolon CSV in Windows-1251, sent with `semicolon` and
 *       `windows-1251`: delivered, and soffice was handed
 *       `--infilter=Text - txt - csv (StarCalc):59,34,34,1` before
 *       `--convert-to`, the file last;
 *   (2) POSITIVE CONTROL, the same bytes with no choice: delivered with
 *       `59,34,1,1` — Auto-detect found the semicolon and Auto read the
 *       bytes as Windows-1252, the import LibreOffice made with no options.
 *       So (1)'s `34` came from the choice, not from the file, and the
 *       recorder records;
 *   (3) `tab` and `utf-16` on a tab-separated UTF-16 file: `9,34,65535,1`;
 *   (4) an unknown delimiter, and an unknown character set: each fails as
 *       `unprocessable_entity`, not retryable, with soffice never started.
 *
 * WHAT A PASS DOES NOT MEAN. soffice is a stand-in: that LibreOffice reads
 * these codes as the separators and character sets they name is proven in
 * the image by `pnpm worker:office-input-proof` (container.yml), which
 * converts one CSV per choice with the real LibreOffice and reads the PDF,
 * each beside a control with the wrong choice that must come out wrong.
 */
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import { runThroughExecutorOrder } from "../capability-chain";
import { createProcessorRegistry } from "../processor";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { CSV_CHARSET_OPTION, CSV_DELIMITER_OPTION } from "./csv-import";
import { csvInfilter } from "./csv-filter";
import {
  createNativeLibreOfficePdfRunner,
  type LibreOfficeExec,
  type LibreOfficeFs,
} from "./native";
import { resolveNativeOfficeConversionConfig } from "./native-config";

/** How the probe builds its registry: the daemon's own, unless a test swaps it. */
export type CsvProbeRegistryBuilder = typeof createProcessorRegistry;

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

/** Windows-1251 for ASCII and the Cyrillic capitals and smalls (U+0410-U+044F). */
function windows1251(text: string): Uint8Array {
  return Uint8Array.from([...text], (ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    throw new Error("outside this helper's range");
  });
}

/** UTF-16LE with its byte-order mark. */
function utf16le(text: string): Uint8Array {
  const out = [0xff, 0xfe];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return Uint8Array.from(out);
}

const CYRILLIC = (from: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => from + i));

/** A semicolon CSV whose cells are Cyrillic, built from code points. */
export function csvProbeSemicolon1251(): Uint8Array {
  const a = CYRILLIC(0x410, 4);
  const b = CYRILLIC(0x430, 5);
  return windows1251(`${a};${b};1,5\n${b};${a};2,5\n`);
}

/** A tab-separated UTF-16LE CSV. */
export function csvProbeTabUtf16(): Uint8Array {
  return utf16le("Name\tCity\nAnna\tRiga\n");
}

/** The arguments the stand-in soffice was handed, one array per start. */
export interface CsvProbeRecorder {
  readonly calls: string[][];
  readonly exec: LibreOfficeExec;
  readonly fs: LibreOfficeFs;
}

export function csvProbeRecorder(): CsvProbeRecorder {
  const calls: string[][] = [];
  let n = 0;
  return {
    calls,
    exec: async (_command, args) => {
      calls.push([...args]);
      return { code: 0, timedOut: false };
    },
    fs: {
      mkdtemp: async (prefix) => `${prefix}probe-${(n += 1)}`,
      writeFile: async () => {},
      readFile: async () => PDF,
      rm: async () => {},
    },
  };
}

/**
 * True when this image's Excel to PDF hands LibreOffice the CSV filter the
 * job chose, resolves Auto from the file, and refuses an unknown choice.
 */
export async function provesCsvImportOptions(
  env: Record<string, string | undefined> = process.env,
  build: CsvProbeRegistryBuilder = createProcessorRegistry,
  /** The executor's file-soundness gate, resolved as the daemon's runtime resolves it. */
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  /** The executor's artifact-manifest gate, resolved as the daemon's runtime resolves it. */
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
  recorder: CsvProbeRecorder = csvProbeRecorder(),
): Promise<boolean> {
  try {
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
    const job = (bytes: Uint8Array, options: Record<string, unknown>) =>
      runThroughExecutorOrder({
        tool: "excel-to-pdf",
        input: { bytes, filename: "probe.csv", contentType: "text/csv" },
        options,
        registry,
        soundness,
        manifest,
      });
    const starts = (): number => recorder.calls.length;
    /** The one start's `--infilter` value, if it was handed one in the right place. */
    const filterOf = (args: readonly string[] | undefined) => {
      if (!args) return null;
      const at = args.findIndex((a) => a.startsWith("--infilter="));
      if (at < 0 || at > args.indexOf("--convert-to")) return null;
      if (!args.at(-1)?.endsWith("input.csv")) return null;
      return args[at]!.slice("--infilter=".length);
    };

    // (1) The choice reaches LibreOffice.
    const chosen = await job(csvProbeSemicolon1251(), {
      [CSV_DELIMITER_OPTION]: "semicolon",
      [CSV_CHARSET_OPTION]: "windows-1251",
    });
    if (chosen.stage !== "delivered" || starts() !== 1) return false;
    if (
      filterOf(recorder.calls[0]) !== csvInfilter("semicolon", "windows-1251")
    )
      return false;

    // (2) Positive control: Auto, on the same bytes.
    const auto = await job(csvProbeSemicolon1251(), {});
    if (auto.stage !== "delivered" || starts() !== 2) return false;
    if (
      filterOf(recorder.calls[1]) !== csvInfilter("semicolon", "windows-1252")
    )
      return false;

    // (3) Tab and UTF-16.
    const tab = await job(csvProbeTabUtf16(), {
      [CSV_DELIMITER_OPTION]: "tab",
      [CSV_CHARSET_OPTION]: "utf-16",
    });
    if (tab.stage !== "delivered" || starts() !== 3) return false;
    if (filterOf(recorder.calls[2]) !== csvInfilter("tab", "utf-16"))
      return false;

    // (4) Unknown values: refused, finally, before soffice starts.
    for (const options of [
      { [CSV_DELIMITER_OPTION]: "colon" },
      { [CSV_CHARSET_OPTION]: "koi8-r" },
    ]) {
      const refused = await job(csvProbeSemicolon1251(), options);
      if (refused.stage !== "failed") return false;
      if (refused.result.error.code !== "unprocessable_entity") return false;
      if (refused.result.error.retryable) return false;
    }
    return starts() === 3;
  } catch {
    return false;
  }
}
