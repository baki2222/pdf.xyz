/**
 * Does THIS worker image carry a title like "Annual report (2025)" or an
 * author like "José Müller" into the PDF/A copy (audit wave 2,
 * pdf-to-pdfa#3)?
 *
 * Ghostscript 10.00.0 drops such values from both Info and XMP; the worker
 * now writes them after Ghostscript (`./docinfo-xmp`). The web tier
 * auto-deploys and the worker image ships separately (CLAUDE.md rule 5), so
 * whether the RUNNING worker does is a live capability: the PDF to PDF/A
 * panel's notes state the wider rule only while the heartbeat carries
 * `pdfaUnicodeDocInfo: true`, and this is the proof it is published from.
 *
 * ONE REAL JOB, in the executor's order (`../capability-chain`): the
 * file-soundness gate, the daemon's own `pdf-to-pdfa` processor on
 * `nativePdfArchiveDeps(env)` — the REAL Ghostscript and ICC profile of this
 * image — then the artifact-manifest gate. The delivered file is read back
 * with pdf-lib (Info) and as XML text (the XMP packet). True only when all
 * four fields hold the input's exact strings in BOTH places. No Ghostscript
 * (a host without it), any throw, or a run past
 * {@link PDFA_DOCINFO_PROBE_TIMEOUT_MS} is false.
 */
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import { proveThroughExecutorOrder } from "../capability-chain";
import { createProcessorRegistry } from "../processor";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { nativePdfArchiveDeps } from "./native";
import type { PdfArchiveDeps } from "./engine";

/** What the probe writes into its input, each a value gs 10.00.0 drops. */
export const PDFA_DOCINFO_PROBE = {
  Title: "Annual report (2025)",
  Author: "José Müller",
  Subject: "Back\\slash and “quotes”",
  Keywords: "café, naïve",
} as const;

/** A real Ghostscript conversion of a one-page PDF; generous on a slow host. */
export const PDFA_DOCINFO_PROBE_TIMEOUT_MS = 60_000;

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** One XMP property's text: an Alt/Seq's first item, or a simple value. */
function xmpValue(xml: string, tag: string): string | undefined {
  const el = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(
    xml,
  )?.[1];
  if (el !== undefined) {
    const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(el)?.[1];
    return unescapeXml(li ?? el);
  }
  const attr = new RegExp(`\\s${tag}="([^"]*)"`).exec(xml)?.[1];
  return attr === undefined ? undefined : unescapeXml(attr);
}

async function probeInput(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle(PDFA_DOCINFO_PROBE.Title);
  doc.setAuthor(PDFA_DOCINFO_PROBE.Author);
  doc.setSubject(PDFA_DOCINFO_PROBE.Subject);
  doc.setKeywords([PDFA_DOCINFO_PROBE.Keywords]);
  return doc.save();
}

/** True when `pdf`'s Info AND XMP hold every probe value exactly. */
export async function holdsProbeDocInfo(pdf: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (
    doc.getTitle() !== PDFA_DOCINFO_PROBE.Title ||
    doc.getAuthor() !== PDFA_DOCINFO_PROBE.Author ||
    doc.getSubject() !== PDFA_DOCINFO_PROBE.Subject ||
    doc.getKeywords() !== PDFA_DOCINFO_PROBE.Keywords
  )
    return false;
  const ref = doc.catalog.get(PDFName.of("Metadata"));
  if (!(ref instanceof PDFRef)) return false;
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return false;
  const raw = stream.dict.get(PDFName.of("Filter"))
    ? inflateSync(stream.contents)
    : stream.contents;
  const xml = new TextDecoder().decode(raw);
  return (
    xmpValue(xml, "dc:title") === PDFA_DOCINFO_PROBE.Title &&
    xmpValue(xml, "dc:creator") === PDFA_DOCINFO_PROBE.Author &&
    xmpValue(xml, "dc:description") === PDFA_DOCINFO_PROBE.Subject &&
    xmpValue(xml, "pdf:Keywords") === PDFA_DOCINFO_PROBE.Keywords
  );
}

export async function provesPdfaUnicodeDocInfo(
  env: Record<string, string | undefined> = process.env,
  deps: PdfArchiveDeps = nativePdfArchiveDeps(env),
  build: typeof createProcessorRegistry = createProcessorRegistry,
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
  timeoutMs: number = PDFA_DOCINFO_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (!deps.ghostscript) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const registry = build({ pdfArchive: deps });
    const run = async () => {
      const artifact = await proveThroughExecutorOrder({
        tool: "pdf-to-pdfa",
        input: {
          bytes: await probeInput(),
          filename: "probe.pdf",
          contentType: "application/pdf",
        },
        options: { standard: "PDF/A-2b" },
        registry,
        soundness,
        manifest,
      });
      return artifact ? holdsProbeDocInfo(artifact.bytes) : false;
    };
    return (await Promise.race([run(), timedOut])) === true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
