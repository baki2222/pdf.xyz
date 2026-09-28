import { describe, expect, it } from "vitest";
import {
  OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES,
  resolveNativeOfficeConversionConfig,
} from "./native-config";

describe("resolveNativeOfficeConversionConfig — the input cap", () => {
  it("defaults to the published figure", () => {
    expect(resolveNativeOfficeConversionConfig({}).maxInputBytes).toBe(
      OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES,
    );
  });

  /**
   * The Word, Excel and PowerPoint pages state OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES, and the
   * web tier cannot see a worker's env. An override below it would make every
   * one of those pages overstate the cap, so an override may only raise it.
   */
  it("an override cannot lower the cap; one above it is honoured", () => {
    expect(
      resolveNativeOfficeConversionConfig({
        PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES: "1024",
      }).maxInputBytes,
    ).toBe(OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES);
    expect(
      resolveNativeOfficeConversionConfig({
        PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES: String(
          OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES * 2,
        ),
      }).maxInputBytes,
    ).toBe(OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES * 2);
  });
});
