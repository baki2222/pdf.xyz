// @vitest-environment node
/**
 * The HEALTHCHECK must not run the proofs, and must publish only what THIS
 * container's daemon proved. See `./proved-capabilities.ts` for the property.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCapabilities } from "@/lib/workers/heartbeat/capabilities";
import { heartbeatKey, parseHeartbeat } from "@/lib/workers/heartbeat";
import { createFakeRedis } from "../queue/redis-fake";
import { buildDaemonHeartbeat } from "./heartbeat-publisher";
import {
  PROOF_CACHE_FILE,
  PROOF_CACHE_VERSION,
  PROVED_CAPABILITIES,
  containerRunStamp,
  readProofCache,
  resolveProvedCapabilities,
  writeProofCache,
  type ProvedKey,
  type Provers,
} from "./proved-capabilities";

const KEYS = Object.keys(PROVED_CAPABILITIES) as ProvedKey[];
const KEY = { fingerprint: "0123456789ab", run: "boot-1:4242" };
/** What the fake proofs "prove": distinct from emptyCapabilities() everywhere. */
const LANGS = ["bn", "en", "es"];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "pdfxyz-proofs-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A table with PROVED_CAPABILITIES' keys and parsers, and spies for proofs. */
function spyProvers() {
  const spies = new Map<ProvedKey, ReturnType<typeof vi.fn>>();
  const table: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value =
      key === "translatePdfLanguages" ? [...LANGS] : !emptyCapabilities()[key];
    const spy = vi.fn(async () => value);
    spies.set(key, spy);
    table[key] = { prove: spy, parse: PROVED_CAPABILITIES[key].parse };
  }
  const calls = () =>
    [...spies.values()].reduce((n, s) => n + s.mock.calls.length, 0);
  return { provers: table as unknown as Provers, spies, calls };
}

describe("the proved set is derived, and is the right set", () => {
  it("is a subset of the published capabilities, and holds the costly proof", () => {
    const published = Object.keys(emptyCapabilities());
    for (const key of KEYS) expect(published).toContain(key);
    // Positive control + size bound: a table that quietly shrank would cache
    // less of the world and still pass every assertion below.
    expect(KEYS).toContain("translatePdfLanguages");
    expect(KEYS).toContain("docxTables");
    // #28 slice 3 (2026-11-16): a deliberate addition, not a mirror of a
    // docxTypefaces line (this file names none).
    expect(KEYS).toContain("docxTableWraps");
    expect(KEYS.length).toBeGreaterThanOrEqual(12);
    expect(KEYS.length).toBeLessThan(published.length);
  });
});

describe("a run mode proves and writes the cache", () => {
  it("runs every proof once and writes what it proved", async () => {
    const { provers, spies } = spyProvers();
    const r = await resolveProvedCapabilities({
      mode: "loop",
      env: {},
      key: KEY,
      dir,
      provers,
    });
    expect(r.source).toBe("proved");
    expect(r.cacheWritten).toBe(true);
    for (const key of KEYS) expect(spies.get(key)).toHaveBeenCalledTimes(1);
    const file = JSON.parse(
      readFileSync(path.join(dir, PROOF_CACHE_FILE), "utf8"),
    );
    expect(file.v).toBe(PROOF_CACHE_VERSION);
    expect(file.fingerprint).toBe(KEY.fingerprint);
    expect(file.run).toBe(KEY.run);
    expect(file.capabilities.translatePdfLanguages).toEqual(LANGS);
  });

  it("without a fingerprint it proves but writes nothing it could not key", async () => {
    const { provers } = spyProvers();
    const r = await resolveProvedCapabilities({
      mode: "once",
      env: {},
      key: null,
      dir,
      provers,
    });
    expect(r.source).toBe("proved");
    expect(r.cacheWritten).toBe(false);
    expect(readProofCache(dir, KEY, provers)).toBeNull();
  });
});

