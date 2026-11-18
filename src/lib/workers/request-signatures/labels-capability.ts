/**
 * The start-up proof, published on the heartbeat as `requestSignatureLabels`,
 * that THIS image's Request Signatures writes the label a requester gave a
 * box into prepared.pdf as that box's tooltip (/TU), PR #364.
 *
 * WHY A PROOF AND NOT A FLAG. The worker image ships separately from the web
 * tier (CLAUDE.md rule 5: merging is not shipping), and an image built before
 * #364 still prepares the package but writes the label to manifest.json only.
 * The FAQ said so with a hedge ("If README.txt lists your labels under each
 * signer, prepared.pdf carries them too"), which made every reader adjudicate
 * a live capability by unzipping the package. Only the running image can say
 * what it writes, and an image built before this module publishes no key,
 * which the reader parses as `false`.
 *
 * WHAT IT RUNS. One Request Signatures job through the executor's order
 * (`../capability-chain`: registry, soundness gate, processor, manifest
 * gate) on the registry the daemon builds, holding the daemon's own deps
 * (`signatureRequestDeps()`, the pdf-lib inspector and placer the runtime
 * wires). The job's options are the RAW bag a queued job carries, so the
 * processor's own option parser is a hop too: a parser that dropped `label`
 * fails here. The input is a one-page PDF built in this process; nothing
 * touches disk or the network, and no native tool runs.
 *
 * PASS requires ALL of:
 *   (1) the job is delivered, and its artifact is a ZIP holding prepared.pdf;
 *   (2) prepared.pdf, read with pdf-lib's loader and raw dictionary lookups
 *       (not the placer's writer), has the labelled box
 *       ({@link LABELS_PROBE_FIELD}) with at least one widget, and the /TU
 *       on the field AND on every widget (pdf.js reads only the widget)
 *       decodes to {@link LABELS_PROBE_LABEL}, a non-ASCII label built from
 *       code points, so the UTF-16 text-string path is what is proved;
 *   (3) POSITIVE CONTROL: the unlabelled box ({@link LABELS_PROBE_UNLABELLED_FIELD})
 *       of the same signer has NO /TU on its field or widgets, so (2) read a
 *       per-box label and not a constant written everywhere.
 * Any throw is NO, and so is a run that outlives {@link LABELS_PROBE_TIMEOUT_MS}.
 */
import JSZip from "jszip";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from "pdf-lib";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "../artifacts";
import { runThroughExecutorOrder } from "../capability-chain";
import { createProcessorRegistry } from "../processor";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { REQUEST_SIGNATURES_TOOL, type SignatureRequestDeps } from "./engine";
import { labelsProbePdf } from "./labels-probe-input";
import { signatureRequestDeps } from "./native";

/** How the probe builds its registry: the daemon's own, unless a test swaps it. */
export type LabelsProbeRegistryBuilder = typeof createProcessorRegistry;

/** The label, built from code points: Bengali "naam" (name), then " 1". */
export const LABELS_PROBE_LABEL =
  String.fromCodePoint(0x09a8, 0x09be, 0x09ae) + " 1";

/** The labelled box: signer 1's first text box. */
export const LABELS_PROBE_FIELD = "Signer1-Text-1";

/** The unlabelled box beside it: signer 1's first signature box. */
export const LABELS_PROBE_UNLABELLED_FIELD = "Signer1-Signature-1";

/** The probe's whole run is bounded; a hung placer must not hold start-up. */
export const LABELS_PROBE_TIMEOUT_MS = 15_000;

/** The raw options bag a queued job carries. */
function probeOptions(): Record<string, unknown> {
  return {
    signers: [{ name: "Probe Signer", email: "probe@example.com" }],
    fields: [
      {
        signer: 0,
        page: 1,
        type: "signature",
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.06,
        required: true,
      },
      {
        signer: 0,
        page: 1,
        type: "text",
        x: 0.1,
        y: 0.3,
        width: 0.3,
        height: 0.05,
        required: true,
        label: LABELS_PROBE_LABEL,
      },
    ],
    routing: "parallel",
    deliver: false,
  };
}

/** The /TU of a dict, decoded, or null when it has none (or not a text string). */
function tooltipOf(dict: PDFDict): string | null {
  const tu = dict.lookup(PDFName.of("TU"));
  return tu instanceof PDFHexString || tu instanceof PDFString
    ? tu.decodeText()
    : null;
}

/** A dict's /T, decoded, or null. */
function partialNameOf(dict: PDFDict): string | null {
  const t = dict.lookup(PDFName.of("T"));
  return t instanceof PDFHexString || t instanceof PDFString
    ? t.decodeText()
    : null;
}

/** The dicts in a dict's array entry, skipping anything that is not a dict. */
function dictsIn(dict: PDFDict, key: string): PDFDict[] {
  const array = dict.lookup(PDFName.of(key));
  if (!(array instanceof PDFArray)) return [];
  const out: PDFDict[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const entry = array.lookup(i);
    if (entry instanceof PDFDict) out.push(entry);
  }
  return out;
}

