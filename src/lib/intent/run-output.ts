/**
 * What a run produced, as the result's receipt and its "Continue with" read
 * it: each file's name, type and size at once, its bytes on demand (a
 * receipt re-opens a PDF to count its pages), and a `File` made only when a
 * click carries it to the next tool.
 *
 * Lazy on purpose. A runner holds its output as bytes (or a Blob), and a
 * `File` built from them is a second copy in memory — for a 90 MB merge,
 * 90 MB more the moment the result appeared, whether or not anyone carried
 * it on. Made on the click instead, and once.
 *
 * One object per output, however often the result re-renders: `outputFile`
 * keeps it against the data it wraps (and the name), so a receipt's count
 * runs once per output, not once per render.
 */

export interface OutputFile {
  readonly name: string;
  /** The MIME type the download is saved with; the next tool reads it. */
  readonly type: string;
  readonly size: number;
  /** The bytes, for a re-count. */
  bytes(): Promise<Uint8Array>;
  /** The file a hand-off carries — made on the first call, then kept. */
  file(): File;
}

/** One output, or the several a run produced (a split, a batch). */
export type RunOutput = OutputFile | readonly OutputFile[];

/** The files of an output, as a list. */
export function outputFiles(output: RunOutput): readonly OutputFile[] {
  return Array.isArray(output) ? output : [output as OutputFile];
}

const made = new WeakMap<object, Map<string, OutputFile>>();

/** The output kept against `owner`, made once per type and name. */
function kept(
  owner: object,
  name: string,
  type: string,
  make: () => OutputFile,
): OutputFile {
  let byName = made.get(owner);
  if (!byName) {
    byName = new Map();
    made.set(owner, byName);
  }
  const key = `${type}|${name}`;
  let output = byName.get(key);
  if (!output) {
    output = make();
    byName.set(key, output);
  }
  return output;
}

/** The output a runner's `data` is, saved as `name`. */
export function outputFile(
  data: Uint8Array | Blob,
  name: string,
  type: string = data instanceof Blob && data.type
    ? data.type
    : "application/pdf",
): OutputFile {
  return kept(data, name, type, () => {
    let file: File | null = null;
    return {
      name,
      type,
      size: data instanceof Blob ? data.size : data.byteLength,
      bytes: async () =>
        data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data,
      file: () =>
        (file ??= new File([data as BlobPart], name, {
          type,
          lastModified: Date.now(),
        })),
    };
  });
}

/**
 * A run's text output (a TXT, a Markdown file), kept against the result
 * that holds it — a string cannot key a cache, its result can.
 */
export function textOutputFile(
  owner: object,
  text: string,
  name: string,
  type = "text/plain;charset=utf-8",
): OutputFile {
  return kept(owner, name, type, () => {
    const encoded = new TextEncoder().encode(text);
    let file: File | null = null;
    return {
      name,
      type,
      size: encoded.byteLength,
      bytes: async () => encoded,
      file: () =>
        (file ??= new File([encoded], name, {
          type,
          lastModified: Date.now(),
        })),
    };
  });
}
