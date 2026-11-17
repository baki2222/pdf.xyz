// @vitest-environment node
/**
 * `provesCsvImportOptions` — the start-up proof behind the heartbeat's
 * `csvImportOptions`. It must say YES for the registry this repository
 * builds, and NO for each way an image can lack the feature while still
 * converting CSVs: a processor that drops the job's options (every image
 * built before the feature: its parser ignored unknown keys), a runner that
 * ignores the choice and keeps the old UTF-8-only rule, one that reads an
 * unknown value as Auto, and the soundness gate refusing the CSV. Each NO is
 * a swapped piece around the real one, so the probe's own reading is what
 * is tested.
 */
import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "../processor";
import type { SecureWorkerProcessorDeps } from "../processor";
import { resolveWorkerSoundness, type SoundnessGate } from "../soundness";
import { resolveWorkerArtifactManifest } from "../artifacts";
import {
  csvProbeRecorder,
  provesCsvImportOptions,
  type CsvProbeRegistryBuilder,
} from "./csv-capability";
import type { LibreOfficePdfRunner } from "./engine";

const ENV = {};
const soundness = () => resolveWorkerSoundness(ENV);
const manifest = () => resolveWorkerArtifactManifest(ENV);

/** The real registry, with the Office runner wrapped. */
function wrapRunner(
  wrap: (real: LibreOfficePdfRunner) => LibreOfficePdfRunner,
): CsvProbeRegistryBuilder {
  return ((deps: SecureWorkerProcessorDeps) =>
    createProcessorRegistry({
      ...deps,
      officeConversion: {
        ...deps.officeConversion!,
        libreoffice: wrap(deps.officeConversion!.libreoffice!),
      },
    })) as CsvProbeRegistryBuilder;
}

describe("provesCsvImportOptions", () => {
  it("says YES for the registry the daemon builds, and records three starts", async () => {
    const recorder = csvProbeRecorder();
    await expect(
      provesCsvImportOptions(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        recorder,
      ),
    ).resolves.toBe(true);
    // Health: the recorder saw the starts the YES rests on.
    expect(recorder.calls).toHaveLength(3);
    expect(recorder.calls[0]).toContain(
      "--infilter=Text - txt - csv (StarCalc):59,34,34,1,,0,false,false",
    );
  });

  it("says NO for an image built before the feature: the options never reach the runner", async () => {
    const dropsOptions = wrapRunner((real) => ({
      convertToPdf: (input, filename, run, layout) =>
        real.convertToPdf(input, filename, run, layout),
    }));
    await expect(provesCsvImportOptions(ENV, dropsOptions)).resolves.toBe(
      false,
    );
  });

  it("says NO when the runner ignores the chosen character set", async () => {
    const keepsAutoCharset = wrapRunner((real) => ({
      convertToPdf: (input, filename, run, layout, csv) =>
        real.convertToPdf(
          input,
          filename,
          run,
          layout,
          csv ? { ...csv, charset: null } : csv,
        ),
    }));
    await expect(provesCsvImportOptions(ENV, keepsAutoCharset)).resolves.toBe(
      false,
    );
  });

  it("says NO when an unknown value is read as Auto instead of refused", async () => {
    const lenient = ((deps: SecureWorkerProcessorDeps) => {
      const real = createProcessorRegistry(deps);
      const office = real.resolve("excel-to-pdf")!;
      const known = new Set([
        "comma",
        "semicolon",
        "tab",
        "pipe",
        "utf-8",
        "windows-1252",
        "iso-8859-2",
        "windows-1251",
        "shift-jis",
        "utf-16",
      ]);
      const registry = createProcessorRegistry({});
      registry.register({
        ...office,
        process: (input) =>
          office.process({
            ...input,
            options: Object.fromEntries(
              Object.entries(input.options).filter(
                ([, v]) => typeof v !== "string" || known.has(v),
              ),
            ),
          }),
      });
      return registry;
    }) as CsvProbeRegistryBuilder;
    await expect(provesCsvImportOptions(ENV, lenient)).resolves.toBe(false);
  });

  it("says NO when the executor's soundness gate would refuse the CSV", async () => {
    const real = soundness();
    const refusing: SoundnessGate = {
      capability: () => real.capability(),
      check: () => ({ verdict: "unsound", reason: "unsupported_family" }),
    } as unknown as SoundnessGate;
    await expect(
      provesCsvImportOptions(ENV, createProcessorRegistry, refusing),
    ).resolves.toBe(false);
  });

  it("says NO when the recorder records nothing (the positive control cannot be vacuous)", async () => {
    const blind = csvProbeRecorder();
    const deaf = {
      ...blind,
      exec: async () => ({ code: 0, timedOut: false }),
    };
    await expect(
      provesCsvImportOptions(
        ENV,
        createProcessorRegistry,
        soundness(),
        manifest(),
        deaf,
      ),
    ).resolves.toBe(false);
  });
});
