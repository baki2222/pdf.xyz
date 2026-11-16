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
