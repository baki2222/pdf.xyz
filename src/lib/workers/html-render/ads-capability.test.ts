/**
 * `htmlAdBlock`'s start-up proof (audit wave 2, webpage-to-pdf#1): true on
 * this image, and false on each defect it exists to catch — the option not
 * reaching the renderer, always on, a request test that blocks nothing or
 * everything, and a slot script without the selectors.
 */
import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "../processor";
import { provesHtmlAdBlock } from "./ads-capability";
import { HIDE_ADS_SCRIPT, isAdRequestUrl } from "./ads";

type Build = typeof createProcessorRegistry;

/** The daemon's registry with the renderer's capture argument rewritten. */
const rewriting =
  (
    rewrite: (capture: Record<string, unknown>) => Record<string, unknown>,
  ): Build =>
  (deps) =>
    createProcessorRegistry({
      ...deps,
      htmlRender: {
        ...deps?.htmlRender,
        chromium: {
          ...deps!.htmlRender!.chromium!,
          renderUrl: (url, options, run, capture) =>
            deps!.htmlRender!.chromium!.renderUrl(
              url,
              options,
              run,
              capture && (rewrite({ ...capture }) as never),
            ),
        },
      },
    });

describe("provesHtmlAdBlock", () => {
  it("passes on this image", async () => {
    expect(await provesHtmlAdBlock()).toBe(true);
  });

  it("fails when the option never reaches the renderer (an older image)", async () => {
    expect(
      await provesHtmlAdBlock(rewriting((c) => ({ ...c, hideAds: false }))),
    ).toBe(false);
  });

  it("fails when ads are always blocked", async () => {
    expect(
      await provesHtmlAdBlock(rewriting((c) => ({ ...c, hideAds: true }))),
    ).toBe(false);
  });

  it("fails on a request test that blocks nothing, or everything", async () => {
    expect(await provesHtmlAdBlock(createProcessorRegistry, () => false)).toBe(
      false,
    );
    expect(await provesHtmlAdBlock(createProcessorRegistry, () => true)).toBe(
      false,
    );
  });

  it("fails on a slot script without the selectors", async () => {
    expect(
      await provesHtmlAdBlock(
        createProcessorRegistry,
        isAdRequestUrl,
        HIDE_ADS_SCRIPT.replace(/SELECTORS = \[[^\]]*\]/, "SELECTORS = []"),
      ),
    ).toBe(false);
  });
});
