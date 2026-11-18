// @vitest-environment node
// @native-canvas
/**
 * `provesOcrOwnerPassword` — the start-up proof behind the heartbeat's
 * `ocrOwnerPassword`. It must say YES for the registry this repository
 * builds, and NO for each way an image can lack the feature while still
 * running OCR: a processor that drops the job's options (every image built
 * before the feature: its parser ignored unknown keys), a runner with no
 * qpdf, a runner whose password check lets a wrong password through, a host
 * without qpdf, and the soundness gate refusing the file. Each NO is a
 * swapped piece around the real one, so the probe's own reading is tested.
 *
 * And the probe's input is held to an INDEPENDENT reader: pdf.js (which
 * shares no code with the in-house handler that built and checks it) opens
 * it with no password and reports exactly the grant {@link PROBE_P} names.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { openHandler } from "@/lib/pdf/security/document";
import { createProcessorRegistry } from "./processor";
import type { SecureWorkerProcessorDeps } from "./processor";
import type { OcrRunner } from "./processor/ocr";
import { resolveWorkerSoundness, type SoundnessGate } from "./soundness";
import { resolveWorkerArtifactManifest } from "./artifacts";
import {
  PROBE_GRANT_SWITCHES,
  PROBE_OWNER_PASSWORD,
  PROBE_P,
  provesOcrOwnerPassword,
  restrictedProbePdf,
  type OwnerProbeRegistryBuilder,
} from "./ocr-owner-capability";
import { ownerOnlyEncryptArgs } from "./pdf-security/native";
import { qpdfGrantFromP } from "./pdf-security/permission-bits";

const ENV = {};
const soundness = () => resolveWorkerSoundness(ENV);
const manifest = () => resolveWorkerArtifactManifest(ENV);
const present = () => true;

const prove = (
  build: OwnerProbeRegistryBuilder = createProcessorRegistry,
  gate: SoundnessGate = soundness(),
  qpdf: () => boolean = present,
) => provesOcrOwnerPassword(ENV, build, gate, manifest(), qpdf);

/** The real registry, with the OCR runner wrapped. */
function wrapRunner(wrap: (real: OcrRunner) => OcrRunner) {
  return ((deps: SecureWorkerProcessorDeps) =>
    createProcessorRegistry({
      ...deps,
      ocr: { ...deps.ocr!, runner: wrap(deps.ocr!.runner!) },
    })) as OwnerProbeRegistryBuilder;
}

describe("provesOcrOwnerPassword", () => {
  it("answers YES on this tree's registry (the image's own runners)", async () => {
    expect(await prove()).toBe(true);
  });

  it("answers NO without qpdf on the host (presence leg)", async () => {
    expect(await prove(createProcessorRegistry, soundness(), () => false)).toBe(
      false,
    );
  });

  it("answers NO for a processor that drops the job's options (an image built before the key)", async () => {
    const drops = wrapRunner(
      (real) => (input) =>
        real({
          ...input,
          options: { ...input.options, ownerPassword: undefined },
        }),
    );
    expect(await prove(drops)).toBe(false);
  });

  it("answers NO for a runner that lets a wrong password through as the owner's", async () => {
    // The check is skipped by swapping every password for the right one: a
    // runner that would lift restrictions on a password it never verified.
    const lax = wrapRunner(
      (real) => (input) =>
        real({
          ...input,
          options: input.options.ownerPassword
            ? { ...input.options, ownerPassword: PROBE_OWNER_PASSWORD }
            : input.options,
        }),
    );
    expect(await prove(lax)).toBe(false);
  });

  it("answers NO when the soundness gate refuses the file", async () => {
    const refusing: SoundnessGate = {
      ...soundness(),
      check: () => ({ verdict: "unsound", reason: "probe" }) as never,
    };
    expect(await prove(createProcessorRegistry, refusing)).toBe(false);
  });
});

describe("the probe file, read by an independent decryptor", () => {
  it("opens in pdf.js with no password, and pdf.js reports the grant PROBE_P names", async () => {
    const require = createRequire(import.meta.url);
    const pdfjs = (await import(
      pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
    )) as typeof import("pdfjs-dist");
    const task = pdfjs.getDocument({ data: restrictedProbePdf() });
    const doc = await task.promise;
    try {
      expect(doc.numPages).toBe(1);
      // print 4, comments 32, forms 256, accessibility 512.
      expect(
        ((await doc.getPermissions()) ?? []).sort((a, b) => a - b),
      ).toEqual([4, 32, 256, 512]);
    } finally {
      await task.destroy();
    }
  });

  it("the in-house handler: no password opens it as user, the probe password as owner", async () => {
    const bytes = restrictedProbePdf();
    const free = await openHandler(bytes, "");
    expect(free.handler?.authenticatedAs).toBe("user");
    expect(free.params.p).toBe(PROBE_P);
    expect(free.params.r).toBe(3);
    expect(
      (await openHandler(bytes, PROBE_OWNER_PASSWORD)).handler?.authenticatedAs,
    ).toBe("owner");
    expect((await openHandler(bytes, "not-it")).handler).toBeNull();
  });

  it("the literal switches and the argv builder agree on PROBE_P, both ways", () => {
    const argv = ownerOnlyEncryptArgs("in", "out", {
      ownerPassword: "x",
      grant: qpdfGrantFromP(PROBE_P, 3),
    });
    const switches = argv.filter((a) =>
      /^--(print|modify-other|extract|annotate|form|assemble)=/.test(a),
    );
    expect(switches).toEqual([...PROBE_GRANT_SWITCHES]);
  });
});
