/**
 * Audit wave 2 excel-to-pdf#1 (2026-11-28): `provesSheetPageSetupAnyFormat`,
 * the heartbeat's `sheetPageSetupAnyFormat`. True for this tree; false for
 * a processor that still refuses page setup on a .csv (the image before),
 * and false when the recorder records nothing (health).
 */
import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "../processor";
import type { LibreOfficePdfRunner } from "./engine";
import { provesSheetPageSetupAnyFormat } from "./sheet-setup-capability";

const ENV = {};

describe("provesSheetPageSetupAnyFormat (excel-to-pdf#1)", () => {
  it("is true for the engine and runner in this tree", async () => {
    await expect(provesSheetPageSetupAnyFormat(ENV)).resolves.toBe(true);
  });

  it("NEGATIVE: a runner without the .xlsx step (an older image) answers false", async () => {
    const older: typeof createProcessorRegistry = (deps) => {
      const lo = deps?.officeConversion?.libreoffice;
      if (!lo) return createProcessorRegistry(deps);
      const withoutXlsx: LibreOfficePdfRunner = {
        convertToPdf: (...args) => lo.convertToPdf(...args),
      };
      return createProcessorRegistry({
        ...deps,
        officeConversion: {
          ...deps.officeConversion,
          libreoffice: withoutXlsx,
        },
      });
    };
    await expect(provesSheetPageSetupAnyFormat(ENV, older)).resolves.toBe(
      false,
    );
  });

  it("NEGATIVE: a runner whose .xlsx step returns the workbook without the page setup answers false", async () => {
    const unwritten: typeof createProcessorRegistry = (deps) => {
      const lo = deps?.officeConversion?.libreoffice;
      if (!lo?.convertToXlsx) return createProcessorRegistry(deps);
      // The PDF step is handed the .xlsx soffice wrote, not the rewritten
      // one: the order the engine must not use.
      let lastXlsx: Uint8Array | null = null;
      const runner: LibreOfficePdfRunner = {
        convertToXlsx: async (...args) =>
          (lastXlsx = await lo.convertToXlsx!(...args)),
        convertToPdf: (input, ...rest) =>
          lo.convertToPdf(lastXlsx ?? input, ...rest),
      };
      return createProcessorRegistry({
        ...deps,
        officeConversion: { ...deps!.officeConversion, libreoffice: runner },
      });
    };
    await expect(provesSheetPageSetupAnyFormat(ENV, unwritten)).resolves.toBe(
      false,
    );
  });
});