describe("a readiness probe reads the cache and never proves", () => {
  for (const mode of ["dry-run-status", "check"] as const) {
    it(`${mode}: a matching cache is used and no proof runs`, async () => {
      const writer = spyProvers();
      await resolveProvedCapabilities({
        mode: "loop",
        env: {},
        key: KEY,
        dir,
        provers: writer.provers,
      });
      const probe = spyProvers();
      const r = await resolveProvedCapabilities({
        mode,
        env: {},
        key: KEY,
        dir,
        provers: probe.provers,
      });
      expect(r.source).toBe("cache");
      expect(probe.spies.get("translatePdfLanguages")).not.toHaveBeenCalled();
      expect(probe.calls()).toBe(0);
      expect(r.capabilities?.translatePdfLanguages).toEqual(LANGS);
    });

    it(`${mode}: cold (no cache) publishes nothing and proves nothing`, async () => {
      const probe = spyProvers();
      const r = await resolveProvedCapabilities({
        mode,
        env: {},
        key: KEY,
        dir,
        provers: probe.provers,
      });
      expect(r).toEqual({ source: "none", capabilities: null });
      expect(probe.calls()).toBe(0);
    });
  }

  it("a cache from another fingerprint, run or version is ignored", async () => {
    const { provers } = spyProvers();
    await resolveProvedCapabilities({
      mode: "loop",
      env: {},
      key: KEY,
      dir,
      provers,
    });
    // Positive control: the same file IS read under its own key.
    expect(readProofCache(dir, KEY, provers)).not.toBeNull();
    expect(
      readProofCache(dir, { ...KEY, fingerprint: "ba9876543210" }, provers),
    ).toBeNull();
    expect(readProofCache(dir, { ...KEY, run: "boot-1:9999" }, provers)).toBe(
      null,
    );
    expect(readProofCache(dir, { ...KEY, run: null }, provers)).toBeNull();
    const file = JSON.parse(
      readFileSync(path.join(dir, PROOF_CACHE_FILE), "utf8"),
    );
    writeFileSync(
      path.join(dir, PROOF_CACHE_FILE),
      JSON.stringify({ ...file, v: PROOF_CACHE_VERSION + 1 }),
    );
    expect(readProofCache(dir, KEY, provers)).toBeNull();
  });

  it("a corrupt cache is ignored safely, whatever the corruption", async () => {
    const { provers } = spyProvers();
    writeProofCache(dir, KEY, {
      ...Object.fromEntries(KEYS.map((k) => [k, true])),
      translatePdfLanguages: LANGS,
    } as never);
    const good = JSON.parse(
      readFileSync(path.join(dir, PROOF_CACHE_FILE), "utf8"),
    );
    // Positive control: the uncorrupted file reads.
    expect(readProofCache(dir, KEY, provers)).not.toBeNull();
    const caps = good.capabilities;
    const { docxTables: _dropped, ...missingKey } = caps;
    const bodies = [
      "",
      "{",
      JSON.stringify(good).slice(0, 40),
      "null",
      "[]",
      JSON.stringify({ ...good, capabilities: null }),
      JSON.stringify({ ...good, capabilities: missingKey }),
      JSON.stringify({ ...good, capabilities: { ...caps, htmlZip: "true" } }),
      JSON.stringify({
        ...good,
        capabilities: { ...caps, translatePdfLanguages: ["en", "xx"] },
      }),
      JSON.stringify({
        ...good,
        capabilities: { ...caps, translatePdfLanguages: ["en", "en"] },
      }),
      JSON.stringify({
        ...good,
        capabilities: { ...caps, translatePdfLanguages: "en" },
      }),
    ];
    for (const body of bodies) {
      writeFileSync(path.join(dir, PROOF_CACHE_FILE), body);
      const probe = spyProvers();
      const r = await resolveProvedCapabilities({
        mode: "dry-run-status",
        env: {},
        key: KEY,
        dir,
        provers: probe.provers,
      });
      expect(r.source, body.slice(0, 60)).toBe("none");
      expect(probe.calls()).toBe(0);
    }
  });
});

