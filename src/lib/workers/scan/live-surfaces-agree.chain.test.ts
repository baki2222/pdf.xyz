// @vitest-environment node
/**
 * **No two live-serving surfaces may give opposite answers about whether uploads
 * are scanned for malware.**
 *
 * Measured on production 2026-08-22, both endpoints, same minute, same worker:
 *
 * ```
 * GET /api/worker/status     "scan":{"active":true,
 *                              "detail":"Every file is scanned for malware before
 *                                        any processor touches it"}
 * GET /api/worker/operations "id":"malware-scan","label":"Malware scanning",
 *                              "detail":"Malware scanning is not configured; ...
 *                                        uploads are not scanned (and are never
 *                                        reported as scanned)."
 * ```
 *
 * Scanning WAS on. `/api/worker/status` derives its answer from the running
 * worker's own heartbeat, which is the only tier that knows. The operations row
 * read the **web process's own** scanner environment — legitimately unconfigured,
 * because the web tier does not scan anything — and then phrased that local
 * configuration fact as a system-wide statement about user uploads.
 *
 * It was wrong in the SAFE direction, which is exactly why it survived: nobody
 * raises an alarm about a security control that under-claims. But an operator
 * reading the ops endpoint during an incident would have concluded uploads were
 * unscanned, and been wrong.
 *
 * ## What this guard pins, and why it is shaped this way
 *
 * Not "the operations row says X" — that is a check on a mechanism, and it would
 * stay green if the row moved, was renamed, or a third surface started answering.
 * It pins the RELATIONSHIP: for one fixed world, every live surface's answer about
 * uploads must equal what the running worker reported.
 *
 * It asserts agreement **with the truth**, never agreement alone. Agreement alone
 * is satisfiable by making every surface say "not scanned" in every world, which
 * is precisely the defect one step further along.
 *
 * The surfaces are DERIVED, never named:
 *  - the filesystem is walked for every `route.ts` under `src/app` — Next's App
 *    Router convention, so a file that exists IS a route and a route that exists
 *    IS such a file. A new endpoint is enrolled with no edit here;
 *  - that walk is cross-checked against `import.meta.glob` over the same pattern,
 *    and a mismatch is FATAL rather than a quiet shrink (a corpus that silently
 *    loses members reports the strongest possible pass);
 *  - dynamic segments are read out of the path itself, so `[artifactId]` supplies
 *    its own param name and those routes are probed too rather than skipped.
 *
 * The claim vocabulary is likewise derived in both directions from what the
 * surfaces actually serve: every classifier arm must catch a shipped sentence,
 * and every surface that spoke in one world must still speak in the others — so
 * copy rewritten into a shape this cannot see fails loudly instead of going quiet.
 */
import { readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildHeartbeat,
  serializeHeartbeat,
  type WorkerHeartbeat,
} from "@/lib/workers/heartbeat";

/* ------------------------------------------------------------------ *
 *  The surface corpus, derived from the route tree
 * ------------------------------------------------------------------ */

/** Repo root — walked up to, never typed, so moving this file cannot break it. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("no package.json above this test — cannot locate the repo");
}

/** Every `route.ts` under `src/app`, as root-relative POSIX paths. */
function walkRouteFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        found.push(`/${full.slice(root.length + 1).replace(/\\/g, "/")}`);
      }
    }
  };
  walk(join(root, "src", "app"));
  return found.sort();
}

type RouteModule = Record<string, unknown>;
type GlobMap = Record<string, () => Promise<RouteModule>>;

/**
 * The same pattern, resolved by the bundler instead of by `fs`. Two independent
 * enumerations of one set: if they ever disagree, one of them is lying and the
 * corpus this guard runs over is not the route tree.
 */
const globbedRoutes = (
  import.meta as unknown as { glob: (pattern: string) => GlobMap }
).glob("/src/app/**/route.ts");

const ROOT = repoRoot();
const WALKED = walkRouteFiles(ROOT);
const GLOBBED = Object.keys(globbedRoutes).sort();

/** A live surface: an App Router route that answers GET. */
interface Surface {
  /** Root-relative path — the only identity used, so nothing here names a route. */
  readonly path: string;
  readonly get: (req: Request, ctx: unknown) => Promise<Response> | Response;
  /** Param names read out of the path's own `[segment]`s. */
  readonly params: Record<string, string>;
}

