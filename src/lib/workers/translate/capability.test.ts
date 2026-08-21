// @vitest-environment node
/**
 * The capability probes must be able to say NO — and must probe the seam the
 * ENGINE uses, not the one below it.
 *
 * A hand-written `true` would have read `true` throughout the nine days the
 * running worker image had no chunking in it, because it would have lived in
 * `main`, and `main` was never what was wrong. A probe that cannot return
 * `false` is that boolean with extra steps.
 *
 * ── AND A PLANNER PROBE WAS NOT ENOUGH ──────────────────────────────────────
 *
 * The first version of these probes called `planTranslateChunks` directly. That
 * proves the planner is PRESENT. A worker whose engine had stopped consulting
 * the plan — the same `ready:true`-is-wiring shape, one level in — would have
 * passed it. They now run the real `runTranslate` and count the provider calls
 * it made, because "more than one call for one document" IS chunking.
 *
 * The negative evidence lives in two places, and neither is a stub of the
 * probe:
 *
 *  - **the signal discriminates** — the same engine, given a document that fits
 *    in one pass, makes one call; given a loose cap, makes the same number as
 *    uncapped. Those are the readings the probes turn into `false`.
 *  - **the real absent state** — `capability-gap.test.ts` drives the actual
 *    2026-08-12 worker record, read out of git rather than typed, through
 *    today's reader.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { provesChunkedTranslate, provesDeliveryCap } from "./capability";
import { runTranslate } from "./engine";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import type { AiCompletionResult, AiProvider } from "../ai/provider";
import type { TranslateOptions } from "@/lib/jobs/translate-pdf";
import {
  ADVERTISED_WORKER_CAPABILITIES,
  type ProvenWorkerCapabilities,
} from "../observability/snapshot";
import { emptyCapabilities } from "../heartbeat/factory";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const OPTIONS: TranslateOptions = {
  targetLanguage: "fr",
  sourceLanguage: "auto",
};

function extraction(pageCount: number, perPage: number): ExtractedPdfText {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
    text: "x".repeat(perPage),
    characterCount: perPage,
  }));
  const text = pages.map((p) => p.text).join("\n\n");
  return {
    pageCount,
    pages,
    text,
    characterCount: text.length,
    hasText: true,
  };
}

function provider(): AiProvider {
  return {
    id: "anthropic",
    model: "probe",
    async complete(): Promise<AiCompletionResult> {
      return {
        ok: true,
        text: "probe",
        model: "probe",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** Provider calls the REAL engine made — the quantity both probes read. */
async function calls(
  extracted: ExtractedPdfText,
  delivery?: { characters: number; pages?: number },
): Promise<number | null> {
  const run = await runTranslate(new Uint8Array([1, 2, 3, 4]), OPTIONS, {
    extract: async () => extracted,
    provider: provider(),
    now: () => "1970-01-01T00:00:00.000Z",
    ...(delivery ? { limits: { delivery } } : {}),
  });
  return run.ok ? (run.meta.usage?.calls ?? null) : null;
}

describe("the probes read the engine, and the engine's signal discriminates", () => {
  it("is true on an image whose engine splits a long document", async () => {
    expect(await provesChunkedTranslate()).toBe(true);
  });

  it("is true on an image whose engine honours a delivery cap", async () => {
    expect(await provesDeliveryCap()).toBe(true);
  });

  it("DISCRIMINATION: a document that fits makes exactly one call", async () => {
    // The reading `provesChunkedTranslate` turns into `false`. Same engine,
    // same accounting — only the document is different, so this shows the
    // signal is about the work and not about the probe always saying yes.
    expect(await calls(extraction(1, 4_000))).toBe(1);
  });

  it("DISCRIMINATION: a multi-page document makes more than one", async () => {
    const many = await calls(extraction(6, 4_000));
    expect(many).not.toBeNull();
    expect(many!).toBeGreaterThan(1);
  });

  it("DISCRIMINATION: a cap that cannot bind changes nothing", async () => {
    // The reading `provesDeliveryCap` turns into `false`: if a loose cap
    // produced the same call count as a tight one, the comparison would be
    // measuring nothing.
    const uncapped = await calls(extraction(6, 4_000));
    const loose = await calls(extraction(6, 4_000), {
      characters: Number.POSITIVE_INFINITY,
      pages: 99,
    });
    const tight = await calls(extraction(6, 4_000), {
      characters: Number.POSITIVE_INFINITY,
      pages: 2,
    });
    expect(loose).toBe(uncapped);
    expect(tight!).toBeLessThan(uncapped!);
  });

  it("costs no network and finishes fast enough for a start-up path", async () => {
    // These run at every worker start. The provider is a stub precisely so
    // there is no network call — which is also the limit the capability's
    // docblock states rather than implies.
    const before = Date.now();
    await Promise.all([provesChunkedTranslate(), provesDeliveryCap()]);
    expect(Date.now() - before).toBeLessThan(5_000);
  });
});