describe("containerRunStamp", () => {
  it("joins the boot id and PID 1's start time, past a comm with spaces", () => {
    const fields = Array.from({ length: 30 }, (_, i) => String(i + 3));
    fields[0] = "S";
    fields[19] = "987654";
    const files: Record<string, string> = {
      "/proc/sys/kernel/random/boot_id": "abc-def\n",
      "/proc/1/stat": `1 (my (odd) cmd) ${fields.join(" ")}\n`,
    };
    expect(containerRunStamp((f) => files[f]!)).toBe("abc-def:987654");
  });

  it("is null where /proc cannot answer", () => {
    expect(
      containerRunStamp(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});

describe("the beat publishes the value the proof produced", () => {
  const ENV = {
    PDFXYZ_QUEUE_PROVIDER: "redis",
    PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
    PDFXYZ_REDIS_REST_TOKEN: "redis-rest-token-1234",
    PDFXYZ_WORKER_HEARTBEAT: "enabled",
  };
  const runtime = {
    deepCompression: true,
    ocr: true,
    ocrLanguages: ["eng"],
    malwareScan: false,
    atomicQueue: true,
  };
  const published = (fake: ReturnType<typeof createFakeRedis>) => {
    const set = fake.calls.filter(
      (c) => c[0] === "SET" && c[1] === heartbeatKey("pdfxyz"),
    );
    return set.map((c) => parseHeartbeat(c[2]));
  };

  it("run mode and a warm probe publish the proof's own languages", async () => {
    const writer = spyProvers();
    const runFake = createFakeRedis();
    const run = await buildDaemonHeartbeat({
      mode: "loop",
      heartbeatMode: "loop",
      env: ENV,
      runtime,
      fingerprint: KEY.fingerprint,
      run: KEY.run,
      dir,
      provers: writer.provers,
      deps: { client: runFake, now: () => 1_000 },
    });
    expect(run.proofs).toEqual({ source: "proved", cacheWritten: true });
    expect((await run.publisher.beat()).published).toBe(true);
    // The wire emits in menu order; the set is what must match.
    expect(
      [
        ...(published(runFake)[0]?.capabilities.translatePdfLanguages ?? []),
      ].sort(),
    ).toEqual(LANGS);

    const probe = spyProvers();
    const probeFake = createFakeRedis();
    const warm = await buildDaemonHeartbeat({
      mode: "dry-run-status",
      heartbeatMode: "dry-run",
      env: ENV,
      runtime,
      fingerprint: KEY.fingerprint,
      run: KEY.run,
      dir,
      provers: probe.provers,
      deps: { client: probeFake, now: () => 2_000 },
    });
    expect(warm.proofs).toEqual({ source: "cache" });
    expect((await warm.publisher.beat()).published).toBe(true);
    expect(probe.calls()).toBe(0);
    const [runBeat] = published(runFake);
    const [warmBeat] = published(probeFake);
    // Every proved key, not just the languages, is the daemon's own answer.
    for (const key of KEYS)
      expect(warmBeat?.capabilities[key], key).toEqual(
        runBeat?.capabilities[key],
      );
    expect(warmBeat?.capabilities.ocrLanguages).toEqual(["eng"]);
  });

  it("a cold probe sends the broker nothing, so the daemon's record stands", async () => {
    const probe = spyProvers();
    const fake = createFakeRedis();
    const cold = await buildDaemonHeartbeat({
      mode: "dry-run-status",
      heartbeatMode: "dry-run",
      env: ENV,
      runtime,
      fingerprint: KEY.fingerprint,
      run: KEY.run,
      dir,
      provers: probe.provers,
      deps: { client: fake, now: () => 1_000 },
    });
    expect(cold.proofs).toEqual({ source: "none" });
    expect(cold.publisher.capability.enabled).toBe(true);
    expect(await cold.publisher.beat()).toEqual({
      published: false,
      reason: "unproven",
    });
    expect(fake.calls).toEqual([]);
    expect(probe.calls()).toBe(0);
  });

  it("a cold probe with liveness off still says disabled", async () => {
    const cold = await buildDaemonHeartbeat({
      mode: "dry-run-status",
      heartbeatMode: "dry-run",
      env: {},
      runtime,
      run: null,
      dir,
      provers: spyProvers().provers,
    });
    expect(await cold.publisher.beat()).toEqual({
      published: false,
      reason: "disabled",
    });
  });
});

describe("the chatRetrieval entry is a proof, not a constant", () => {
  /**
   * Every other test here replaces each `prove` with a spy, so nothing in
   * this file could see `chatRetrieval: { prove: () => true }` (mutation m6
   * of the slice-3 brief). Two independent holds: the entry, CALLED, answers
   * false on an image with no text extractor; and its source is a call to
   * the function `retrieval-capability.ts` exports, with the env passed on.
   */
  it("answers false where this image has no pdftotext", async () => {
    const value = await PROVED_CAPABILITIES.chatRetrieval.prove({
      // An absolute override that does not exist: no extractor, whatever
      // the host's PATH holds.
      PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdfxyz-no-pdftotext",
    });
    expect(value).toBe(false);
  });

  it("is the call to provesChatRetrieval, imported from retrieval-capability", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/workers/daemon/proved-capabilities.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /^import \{ provesChatRetrieval \} from "@\/lib\/workers\/chat-with-pdf\/retrieval-capability";$/m,
    );
    const entry = /^\s*chatRetrieval: \{([^}]*)\},?$/m.exec(source)?.[1] ?? "";
    expect(entry, "no chatRetrieval entry in PROVED_CAPABILITIES").not.toBe("");
    expect(entry).toMatch(
      /prove: \(env\) => provesChatRetrieval\(env\), parse: bool/,
    );
  });
});

describe("the summarizePages entry is a proof, not a constant", () => {
  /**
   * The same two holds as chatRetrieval's above, for the same reason: every
   * other test here spies on `prove`, so `summarizePages: { prove: () =>
   * true }` would pass them all (audit summarize-pdf#5, slice 5).
   */
  it("answers false where this image has no pdftotext", async () => {
    const value = await PROVED_CAPABILITIES.summarizePages.prove({
      PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdfxyz-no-pdftotext",
    });
    expect(value).toBe(false);
  });

  it("is the call to provesSummarizePages, imported from pages-capability", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/workers/daemon/proved-capabilities.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /^import \{ provesSummarizePages \} from "@\/lib\/workers\/summarize\/pages-capability";$/m,
    );
    const entry =
      /^ {2}summarizePages: \{([\s\S]*?)\},?$/m.exec(source)?.[1] ?? "";
    expect(entry, "no summarizePages entry in PROVED_CAPABILITIES").not.toBe(
      "",
    );
    expect(entry).toMatch(
      /prove: \(env\) => provesSummarizePages\(\{ env \}\),\s*parse: bool/,
    );
  });
});