async function loadSurfaces(): Promise<Surface[]> {
  const surfaces: Surface[] = [];
  for (const path of GLOBBED) {
    const mod = await globbedRoutes[path]!();
    const get = mod.GET;
    if (typeof get !== "function") continue;
    const params: Record<string, string> = {};
    for (const [, name] of path.matchAll(/\[\.{0,3}(\w+)\]/g)) {
      params[name!] = "probe";
    }
    surfaces.push({
      path,
      get: get as Surface["get"],
      params,
    });
  }
  return surfaces;
}

/* ------------------------------------------------------------------ *
 *  The claim vocabulary
 * ------------------------------------------------------------------ */

/** The act. Matches the verb and the gerund; `scanner`/`scanners` are nouns. */
const SCAN_ACT = /\bscan(?:s|ned|ning)?\b/i;
/** What a user hands us. A sentence with no subject is not a claim about uploads. */
const UPLOAD_SUBJECT = /\b(?:files?|uploads?|inputs?)\b/i;
/** Anything that flips the sentence to "no scan happened, or will". */
const NEGATION =
  /\b(?:not|never|no|nothing|none|neither|without|unless|until|cannot|can(?:'|’)t|won(?:'|’)t|wouldn(?:'|’)t|isn(?:'|’)t|aren(?:'|’)t|doesn(?:'|’)t|don(?:'|’)t)\b/i;

type Claim = "scanned" | "not-scanned";

/** Classify one sentence, or `null` when it makes no claim about uploads. */
function classify(sentence: string): Claim | null {
  if (!SCAN_ACT.test(sentence)) return null;
  if (!UPLOAD_SUBJECT.test(sentence)) return null;
  return NEGATION.test(sentence) ? "not-scanned" : "scanned";
}

/** Every string leaf of a decoded payload (prose only — never keys). */
function stringLeaves(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) stringLeaves(v, out);
  }
  return out;
}

/**
 * An address, not a sentence. A URL's slug is made of words and says nothing:
 * `/guides/how-to-make-a-scanned-pdf-searchable` is not a claim that uploads
 * are scanned.
 */
