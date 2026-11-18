// @vitest-environment node
/**
 * `provesRequestSignatureLabels`, the start-up proof behind the heartbeat's
 * `requestSignatureLabels` (2026-11-18). It must say YES for the registry
 * this repository builds, and NO for each way an image can lack the feature
 * while still preparing a package: a placer that writes no /TU (every image
 * built before PR #364), a placer that writes the WRONG text, one that
 * writes it on the field but not on the widget pdf.js reads, one that writes
 * a /TU on a box that has no label, an options parser that drops `label`
 * before the engine sees it, a soundness gate that refuses the PDF, a run
 * that never finishes, and a placer that throws. Each NO is a swapped piece
 * around the real one, so the probe's own reading is what is tested.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PDFHexString, PDFName, type PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "../processor";
import type { SecureWorkerProcessorDeps } from "../processor";
import { resolveWorkerArtifactManifest } from "../artifacts";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import type { SignatureRequestDeps } from "./engine";
import { signatureRequestDeps } from "./native";
import {
  LABELS_PROBE_FIELD,
  LABELS_PROBE_LABEL,
  LABELS_PROBE_UNLABELLED_FIELD,
  provesRequestSignatureLabels,
  readPreparedTooltips,
} from "./labels-capability";

const ENV = {};
const soundness = () => resolveWorkerSoundness(ENV);
const manifest = () => resolveWorkerArtifactManifest(ENV);

/** The real deps, with the placer's output rewritten by `edit` before it is returned. */
function editPlaced(
  edit: (doc: PDFDocument) => void | Promise<void>,
): SignatureRequestDeps {
  const real = signatureRequestDeps();
  return {
    ...real,
    place: async (input, fields) => {
      const placed = await real.place!(input, fields);
      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(placed);
      await edit(doc);
      return await doc.save();
    },
  };
}

function fieldDicts(doc: PDFDocument, name: string) {
  const field = doc.getForm().getField(name).acroField;
  return { field: field.dict, widgets: field.getWidgets().map((w) => w.dict) };
}

describe("provesRequestSignatureLabels", () => {
  it("the label is built from code points and is not ASCII (the UTF-16 path is what is proved)", () => {
    expect(LABELS_PROBE_LABEL.length).toBeGreaterThan(0);
    expect(
      [...LABELS_PROBE_LABEL].some((ch) => ch.codePointAt(0)! > 0x7f),
    ).toBe(true);
  });

  it("says YES for the registry and deps the daemon builds", async () => {
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        signatureRequestDeps(),
      ),
    ).resolves.toBe(true);
  });

  it("the independent reader sees the label on the field and its widget of a real package", async () => {
    // Health: the reader the YES rests on reads something, from both dicts.
    const read = await readPreparedTooltips(ENV);
    expect(read).not.toBeNull();
    expect(read!.labelled.length).toBeGreaterThanOrEqual(2);
    expect(read!.labelled.every((t) => t === LABELS_PROBE_LABEL)).toBe(true);
    expect(read!.unlabelled.length).toBeGreaterThanOrEqual(2);
    expect(read!.unlabelled.every((t) => t === null)).toBe(true);
  });

  it("says NO for an image built before #364: the placer writes no /TU", async () => {
    const noTooltip = editPlaced((doc) => {
      const { field, widgets } = fieldDicts(doc, LABELS_PROBE_FIELD);
      for (const d of [field, ...widgets]) d.delete(PDFName.of("TU"));
    });
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        noTooltip,
      ),
    ).resolves.toBe(false);
  });

  it("says NO when the /TU carries the wrong text", async () => {
    const wrong = editPlaced((doc) => {
      const { field, widgets } = fieldDicts(doc, LABELS_PROBE_FIELD);
      for (const d of [field, ...widgets])
        d.set(PDFName.of("TU"), PDFHexString.fromText("Name"));
    });
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        wrong,
      ),
    ).resolves.toBe(false);
  });

  it("says NO when only the field carries it, not the widget pdf.js reads", async () => {
    const fieldOnly = editPlaced((doc) => {
      const { widgets } = fieldDicts(doc, LABELS_PROBE_FIELD);
      for (const d of widgets) d.delete(PDFName.of("TU"));
    });
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        fieldOnly,
      ),
    ).resolves.toBe(false);
  });

  it("says NO when a box with no label gets a /TU too (a constant is not a label)", async () => {
    const everywhere = editPlaced((doc) => {
      const { field, widgets } = fieldDicts(doc, LABELS_PROBE_UNLABELLED_FIELD);
      for (const d of [field, ...widgets])
        d.set(PDFName.of("TU"), PDFHexString.fromText(LABELS_PROBE_LABEL));
    });
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        everywhere,
      ),
    ).resolves.toBe(false);
  });

  it("says NO when the options never carry the label to the engine", async () => {
    // An older options parser dropped unknown keys: the processor receives
    // the job, but `label` is gone before the placer runs.
    const dropsLabel = ((deps: SecureWorkerProcessorDeps) => {
      const real = deps.requestSignatures!;
      return createProcessorRegistry({
        ...deps,
        requestSignatures: {
          ...real,
          place: (input, fields) =>
            real.place!(
              input,
              fields.map((f) => {
                const copy = { ...f };
                delete copy.label;
                return copy;
              }),
            ),
        },
      });
    }) as typeof createProcessorRegistry;
    await expect(
      provesRequestSignatureLabels(
        ENV,
        dropsLabel,
        soundness(),
        manifest(),
        signatureRequestDeps(),
      ),
    ).resolves.toBe(false);
  });

  it("says NO when the soundness gate refuses the job", async () => {
    const refusing: SoundnessGate = {
      ...soundness(),
      check: () => ({ verdict: "unsound", reason: "probe" }) as never,
    };
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        refusing,
        manifest(),
        signatureRequestDeps(),
      ),
    ).resolves.toBe(false);
  });

  it("says NO, and never throws, when the placer throws", async () => {
    const throwing: SignatureRequestDeps = {
      ...signatureRequestDeps(),
      place: async () => {
        throw new Error("boom");
      },
    };
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        throwing,
      ),
    ).resolves.toBe(false);
  });

  it("says NO when the run outlives its time bound", async () => {
    const hanging: SignatureRequestDeps = {
      ...signatureRequestDeps(),
      place: () => new Promise<Uint8Array>(() => {}),
    };
    const started = Date.now();
    await expect(
      provesRequestSignatureLabels(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        hanging,
        50,
      ),
    ).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // Review 2026-11-18: the bound was unref()'d. Inside vitest something else
  // always holds the loop open, so the test above passed; in a process where
  // nothing does (the daemon awaiting its proofs), a run that hung on a pure
  // promise let the process EXIT mid-proof with no verdict at all. So the
  // bound is proved in a fresh process with nothing else alive.
  it("says NO at the bound in a process where nothing else keeps it alive", () => {
    const root = process.cwd();
    const out = execFileSync(
      process.execPath,
      [
        path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(root, "src", "tests", "labels-probe-hang.ts"),
        "300",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    const lines = out
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // Health: the harness printed its two lines, so the process ran to the end.
    expect(lines, out).toHaveLength(2);
    const got = JSON.parse(lines[0]!) as { verdict: unknown; ms: number };
    expect(got.verdict, out).toBe(false);
    expect(got.ms, out).toBeGreaterThanOrEqual(250);
    expect(JSON.parse(lines[1]!), out).toEqual({ after: true });
  }, 60_000);
});
