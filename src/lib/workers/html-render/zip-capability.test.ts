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
import { htmlZipRefusalMessage } from "./zip-config";
import { processorOk } from "../processor/types";
import { ProcessorRegistry } from "../processor/registry";

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

    // Hostile review round 3 (2026-11-14): the answer inflated (and cached)
    // the entry, THEN charged it, so a refused answer still cost the heap.
    const readThenCharge: typeof answerArchiveRequest = (
      site,
      network,
      req,
    ) => {
      const hit = req.method === "GET" ? site.serve(req.url) : null;
      const refused = network.chargeServed(hit ? hit.body.byteLength : 0);
      if (refused !== null) return { action: "fail", why: refused };
      return {
        action: "fulfill",
        status: hit ? 200 : 404,
        headers: [],
        body: hit ? hit.body : null,
      };
    };
    it("says NO when an entry is read before it is charged (the round-2 answer)", async () => {
      await expect(
        provesHtmlZip(createProcessorRegistry, readThenCharge),
      ).resolves.toBe(false);
    });

    it("says NO when documents are not charged to the document budget", async () => {
      const noDocumentBudget: typeof answerArchiveRequest = (site, n, req) =>
        answerArchiveRequest(
          {
            lookup: (url) => {
              const found = site.lookup(url);
              return found && { ...found, document: false };
            },
            serve: (url) => site.serve(url),
            documentBytesLeft: site.documentBytesLeft,
          },
          n,
          req,
        );
      await expect(
        provesHtmlZip(createProcessorRegistry, noDocumentBudget),
      ).resolves.toBe(false);
    });

    it("POSITIVE CONTROL: the renderer's own answer passes, and is what the default argument is", async () => {
      await expect(
        provesHtmlZip(createProcessorRegistry, answerArchiveRequest),
      ).resolves.toBe(true);
    });
  });
  // Hostile review round 3 (2026-11-14): deleting either directory bound of
  // the reader (`../epub/zip-directory.ts`) left the probe green, though
  // serving then held up to 2.3 GiB of the worker's heap. Each image below
  // is the real registry, except that the bound's own refusal does not
  // happen: the archive renders, or is refused for another reason.
  describe("the archive's own bounds must hold", () => {
    const FILE = htmlZipRefusalMessage({ kind: "bomb", limit: "file" });
    const UNPACKED = htmlZipRefusalMessage({ kind: "bomb", limit: "unpacked" });
    const without =
      (
        message: string,
        instead: "render" | "unreadable",
      ): ProbeRegistryBuilder =>
      (deps) => {
        const real = createProcessorRegistry(deps).resolve("html-to-pdf")!;
        const chromium = chromiumOf(deps);
        const registry = new ProcessorRegistry();
        registry.register({
          ...real,
          async process(input) {
            const run = await real.process(input);
            if (run.ok || run.error.message !== message) return run;
            if (instead === "unreadable")
              return {
                ok: false,
                error: {
                  code: "unprocessable_entity",
                  message: htmlZipRefusalMessage({ kind: "unreadable" }),
                  retryable: false,
                },
              };
            await chromium.renderSite!({
              entry: "index.html",
              entryUrl: "x",
              entryBytes: 1,
              lookup: () => null,
              serve: () => null,
              documentBytesLeft: 0,
            });
            return processorOk(
              [
                {
                  filename: "x.pdf",
                  contentType: "application/pdf",
                  bytes: new Uint8Array([0x25]),
                },
              ],
              {},
            );
          },
        });
        return registry;
      };
    it("POSITIVE CONTROL: the wrapper passes every other job through, so a NO below is the bound's", async () => {
      await expect(
        provesHtmlZip(without("no refusal has these words", "render")),
      ).resolves.toBe(true);
    });
    it.each([
      ["the per-file bound, archive rendered", FILE, "render"],
      ["the per-file bound, refused as unreadable instead", FILE, "unreadable"],
      ["the total bound, archive rendered", UNPACKED, "render"],
      [
        "the total bound, refused as unreadable instead",
        UNPACKED,
        "unreadable",
      ],
    ] as const)("says NO without %s", async (_, message, instead) => {
      await expect(provesHtmlZip(without(message, instead))).resolves.toBe(
        false,
      );
    });
  });
});