const URL_TOKEN = /\bhttps?:\/\/[^\s<>"']+/gi;

/**
 * Split a served body into sentences, JSON or not.
 *
 * WAS: a non-JSON body became ONE sentence, split only at `. ; ! ?`. That held
 * for every surface this walked until 2026-09-27, when `/sitemaps/pages.xml`
 * joined the corpus — 67 `<loc>` URLs with no sentence punctuation between
 * them. `scanned` from one guide's URL and `files` from ANOTHER guide's URL
 * landed in the same "sentence", and the classifier correctly read the
 * sentence it was handed as "uploads are scanned". The classifier was right;
 * the splitter had built a sentence that no document contains. A composed
 * check failing at the seam, not at either part.
 *
 * So a markup tag now ends a sentence too — no claim spans two elements — and
 * URLs are removed before classifying. Neither change can hide a real claim:
 * prose never lives inside a URL, and a sentence that crossed an element
 * boundary was never one sentence. The controls below pin both directions.
 */
function sentencesOf(body: string): string[] {
  let prose: string[];
  try {
    prose = stringLeaves(JSON.parse(body) as unknown, []);
  } catch {
    prose = [body]; // a non-JSON surface (an icon, a text file) is still read
  }
  return prose
    .map((s) => s.replace(URL_TOKEN, " "))
    .flatMap((s) => s.split(/(?<=[.;!?])\s+|<[^>]*>/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 *  The worlds
 * ------------------------------------------------------------------ */

/** A drainable stack with a broker, so the heartbeat read is live in every world. */
const BASE_ENV: Record<string, string> = {
  PDFXYZ_STORAGE_PROVIDER: "s3",
  PDFXYZ_S3_ENDPOINT: "https://s3.example.com",
  PDFXYZ_S3_REGION: "auto",
  PDFXYZ_S3_BUCKET: "private-bucket",
  PDFXYZ_S3_ACCESS_KEY_ID: "AKIAEXAMPLE123",
  PDFXYZ_S3_SECRET_ACCESS_KEY: "secret-value",
  PDFXYZ_QUEUE_PROVIDER: "redis",
  PDFXYZ_REDIS_REST_URL: "https://redis.example.com",
  PDFXYZ_REDIS_REST_TOKEN: "redis-secret",
  PDFXYZ_WORKER_HEARTBEAT: "enabled",
};

function heartbeat(malwareScan: boolean): WorkerHeartbeat {
  return buildHeartbeat({
    mode: "loop",
    capabilities: {
      deepCompression: true,
      ocr: true,
      ocrLanguages: [],
      malwareScan,
      atomicQueue: true,
      chunkedTranslate: true,
      deliveryCap: true,
      aiReadCap: true,
    },
    at: Date.now(),
  });
}

interface World {
  readonly name: string;
  /** What the RUNNING WORKER reports — the only tier that knows. */
  readonly beat: WorkerHeartbeat | null;
  /** Extra web-tier environment, to prove it is not what the answer comes from. */
  readonly env: Record<string, string>;
  /** The honest answer every surface owes a caller in this world. */
  readonly truth: Claim;
}

const WORLDS: readonly World[] = [
  // Production, 2026-08-22: a scanning worker and a web tier with no scanner.
  {
    name: "worker reports an active scanner",
    beat: heartbeat(true),
    env: {},
    truth: "scanned",
  },
  {
    name: "worker reports no scanner",
    beat: heartbeat(false),
    env: {},
    truth: "not-scanned",
  },
  // No beat ⇒ the control is unverified, and an unverified security control must
  // read as ABSENT (src/lib/workers/scan/capability.ts), never as present.
  {
    name: "no heartbeat is visible",
    beat: null,
    env: {},
    truth: "not-scanned",
  },
  // The web tier's OWN scanner setting is malformed while the worker scans. The
  // web process does not scan anything, so its setting is not a fact about
  // uploads — and this is the world in which the old row was loudest.
  {
    name: "worker scans, web tier's own scanner setting is malformed",
    beat: heartbeat(true),
    env: { PDFXYZ_MALWARE_SCANNER: "http://not-a-clamd-endpoint" },
    truth: "scanned",
  },
];

/* ------------------------------------------------------------------ *
 *  The probe
 * ------------------------------------------------------------------ */

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function enterWorld(world: World): void {
  process.env = { ...ORIGINAL_ENV, ...BASE_ENV, ...world.env };
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    async json() {
      return { result: world.beat ? serializeHeartbeat(world.beat) : null };
    },
  })) as unknown as typeof fetch;
}

interface Reading {
  readonly path: string;
  readonly claims: readonly { sentence: string; claim: Claim }[];
  readonly error: string | null;
}

async function readWorld(
  surfaces: readonly Surface[],
  world: World,
): Promise<Reading[]> {
  enterWorld(world);
  const readings: Reading[] = [];
  for (const surface of surfaces) {
    try {
      const url = `http://localhost${surface.path
        .replace(/^\/src\/app/, "")
        .replace(/\/route\.ts$/, "")
        .replace(/\[\.{0,3}(\w+)\]/g, "probe")}`;
      const res = await surface.get(new Request(url), {
        params: Promise.resolve(surface.params),
      });
      const claims: { sentence: string; claim: Claim }[] = [];
      for (const sentence of sentencesOf(await res.text())) {
        const claim = classify(sentence);
        if (claim) claims.push({ sentence, claim });
      }
      readings.push({ path: surface.path, claims, error: null });
    } catch (cause) {
      readings.push({
        path: surface.path,
        claims: [],
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return readings;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

/* ------------------------------------------------------------------ *
 *  1. The corpus is the route tree, and it is not empty
 * ------------------------------------------------------------------ */

describe("the surface corpus is derived from the route tree", () => {
  it("enumerates the same routes by filesystem walk and by bundler glob", () => {
    // A broken link here is FATAL, not a shrink: `[] ⊆ X` passes vacuously, so a
    // corpus that quietly lost members would report the strongest possible pass.
    expect({ globbed: GLOBBED }).toEqual({ globbed: WALKED });
  });

  it("finds a plausible number of routes, and a plausible number that answer GET", async () => {
    // Bound the corpus's own size in both directions. Eleven route files today;
    // a walk that returns two has a bug, and every assertion below would then
    // pass for the wrong reason.
    expect(WALKED.length).toBeGreaterThanOrEqual(8);
    const surfaces = await loadSurfaces();
    expect(surfaces.map((s) => s.path).length).toBeGreaterThanOrEqual(4);
  });

  it("gets an answer out of every GET surface — an unprobed surface is an unchecked claim", async () => {
    const surfaces = await loadSurfaces();
    const readings = await readWorld(surfaces, WORLDS[0]!);
    expect(
      readings.filter((r) => r.error).map((r) => `${r.path}: ${r.error}`),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  2. The claim vocabulary catches what is actually shipped
 * ------------------------------------------------------------------ */

describe("the claim vocabulary is exercised by shipped copy", () => {
  it("classifies at least one shipped sentence into each arm", async () => {
    const surfaces = await loadSurfaces();
    const seen = new Set<Claim>();
    for (const world of WORLDS) {
      for (const reading of await readWorld(surfaces, world)) {
        for (const { claim } of reading.claims) seen.add(claim);
      }
    }
    // A pattern nothing exercises is decoration. If the negation vocabulary
    // stopped matching, `not-scanned` would empty and every agreement assertion
    // below would pass by never disagreeing with anything.
    expect([...seen].sort()).toEqual(["not-scanned", "scanned"]);
  });

  it("keeps every surface that speaks in one world speaking in all of them", async () => {
    const surfaces = await loadSurfaces();
    const byWorld = new Map<string, Set<string>>();
    for (const world of WORLDS) {
      const speaking = new Set<string>();
      for (const reading of await readWorld(surfaces, world)) {
        if (reading.claims.length > 0) speaking.add(reading.path);
      }
      byWorld.set(world.name, speaking);
    }
    const union = new Set([...byWorld.values()].flatMap((s) => [...s]));
    // Two surfaces have to be talking for "they must agree" to mean anything at
    // all; with one, the property is a tautology about itself.
    expect([...union].sort().length).toBeGreaterThanOrEqual(2);
    // And copy rewritten into a shape this vocabulary cannot see must fail loudly
    // rather than silently emptying the corpus for that world.
    for (const [world, speaking] of byWorld) {
      expect({ world, speaking: [...speaking].sort() }).toEqual({
        world,
        speaking: [...union].sort(),
      });
    }
  });
});

/* ------------------------------------------------------------------ *
 *  3. The property
 * ------------------------------------------------------------------ */

describe("every live surface answers the running worker's answer about uploads", () => {
  for (const world of WORLDS) {
    it(`agrees on "${world.truth}" when ${world.name}`, async () => {
      const surfaces = await loadSurfaces();
      const readings = await readWorld(surfaces, world);
      // Print the MEMBERS, never a count: a disagreement has to arrive with the
      // sentence that caused it, or the next reader re-derives it from scratch.
      const wrong = readings.flatMap((r) =>
        r.claims
          .filter((c) => c.claim !== world.truth)
          .map((c) => `${r.path} says "${c.claim}": ${c.sentence}`),
      );
      expect(wrong).toEqual([]);
    });
  }
});

describe("the sentence splitter builds only sentences a document contains", () => {
  it("does not assemble a claim out of two different URLs", () => {
    // The body that broke it, reduced: `scanned` in one guide's slug, `files`
    // in another's, no sentence punctuation between them.
    const sitemapShape = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      "<url><loc>https://pdf.xyz/guides/how-to-make-a-scanned-pdf-searchable</loc></url>",
      "<url><loc>https://pdf.xyz/guides/how-to-merge-pdf-files</loc></url>",
      "</urlset>",
    ].join(String.fromCharCode(10));
    const claims = sentencesOf(sitemapShape)
      .map(classify)
      .filter((c) => c !== null);
    expect(claims).toEqual([]);
  });

  it("ends a sentence at a tag, even between prose elements", () => {
    // Isolates the TAG split. No URL here, so URL stripping cannot rescue it:
    // without the split, these two list items read as one sentence with an
    // upload subject and a scan verb.
    const list =
      "<ul><li>Files are uploaded over TLS</li><li>scanned documents become searchable</li></ul>";
    expect(
      sentencesOf(list)
        .map(classify)
        .filter((c) => c !== null),
    ).toEqual([]);
  });

  it("does not read a URL's slug as words in a sentence", () => {
    // Isolates the URL strip. One sentence, no tags, so the tag split cannot
    // rescue it: the only `scanned` is inside the address.
    const oneSentence =
      "Your files stay local — read https://pdf.xyz/guides/how-to-make-a-scanned-pdf-searchable to learn more";
    expect(
      sentencesOf(oneSentence)
        .map(classify)
        .filter((c) => c !== null),
    ).toEqual([]);
  });

  it("still hears a real claim, in markup and in JSON, in both arms", () => {
    // Positive controls THROUGH the splitter, so the fix above cannot have
    // blinded it: the shipped sentence from the 2026-08-22 incident, wrapped
    // in an element, and its negation inside a JSON payload.
    const html =
      "<p>Every file is scanned for malware before any processor touches it.</p>";
    expect(sentencesOf(html).map(classify)).toContain("scanned");

    const json = JSON.stringify({
      detail: "Malware scanning is not configured; uploads are not scanned.",
    });
    expect(sentencesOf(json).map(classify)).toContain("not-scanned");

    // And a URL inside an otherwise real sentence does not stop it counting.
    const withLink =
      "Uploads are scanned before processing — see https://pdf.xyz/privacy for how.";
    expect(sentencesOf(withLink).map(classify)).toContain("scanned");
  });
});