describe("the advertised set and the wire contract agree", () => {
  it("every advertised capability is a field a worker can publish", () => {
    /**
     * `ADVERTISED_WORKER_CAPABILITIES` (what the snapshot asks about) and
     * `HeartbeatCapabilities` (what a worker can answer with) must name the
     * same things. One advertised with no wire field would read as missing on
     * every healthy deployment forever; a wire field nobody advertises is a
     * value nothing consumes.
     */
    const wire = Object.keys(
      emptyCapabilities() as unknown as Record<string, unknown>,
    );
    expect(
      ADVERTISED_WORKER_CAPABILITIES.length,
      "nothing is advertised, so the subsystem asks nothing",
    ).toBeGreaterThanOrEqual(2);
    for (const capability of ADVERTISED_WORKER_CAPABILITIES) {
      expect(
        wire,
        `${capability.key} is advertised but no worker can publish it`,
      ).toContain(capability.key);
    }
  });

  it("the proven shape covers exactly the advertised keys", () => {
    const proven: ProvenWorkerCapabilities = {
      chunkedTranslate: true,
      deliveryCap: true,
    };
    expect(Object.keys(proven).sort()).toEqual(
      ADVERTISED_WORKER_CAPABILITIES.map((c) => c.key).sort(),
    );
  });
});

describe("the daemon PROVES the capabilities, it does not declare them", () => {
  it("publishes a computed value for every advertised capability", () => {
    /**
     * The property this file exists for, checked where it can be broken.
     * `chunkedTranslate: true` would compile, pass everything above, and
     * restore the original defect exactly — a boolean written in `main`
     * reporting on an image that is not `main`. From the reader's side a proven
     * `true` and a typed `true` are the same byte.
     *
     * The check is on the SHAPE of the published value: a call, never a
     * literal. It cannot tell a good prover from a bad one — the discrimination
     * tests above do that — but it can tell a prover from a claim.
     */
    const file = "scripts/worker-daemon.ts";
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    const values = new Map<string, TS.Node>();
    const walk = (node: TS.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        ADVERTISED_WORKER_CAPABILITIES.some(
          (c) => c.key === node.name.getText(),
        )
      ) {
        values.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);

    for (const capability of ADVERTISED_WORKER_CAPABILITIES) {
      const value = values.get(capability.key);
      expect(
        value,
        `${file} never publishes ${capability.key}, so the running image can ` +
          "never prove it and the subsystem reads it as missing forever",
      ).toBeDefined();
      // `await provesX()` is an AwaitExpression wrapping the call; both count.
      const computed =
        value !== undefined &&
        (ts.isCallExpression(value) ||
          (ts.isAwaitExpression(value) &&
            ts.isCallExpression(value.expression)));
      expect(
        computed,
        `${file} publishes ${capability.key} as a literal instead of calling a ` +
          "prover. A boolean written here describes `main`, and `main` was " +
          "never the thing that was wrong — the running image was.",
      ).toBe(true);
    }
  });

  it("probes through the ENGINE, not through the planner beneath it", () => {
    // The correction that produced this version. A probe of
    // `planTranslateChunks` proves the planner is present; the engine could
    // have stopped calling it and the probe would not notice. Pinned as a
    // relationship: the capability module must reach the engine's entry point.
    const source = readFileSync(
      "src/lib/workers/translate/capability.ts",
      "utf8",
    );
    expect(
      source,
      "the capability probe no longer goes through runTranslate, so it proves " +
        "a function is present rather than that the engine uses it",
    ).toContain("runTranslate");
    expect(
      /import\s*\{[^}]*planTranslateChunks/.test(source),
      "the probe imports the planner directly again — that is the seam one " +
        "level below the one the executor actually calls",
    ).toBe(false);
  });
});