describe("the translatePageRange entry is a proof, not a constant", () => {
  /**
   * INVERTED 2026-11-16 (competitor audit #29 slice 6, history kept). This
   * block was "the translatePageRange entry publishes false until its proof
   * exists": the contract step put the key on the wire before its start-up
   * proof was written, and pinned "proves false on any env" so the one value
   * that cannot license a page choice was published meanwhile. The proof now
   * lives in `translate/page-range-capability.ts`, so the hold is the same as
   * summarizePages's above: every other test here spies on `prove`, and
   * `translatePageRange: { prove: () => true }` would pass them all.
   */
  it("answers false where this image has no pdftotext", async () => {
    const value = await PROVED_CAPABILITIES.translatePageRange.prove({
      PDFXYZ_PDF_TEXT_BIN: "/nonexistent/pdfxyz-no-pdftotext",
    });
    expect(value).toBe(false);
  });

  it("is the call to provesTranslatePageRange, imported from page-range-capability", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/workers/daemon/proved-capabilities.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /^import \{ provesTranslatePageRange \} from "@\/lib\/workers\/translate\/page-range-capability";$/m,
    );
    const entry =
      /^ {2}translatePageRange: \{([\s\S]*?)\},?$/m.exec(source)?.[1] ?? "";
    expect(
      entry,
      "no translatePageRange entry in PROVED_CAPABILITIES",
    ).not.toBe("");
    expect(entry).toMatch(
      /prove: \(env\) => provesTranslatePageRange\(env\),\s*parse: bool/,
    );
  });
});