/**
 * The /TU on a field's own dict and on each of its widgets, field first,
 * found by walking the catalogue's /AcroForm /Fields tree by raw dictionary
 * lookups: not pdf-lib's form API, which the placer wrote through. A kid
 * with a /T is a child field; one without is a widget; a field with no
 * widget kids is its own widget (merged), as the PDF spec reads it. Bounded
 * in depth, so a cyclic tree cannot hang the proof.
 */
function tooltipsOf(doc: PDFDocument, name: string): (string | null)[] {
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) throw new Error("no /AcroForm");
  const find = (
    dicts: PDFDict[],
    prefix: string,
    depth: number,
  ): PDFDict | null => {
    if (depth > 16) return null;
    for (const dict of dicts) {
      const partial = partialNameOf(dict);
      if (partial === null) continue;
      const full = prefix ? `${prefix}.${partial}` : partial;
      if (full === name) return dict;
      const kids = dictsIn(dict, "Kids").filter((k) => partialNameOf(k));
      const found = find(kids, full, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const field = find(dictsIn(acroForm, "Fields"), "", 0);
  if (!field) throw new Error(`${name} is not in /AcroForm /Fields`);
  const kids = dictsIn(field, "Kids").filter((k) => partialNameOf(k) === null);
  const widgets =
    kids.length > 0
      ? kids
      : field.lookup(PDFName.of("Subtype")) === PDFName.of("Widget")
        ? [field]
        : [];
  if (widgets.length < 1) throw new Error(`${name} has no widget`);
  return [tooltipOf(field), ...widgets.map((w) => tooltipOf(w))];
}

/** What the independent reader found in a real package's prepared.pdf. */
export interface PreparedTooltips {
  /** The labelled box: field, then each widget. */
  readonly labelled: readonly (string | null)[];
  /** The unlabelled box: field, then each widget. */
  readonly unlabelled: readonly (string | null)[];
}

async function runAndRead(
  env: Record<string, string | undefined>,
  build: LabelsProbeRegistryBuilder,
  soundness: SoundnessGate,
  manifest: ArtifactManifestGate,
  deps: SignatureRequestDeps,
): Promise<PreparedTooltips | null> {
  const registry = build({ requestSignatures: deps });
  const outcome = await runThroughExecutorOrder({
    tool: REQUEST_SIGNATURES_TOOL,
    input: {
      bytes: await labelsProbePdf(),
      filename: "probe.pdf",
      contentType: "application/pdf",
    },
    options: probeOptions(),
    registry,
    env,
    soundness,
    manifest,
  });
  if (outcome.stage !== "delivered") return null;
  const zip = await JSZip.loadAsync(outcome.artifact.bytes);
  const prepared = zip.file("prepared.pdf");
  if (!prepared) return null;
  const doc = await PDFDocument.load(await prepared.async("uint8array"));
  return {
    labelled: tooltipsOf(doc, LABELS_PROBE_FIELD),
    unlabelled: tooltipsOf(doc, LABELS_PROBE_UNLABELLED_FIELD),
  };
}

/**
 * The independent reader's findings for one real job, or null when the job
 * was not delivered. Throws what the run throws; exported so a test can
 * health-check the reader the verdict rests on.
 */
export async function readPreparedTooltips(
  env: Record<string, string | undefined> = process.env,
  build: LabelsProbeRegistryBuilder = createProcessorRegistry,
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
  deps: SignatureRequestDeps = signatureRequestDeps(),
): Promise<PreparedTooltips | null> {
  return runAndRead(env, build, soundness, manifest, deps);
}

/**
 * True when this image's Request Signatures writes a box's label as that
 * box's /TU, on the field and every widget, and writes none on a box with no
 * label. See the header for what is run and read.
 */
export async function provesRequestSignatureLabels(
  env: Record<string, string | undefined> = process.env,
  build: LabelsProbeRegistryBuilder = createProcessorRegistry,
  /** The executor's file-soundness gate, resolved as the daemon's runtime resolves it. */
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  /** The executor's artifact-manifest gate, resolved as the daemon's runtime resolves it. */
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
  /** The deps the daemon's runtime wires into the processor. */
  deps: SignatureRequestDeps = signatureRequestDeps(),
  timeoutMs: number = LABELS_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    // Never keep a process alive for the bound alone.
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    const read = await Promise.race([
      runAndRead(env, build, soundness, manifest, deps),
      timedOut,
    ]);
    if (!read) return false;
    // (2) The label, on the field and every widget.
    if (read.labelled.length < 2) return false;
    if (!read.labelled.every((t) => t === LABELS_PROBE_LABEL)) return false;
    // (3) Positive control: no tooltip where no label was given.
    if (read.unlabelled.length < 2) return false;
    return read.unlabelled.every((t) => t === null);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
