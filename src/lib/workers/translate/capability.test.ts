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
  buildAdvertisedCapabilities,
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
  /**
   * ── THIS BLOCK USED TO PIN THE DEFECT ───────────────────────────────────────
   *
   * Until 2026-08-22 the assertion below read
   * `expect(ADVERTISED_WORKER_CAPABILITIES.length).toBeGreaterThanOrEqual(2)`
   * and then checked, one-directionally, that each advertised key existed on
   * the wire. Both halves were true of a corpus of two against a wire of seven,
   * so this file was green for the whole time the subsystem printed *"The
   * running worker proved every capability the product's copy promises"* over
   * five capabilities it had never asked about — `malwareScan` among them.
   *
   * Inverted rather than deleted, and the inversion is the second direction:
   * a wire field nobody advertises is now a failure, which is the thing that
   * could not fail before. The `>= 2` floor became a bijection, so the corpus
   * cannot silently shrink either.
   */
  it("the advertised set is EXACTLY the set a worker can publish", () => {
    const wire = Object.keys(
      emptyCapabilities() as unknown as Record<string, unknown>,
    );
    const advertised = ADVERTISED_WORKER_CAPABILITIES.map((c) => c.key);

    // BOUND THE CORPUS: two empty lists are equal, and `[] ⊆ []` is the
    // strongest possible pass. The wire has had nine capabilities since
    // `pptxPresentationChain` landed (eight since `aiReadCap`); a number
    // below that is the fixture failing, not the code.
    expect(
      wire.length,
      "the heartbeat's capability set is implausibly small — the corpus, not " +
        "the code, is what failed",
    ).toBeGreaterThanOrEqual(9);

    expect(
      [...advertised].sort(),
      "the subsystem asks about a different set than a worker can answer with. " +
        "A key advertised with no wire field reads as missing on every healthy " +
        "deployment forever; a wire field nobody advertises is a capability the " +
        "row silently does not check while claiming it checked everything.",
    ).toEqual([...wire].sort());
  });

  it("every advertised capability says what it promises a reader", () => {
    // A row that names a capability and cannot say why it matters is a red
    // light with nowhere to look. There is no default promise string — this
    // asserts the absence of one at the point of consumption.
    for (const capability of ADVERTISED_WORKER_CAPABILITIES) {
      expect(
        capability.promise,
        `${capability.key} carries no promise text`,
      ).toBeTruthy();
      expect(
        capability.promise.length,
        `${capability.key}'s promise is too short to be a sentence a reader ` +
          "was told",
      ).toBeGreaterThan(30);
      expect(
        capability.label,
        `${capability.key} carries no human-readable label`,
      ).toBeTruthy();
    }
  });

  it("REFUSES a published capability nobody has written a promise for", () => {
    // The exit condition, watched firing. A build that adds a capability to the
    // heartbeat and no promise here must not start; a silently-defaulted
    // promise string is the original bug with better manners.
    expect(() =>
      buildAdvertisedCapabilities([
        ...Object.keys(emptyCapabilities()),
        "warpDrive",
      ]),
    ).toThrow(/warpDrive/);
  });

  it("REFUSES an empty published key set, rather than reporting everything healthy", () => {
    // `[] ⊆ X` is vacuously true, so a corpus that collapsed to nothing would
    // make every worker prove every capability.
    expect(() => buildAdvertisedCapabilities([])).toThrow(/empty/i);
  });

  it("the proven shape covers exactly the advertised keys", () => {
    /**
     * ── ALSO A TEST THAT PINNED THE DEFECT ────────────────────────────────────
     *
     * This literal used to be `{ chunkedTranslate: true, deliveryCap: true }`,
     * and it type-checked, because `ProvenWorkerCapabilities` was keyed off the
     * two-entry array. Widening the corpus is what made it stop compiling —
     * which is the point of keeping it a written-out literal rather than a
     * derived object: `tsc` fails on the next capability before any test runs.
     *
     * The runtime equality below is the second, independent bound: the literal
     * must also match the set derived from the wire, so a key that drifts at
     * runtime (a cast, a spread) is caught even where the type cannot see it.
     */
    const proven: ProvenWorkerCapabilities = {
      deepCompression: true,
      ocr: true,
      ocrLanguages: true,
      malwareScan: true,
      atomicQueue: true,
      chunkedTranslate: true,
      deliveryCap: true,
      aiReadCap: true,
      pptxPresentationChain: true,
    };
    expect(Object.keys(proven).sort()).toEqual(
      ADVERTISED_WORKER_CAPABILITIES.map((c) => c.key).sort(),
    );
  });

  it("reads the language LIST as a list, not as a boolean", () => {
    /**
     * `ocrLanguages` is the one published capability that is not a boolean.
     * `published === true` — the rule every other capability uses — is `false`
     * for every array ever published, so a single coerced rule would have made
     * this row permanently red on every healthy deployment, in a way that reads
     * like a finding rather than like a bug in the guard.
     *
     * The bar is non-empty, and it is not chosen here: `/api/worker/status`
     * trusts the reported packs only when the list has length and otherwise
     * falls back to the whole catalogue, so an empty list is exactly the state
     * in which the OCR page's sentence about live packs stops being true.
     */
    const languages = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "ocrLanguages",
    );
    expect(languages, "ocrLanguages is not in the corpus at all").toBeDefined();
    expect(languages!.proves(["eng"])).toBe(true);
    expect(languages!.proves(["eng", "ben"])).toBe(true);
    expect(languages!.proves([])).toBe(false);
    // The coercion this rule exists to avoid: `true` is not a pack list.
    expect(languages!.proves(true)).toBe(false);
    expect(languages!.proves(undefined)).toBe(false);

    // CONTROL: the boolean capabilities really do use the strict rule, so the
    // per-capability read is not quietly the same function everywhere.
    const flag = ADVERTISED_WORKER_CAPABILITIES.find(
      (c) => c.key === "malwareScan",
    );
    expect(flag!.proves(true)).toBe(true);
    expect(flag!.proves(["eng"])).toBe(false);
    expect(flag!.proves("true")).toBe(false);
  });
});