describe("the csvImportOptions entry is a proof, not a constant", () => {
  /**
   * Competitor audit #18 (2026-11-17). Every other test here spies on
   * `prove`, so `csvImportOptions: { prove: () => true }` would pass them
   * all; this holds the entry to the call, and `csv-capability.test.ts`
   * holds the call to the image (it says NO for a processor that drops the
   * options, a runner that ignores the choice, and a lenient parser). The
   * proof stands soffice in with a recorder, so it answers YES without
   * LibreOffice; whether LibreOffice is installed is the Office processor's
   * own readiness, which gates the panel before this does.
   */
  it("answers true on this tree's registry", async () => {
    expect(await PROVED_CAPABILITIES.csvImportOptions.prove({})).toBe(true);
  });

  it("is the call to provesCsvImportOptions, imported from csv-capability", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/workers/daemon/proved-capabilities.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /^import \{ provesCsvImportOptions \} from "@\/lib\/workers\/office-conversion\/csv-capability";$/m,
    );
    const entry =
      /^ {2}csvImportOptions: \{([\s\S]*?)\},?$/m.exec(source)?.[1] ?? "";
    expect(entry, "no csvImportOptions entry in PROVED_CAPABILITIES").not.toBe(
      "",
    );
    expect(entry).toMatch(
      /prove: \(env\) => provesCsvImportOptions\(env\),\s*parse: bool/,
    );
  });
});

describe("the ocrOwnerPassword entry is a proof, not a constant", () => {
  /**
   * Competitor-audit backlog #11 (2026-11-17). Every other test here spies
   * on `prove`, so `ocrOwnerPassword: { prove: () => true }` would pass them
   * all; this holds the entry to the call, and `ocr-owner-capability.test.ts`
   * holds the call to the image (it says NO for a processor that drops the
   * option, a runner that lets a wrong password through, no qpdf on the
   * host, and a refusing soundness gate).
   */
  it("is the call to provesOcrOwnerPassword, imported from ocr-owner-capability", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/workers/daemon/proved-capabilities.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /^import \{ provesOcrOwnerPassword \} from "@\/lib\/workers\/ocr-owner-capability";$/m,
    );
    const entry =
      /^ {2}ocrOwnerPassword: \{([\s\S]*?)\},?$/m.exec(source)?.[1] ?? "";
    expect(entry, "no ocrOwnerPassword entry in PROVED_CAPABILITIES").not.toBe(
      "",
    );
    expect(entry).toMatch(
      /prove: \(env\) => provesOcrOwnerPassword\(env\),\s*parse: bool/,
    );
  });

  it("answers what the host's qpdf presence allows, and never throws", async () => {
    // The default presence probe reads this host's PATH, so the answer is
    // whatever qpdf's presence is here; the proof itself is held to YES with
    // qpdf present in `ocr-owner-capability.test.ts`.
    const answer = await PROVED_CAPABILITIES.ocrOwnerPassword.prove({});
    expect(typeof answer).toBe("boolean");
  });
});

describe("the requestSignatureLabels entry is a proof, not a constant", () => {
  /**
   * 2026-11-18. Every other test here spies on `prove`, so
   * `requestSignatureLabels: { prove: () => true }` would pass them all; this
   * holds the entry to the call, and `labels-capability.test.ts` holds the
   * call to the image (it says NO for a placer that writes no /TU, the wrong
   * text, no /TU on the widget, a /TU on an unlabelled box, a parser that
   * drops the label, a refusing soundness gate, a hung run and a throw). The
   * engine is pure pdf-lib, so the proof runs here exactly as in the image.
   */
  it("answers true on this tree's registry", async () => {
    expect(await PROVED_CAPABILITIES.requestSignatureLabels.prove({})).toBe(
      true,
    );
  });

  it("is the call to provesRequestSignatureLabels, imported from labels-capability", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/workers/daemon/proved-capabilities.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /^import \{ provesRequestSignatureLabels \} from "@\/lib\/workers\/request-signatures\/labels-capability";$/m,
    );
    const entry =
      /^ {2}requestSignatureLabels: \{([\s\S]*?)\},?$/m.exec(source)?.[1] ?? "";
    expect(
      entry,
      "no requestSignatureLabels entry in PROVED_CAPABILITIES",
    ).not.toBe("");
    expect(entry).toMatch(
      /prove: \(env\) => provesRequestSignatureLabels\(env\),\s*parse: bool/,
    );
  });
});
