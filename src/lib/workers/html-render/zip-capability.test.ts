// @vitest-environment node
/**
 * `provesHtmlZip` — the start-up proof behind the heartbeat's `htmlZip`. It
 * must say YES for the registry this repository builds, and NO for each way
 * an image can lack the feature while still answering jobs: no html-render
 * processor at all; the engine of an image built before ZIP input (no
 * `renderSite`: the archive goes to `renderHtml` and comes back as a "PDF");
 * a processor that drops the job's page; a site that serves outside the
 * archive; and one that renders a ZIP it should have refused. Each NO is a
 * swapped registry builder around the real one, so the probe's own reading
 * is what is tested.
 */
import { describe, expect, it } from "vitest";
import { createProcessorRegistry } from "../processor";
import type { SecureWorkerProcessorDeps } from "../processor";
import { runHtmlToPdf, type ChromiumPdfRunner } from "./engine";
import { provesHtmlZip, type ProbeRegistryBuilder } from "./zip-capability";
import { processorOk } from "../processor/types";

const chromiumOf = (deps: Parameters<ProbeRegistryBuilder>[0]) =>
  deps!.htmlRender!.chromium!;

/** A registry whose html-to-pdf processor is `process`, and nothing else. */
function onlyHtml(
  process: (
    bytes: Uint8Array,
    options: Record<string, unknown>,
  ) => Promise<boolean>,
): ProbeRegistryBuilder {
  return ((deps: SecureWorkerProcessorDeps) => {
    const registry = createProcessorRegistry({});
    registry.register({
      id: "html-render",
      tools: ["html-to-pdf"],
      supports: (tool) => tool === "html-to-pdf",
      capability: () => ({
        id: "html-render",
        tools: ["html-to-pdf"],
        ready: true,
        detail: "probe",
      }),
      async process(input) {
        void deps;
        const ok = await process(input.inputs[0]!.bytes, input.options);
        return ok
          ? processorOk(
              [
                {
                  filename: "x.pdf",
                  contentType: "application/pdf",
                  bytes: new Uint8Array([0x25]),
                },
              ],
              {},
            )
          : {
              ok: false,
              error: {
                code: "unprocessable_entity",
                message: "no",
                retryable: false,
              },
            };
      },
    });
    return registry;
  }) as ProbeRegistryBuilder;
}

describe("provesHtmlZip", () => {
  it("says YES for the registry the daemon builds", async () => {
    await expect(provesHtmlZip()).resolves.toBe(true);
  });

  it("says NO when the image has no html-render processor", async () => {
    await expect(
      provesHtmlZip(() => createProcessorRegistry({})),
    ).resolves.toBe(false);
  });

  it("says NO for an image built before ZIP input (its renderer has no renderSite)", async () => {
    const build: ProbeRegistryBuilder = (deps) => {
      const { renderHtml, renderUrl } = chromiumOf(deps);
      const old: ChromiumPdfRunner = { renderHtml, renderUrl };
      return createProcessorRegistry({ htmlRender: { chromium: old } });
    };
    await expect(provesHtmlZip(build)).resolves.toBe(false);
  });

  it("says NO for a processor that renders the archive's bytes as HTML", async () => {
    const build: ProbeRegistryBuilder = (deps) =>
      onlyHtml(async (bytes) => {
        await chromiumOf(deps).renderHtml(bytes);
        return true;
      })(deps);
    await expect(provesHtmlZip(build)).resolves.toBe(false);
  });

  it("says NO for a processor that drops the job's page", async () => {
    const build: ProbeRegistryBuilder = (deps) =>
      onlyHtml(async (bytes) => {
        const run = await runHtmlToPdf(bytes, deps!.htmlRender!);
        return run.ok;
      })(deps);
    await expect(provesHtmlZip(build)).resolves.toBe(false);
  });

  it("says NO for a site that serves outside the archive", async () => {
    const build: ProbeRegistryBuilder = (deps) => {
      const real = chromiumOf(deps);
      const leaky: ChromiumPdfRunner = {
        ...real,
        renderSite: (site, options, run) =>
          real.renderSite!(
            {
              ...site,
              serve: (url) =>
                site.serve(url) ?? {
                  body: new Uint8Array([1]),
                  contentType: "text/plain",
                },
            },
            options,
            run,
          ),
      };
      return createProcessorRegistry({ htmlRender: { chromium: leaky } });
    };
    await expect(provesHtmlZip(build)).resolves.toBe(false);
  });

  it("says NO for a processor that renders a ZIP of several pages naming none", async () => {
    const build: ProbeRegistryBuilder = (deps) =>
      onlyHtml(async (bytes, options) => {
        const run = await runHtmlToPdf(
          bytes,
          deps!.htmlRender!,
          undefined,
          undefined,
          typeof options.entry === "string" ? options.entry : undefined,
        );
        // Accepts the refusal too: the very thing the probe must catch.
        return run.ok || run.kind === "refused";
      })(deps);
    await expect(provesHtmlZip(build)).resolves.toBe(false);
  });
});
