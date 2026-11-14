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
import { answerArchiveRequest } from "./zip-site";
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

  // Hostile review round 2 (2026-11-14): the probe ran a stub renderer, so
  // the branch that charges archive answers never ran, and an image serving
  // them uncharged (open to the 656 KB upload that took the heap) passed.
  describe("serving must be bounded by the render network", () => {
    const uncharged: typeof answerArchiveRequest = (site, _network, req) => {
      const hit = site.serve(req.url);
      return {
        action: "fulfill",
        status: hit ? 200 : 404,
        headers: [],
        body: hit ? hit.body : null,
      };
    };
    const requestsOnly: typeof answerArchiveRequest = (site, network, req) =>
      network.chargeServed(0) === null
        ? uncharged(site, network, req)
        : { action: "fail", why: "spent" };
    it("says NO when archive answers are not charged at all", async () => {
      await expect(
        provesHtmlZip(createProcessorRegistry, uncharged),
      ).resolves.toBe(false);
    });

    it("says NO when only requests are charged, never bytes", async () => {
      await expect(
        provesHtmlZip(createProcessorRegistry, requestsOnly),
      ).resolves.toBe(false);
    });

    it("POSITIVE CONTROL: the renderer's own answer passes, and is what the default argument is", async () => {
      await expect(
        provesHtmlZip(createProcessorRegistry, answerArchiveRequest),
      ).resolves.toBe(true);
    });
  });
});