/**
 * Is this published value COMPUTED on the running worker, or written here?
 *
 * The property, stated as a property: a value that reaches the wire must have
 * been read off the image the daemon is running in — a probe result, a runtime
 * field, a prover's return. A literal is a claim about `main`, and `main` was
 * never the thing that was wrong.
 *
 * ── WHY NOT "IT MUST BE A CALL" ─────────────────────────────────────────────
 *
 * That was the earlier rule, and it was the MECHANISM, not the property. It was
 * satisfiable by exactly the two capabilities the corpus happened to contain
 * (`await provesX()`) and false of the five it did not — `deepCompression:
 * runtime.compression.deep` is a probe result and not a call. A mechanism-shaped
 * exit condition would have forced those five to be rewritten to pass a guard,
 * or, far more likely, kept them out of the corpus for another nine days.
 */
function isComputedOnTheWorker(node: TS.Node): boolean {
  let found = false;
  const visit = (n: TS.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(n) ||
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Parse a fragment and hand back the initializer of `probe: <expr>`. */
function initializerOf(expression: string): TS.Node {
  const sf = ts.createSourceFile(
    "fragment.ts",
    `const x = { probe: ${expression} };`,
    ts.ScriptTarget.Latest,
    true,
  );
  let found: TS.Node | undefined;
  const walk = (node: TS.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === "probe") {
      found = node.initializer;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  if (!found) throw new Error(`could not parse fragment: ${expression}`);
  return found;
}

describe("the daemon PROVES the capabilities, it does not declare them", () => {
  it("CONTROLS: the predicate separates a probe from a claim", () => {
    // Positive and negative controls for the predicate itself, run on synthetic
    // source so nothing has to be mutated in a real file to see it fail. A
    // predicate whose red nobody has watched is a predicate nobody has watched.
    for (const computed of [
      "runtime.compression.deep",
      "runtime.ocr.languages",
      "queueSupportsAtomicTransitions(process.env)",
      "await provesChunkedTranslate()",
      "probeThing() ? runtime.a.b : false",
    ]) {
      expect(
        isComputedOnTheWorker(initializerOf(computed)),
        `${computed} reads as a claim, but it is a probe`,
      ).toBe(true);
    }
    for (const claimed of ["true", "false", '["eng"]', '"eng"', "0"]) {
      expect(
        isComputedOnTheWorker(initializerOf(claimed)),
        `${claimed} reads as a probe, but it is a claim written in the source`,
      ).toBe(false);
    }
  });

  it("publishes a computed value for every advertised capability", () => {
    /**
     * The property this file exists for, checked where it can be broken.
     * `chunkedTranslate: true` would compile, pass everything above, and
     * restore the original defect exactly — a boolean written in `main`
     * reporting on an image that is not `main`. From the reader's side a proven
     * `true` and a typed `true` are the same byte.
     *
     * It cannot tell a good prover from a bad one — the discrimination tests
     * above do that, and a `const YES = true` aliased in would slip through —
     * but it can tell a probe from a claim, over the WHOLE published set rather
     * than the two capabilities that happened to be listed.
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

    // HEALTH CHECK on the walk, not on the daemon: a parse that found nothing
    // (a moved file, a renamed field, a `createSourceFile` that silently
    // produced an empty tree) would make every assertion below fail for the
    // wrong reason, and a red nobody can explain gets deleted.
    expect(
      values.size,
      `${file} yielded ${values.size} capability assignments — the AST walk, ` +
        "not the daemon, is what failed",
    ).toBe(ADVERTISED_WORKER_CAPABILITIES.length);

    for (const capability of ADVERTISED_WORKER_CAPABILITIES) {
      const value = values.get(capability.key);
      expect(
        value,
        `${file} never publishes ${capability.key}, so the running image can ` +
          "never prove it and the subsystem reads it as missing forever",
      ).toBeDefined();
      expect(
        isComputedOnTheWorker(value!),
        `${file} publishes ${capability.key} as a literal instead of reading it ` +
          "off the running image. A boolean written here describes `main`, and " +
          "`main` was never the thing that was wrong — the running image was.",
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
