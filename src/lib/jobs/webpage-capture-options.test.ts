import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
  WEBPAGE_CAPTURE_LABELS,
  parseWebpageCaptureOptions,
  webpageCaptureOptionsBag,
  type WebpageCaptureOptions,
} from "./webpage-capture-options";

const KEYS = Object.keys(
  DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
) as (keyof WebpageCaptureOptions)[];

describe("Webpage to PDF capture options", () => {
  it("health: there are options to check, each with a label", () => {
    expect(KEYS.length).toBeGreaterThan(0);
    expect(Object.keys(WEBPAGE_CAPTURE_LABELS).sort()).toEqual(
      [...KEYS].sort(),
    );
  });

  it("{} is the render as it always ran, and an untouched panel sends nothing", () => {
    expect(parseWebpageCaptureOptions({ url: "https://example.com/" })).toEqual(
      { ok: true, value: DEFAULT_WEBPAGE_CAPTURE_OPTIONS },
    );
    expect(webpageCaptureOptionsBag(DEFAULT_WEBPAGE_CAPTURE_OPTIONS)).toEqual(
      {},
    );
  });

  it("every option round-trips through the bag the panel sends", () => {
    for (const key of KEYS) {
      const changed = {
        ...DEFAULT_WEBPAGE_CAPTURE_OPTIONS,
        [key]: !DEFAULT_WEBPAGE_CAPTURE_OPTIONS[key],
      };
      const bag = webpageCaptureOptionsBag(changed);
      expect(Object.keys(bag)).toEqual([key]);
      expect(parseWebpageCaptureOptions(bag)).toEqual({
        ok: true,
        value: changed,
      });
    }
  });

  it("refuses a value that is not a boolean, naming the field", () => {
    for (const key of KEYS) {
      const r = parseWebpageCaptureOptions({ [key]: "true" });
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.error.body.error.details?.[0]?.field).toBe(`options.${key}`);
    }
  });
});
