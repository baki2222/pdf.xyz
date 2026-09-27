// @vitest-environment node
/**
 * THE PROPERTY: a file at the per-file size a tool's page states is never
 * refused for its size by the engine the worker routes that tool to — and a
 * file over it is refused BEFORE a byte is uploaded, in a message that names
 * the same number.
 *
 * ── WHAT SHIPPED UNTIL 2026-09-27 ────────────────────────────────────────────
 *
 * `excel-to-pdf` (and Word, PowerPoint) stated "Limit 100.0 MB/file" in its
 * panel and "Up to 100 MB per file." in its FAQ rich result — both from
 * `JOB_LIMITS.maxFileBytes`, the worker's GLOBAL per-file cap. LibreOffice's
 * own gate (`office-conversion/native-config.ts`) refuses above 50 MB. A 50–100
 * MB workbook was accepted by the API, uploaded in full, malware-scanned, and
 * then failed with "The Office input exceeds the worker's size limit." — no
 * number, after every surface had said it was within the limit.
 *
 * `html-to-pdf` had the same shape one engine over: 100 MB stated, Chromium's
 * gate at 20 MB.
 *
 * WHY NOTHING CAUGHT IT. `file-ceilings.test.ts` already proves the rendered
 * page states the ceiling `toolFileCeiling` returns — and for the worker tier
 * that function returned `JOB_LIMITS.maxFileBytes`, which IS the upload API's
 * gate. The API is not what refuses a workbook; LibreOffice is. That guard
 * verified the page against the first gate a file meets instead of the tightest
 * one it has to pass, and every assertion in it was true.
 *
 * ── DERIVED SETS, never typed ───────────────────────────────────────────────
 *
 *  - the engines are the keys of `resolveProcessorDeps(env)`, the function the
 *    worker daemon calls to wire its processors. Its return type is
 *    `Required<SecureWorkerProcessorDeps>`, so a new processor cannot compile
 *    without appearing here;
 *  - which tools each engine owns comes from registering that engine ALONE in
 *    the real `createProcessorRegistry` and reading what it routes;
 *  - each engine's ceiling is the `limits.maxInputBytes` its resolved deps carry
 *    — the value its engine compares against — at the CODE DEFAULT (env `{}`),
 *    because the web tier cannot read the worker's environment. The one engine
 *    that keeps its limit inside its runner is named below, and that exception
 *    list is checked in both directions.
 *
 * ── WHAT IS RUN, NOT READ ──────────────────────────────────────────────────
 *
 * Every engine whose ceiling binds (is below the worker's global cap) has its
 * real processor run at the stated ceiling and one byte over; the upload API is
 * asked for a session at both sizes; and the browser driver is run with a
 * transport that records whether a request was made at all.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACCEPTED_KINDS } from "@/components/upload/accepted-kinds";
import { UploadZone } from "@/components/upload/upload-zone";
import { declaredContentTypeFor } from "@/lib/jobs/mime-by-format";
import { parseCreateUploadSessionRequest } from "@/lib/jobs/validation";
import { resolveProcessorDeps } from "@/lib/workers/daemon/runtime";
import {
  resolveNativeOcrConfig,
  NATIVE_OCR_ENV,
} from "@/lib/workers/ocr-native-config";
import {
  createProcessorRegistry,
  type ProcessorRegistry,
  type ProcessorResult,
  type SecureWorkerProcessorDeps,
} from "@/lib/workers/processor";
import { WORKER_ENGINE_FILE_CEILINGS } from "@/lib/workers/engine-file-ceilings";
import { runSecurityJob } from "@/lib/workers/pdf-security-client";
import { getToolBySlug, tools } from "./index";
import {
  WORKER_FILE_CEILING,
  toolFileCeiling,
  toolFileCeilingBytes,
  toolFileCeilingMb,
} from "./file-ceilings";
import type { Tool } from "./types";

const MB = 1024 * 1024;

/* ------------------------------------------------------------------ *
 *  The worker's own wiring, at its code defaults.
 * ------------------------------------------------------------------ */

type DepsKey = keyof SecureWorkerProcessorDeps;

const resolved = resolveProcessorDeps({});
const KEYS = Object.keys(resolved) as DepsKey[];

function routedBy(registry: ProcessorRegistry): Set<string> {
  return new Set(registry.list().flatMap((processor) => [...processor.tools]));
}

/** Processors `createProcessorRegistry` registers with no deps at all. */
const ALWAYS_ROUTED = routedBy(createProcessorRegistry({}));

/** deps key → the tools the worker routes to that engine. */
const OWNED = new Map<DepsKey, string[]>();
for (const key of KEYS) {
  const alone = routedBy(createProcessorRegistry({ [key]: resolved[key] }));
  OWNED.set(
    key,
    [...alone].filter((tool) => !ALWAYS_ROUTED.has(tool)),
  );
}
/** The one key whose processor is registered even without deps owns those. */
const ALWAYS_KEYS = KEYS.filter((key) => OWNED.get(key)!.length === 0);
for (const key of ALWAYS_KEYS) OWNED.set(key, [...ALWAYS_ROUTED]);

/**
 * Engines that enforce their input limit inside the RUNNER's config rather than
 * through `deps.limits` — so the deps carry no number to read. OCR is opt-in:
 * with `PDFXYZ_OCR` unset its deps are empty, and the limit a production worker
 * (which opts in) enforces is its config's default.
 */
const LIMIT_INSIDE_RUNNER: Partial<Record<DepsKey, () => number>> = {
  ocr: () =>
    resolveNativeOcrConfig({ [NATIVE_OCR_ENV.enable]: "1" }).maxInputBytes,
};

function depsLimit(key: DepsKey): number | undefined {
  const deps = resolved[key] as { limits?: { maxInputBytes?: number } };
  return deps.limits?.maxInputBytes;
}

/** The byte count above which this engine refuses an input. */
function engineCeiling(key: DepsKey): number {
  const inRunner = LIMIT_INSIDE_RUNNER[key];
  const limit = inRunner ? inRunner() : depsLimit(key);
  if (limit === undefined) {
    throw new Error(
      `the worker's ${key} engine carries no input limit this guard can read — ` +
        "state where it enforces one in LIMIT_INSIDE_RUNNER, or give it one",
    );
  }
  return limit;
}

function ownerOf(slug: string): DepsKey | undefined {
  for (const [key, owned] of OWNED) if (owned.includes(slug)) return key;
  return undefined;
}

/** Catalogue tools the worker routes, with the engine that runs them. */
const ROUTED_TOOLS: readonly { tool: Tool; key: DepsKey }[] = tools.flatMap(
  (tool) => {
    const key = ownerOf(tool.slug);
    return key ? [{ tool, key }] : [];
  },
);

/** …of those, the ones a user uploads a file to. */
const ROUTED_FILE_TOOLS = ROUTED_TOOLS.filter(
  ({ tool }) => toolFileCeilingBytes(tool) !== null,
);

/** Engines whose own gate is tighter than the worker's global per-file cap. */
const BINDING_KEYS = KEYS.filter(
  (key) =>
    OWNED.get(key)!.length > 0 && engineCeiling(key) < WORKER_FILE_CEILING,
);

function mbFigures(text: string): number[] {
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*MB\b/g)].map((match) =>
    Number(match[1]!.replace(/,/g, "")),
  );
}

function filenameFor(tool: Tool): string {
  return `input.${tool.accept[0]!.toLowerCase()}`;
}

/* ------------------------------------------------------------------ *
 *  Running the real processor: only the native binary is faked.
 * ------------------------------------------------------------------ */

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);

/**
 * For each binding engine, the one thing a host without the binary lacks.
 * Everything else — limits, validation, error mapping — is the worker's own.
 */
const WITH_FAKE_BINARY: Partial<
  Record<
    DepsKey,
    (deps: SecureWorkerProcessorDeps) => SecureWorkerProcessorDeps
  >
> = {
  officeConversion: (deps) => ({
    officeConversion: {
      ...deps.officeConversion,
      libreoffice: { convertToPdf: async () => PDF },
    },
  }),
  htmlRender: (deps) => ({
    htmlRender: {
      ...deps.htmlRender,
      chromium: { renderHtml: async () => PDF, renderUrl: async () => PDF },
    },
  }),
};

/**
 * For each binding engine, the variable an operator sets to change its limit.
 * The web tier publishes the CODE default because it cannot read the worker's
 * environment; so the override may lower the limit (the refusal then names the
 * lower figure) but must never raise it past the number the page promised.
 */
const OVERRIDE_ENV: Partial<Record<DepsKey, string>> = {
  officeConversion: "PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES",
  htmlRender: "PDFXYZ_HTML_RENDER_MAX_INPUT_BYTES",
};

async function runAt(
  key: DepsKey,
  tool: Tool,
  bytes: number,
): Promise<ProcessorResult> {
  const inject = WITH_FAKE_BINARY[key];
  if (!inject) throw new Error(`no run probe for the ${key} engine`);
  const registry = createProcessorRegistry(inject(resolved));
  const processor = registry.resolve(tool.slug);
  if (!processor) throw new Error(`${tool.slug} is not routed with ${key}`);
  const filename = filenameFor(tool);
  return processor.process({
    tool: tool.slug,
    options: {},
    inputs: [
      {
        fileId: "f",
        filename,
        contentType: declaredContentTypeFor(filename) ?? "",
        bytes: new Uint8Array(bytes),
      },
    ],
  });
}

/* ================================================================== *
 *  1. The derived sets are alive.
 * ================================================================== */

describe("the worker's wiring is discovered, not listed", () => {
  it("resolves every engine the worker wires (vacuity bound)", () => {
    // `[] ⊆ X` is vacuously true: an empty or collapsed wiring would report
    // the strongest possible pass on every per-tool check below.
    expect(KEYS.length).toBeGreaterThanOrEqual(12);
    expect(KEYS.length).toBeLessThanOrEqual(30);
    for (const key of KEYS) {
      expect(
        OWNED.get(key)!.length,
        `the worker wires ${key} but it routes no tool`,
      ).toBeGreaterThanOrEqual(1);
    }
    // Exactly one processor registers without deps (OCR, so its honest
    // not-implemented capability is discoverable). Two would make the
    // attribution above ambiguous.
    expect(ALWAYS_KEYS).toHaveLength(1);
    expect(ALWAYS_ROUTED.size).toBeGreaterThanOrEqual(1);
  });

  it("finds the catalogue's worker tools among what the worker routes", () => {
    expect(ROUTED_TOOLS.length).toBeGreaterThanOrEqual(20);
    expect(ROUTED_FILE_TOOLS.length).toBeGreaterThanOrEqual(18);
    // Anchors across engines, so a silently shrinking set fails here rather
    // than passing everything below.
    const slugs = ROUTED_TOOLS.map(({ tool }) => tool.slug);
    for (const slug of [
      "excel-to-pdf",
      "html-to-pdf",
      "ocr-pdf",
      "pdf-to-pdfa",
    ])
      expect(slugs).toContain(slug);
    // Every worker-tier tool the catalogue offers is one the worker can route;
    // otherwise its page states a ceiling no engine was ever compared with.
    const unrouted = tools
      .filter((tool) => toolFileCeiling(tool).tier === "worker")
      .filter((tool) => !ownerOf(tool.slug))
      .map((tool) => tool.slug);
    expect(unrouted).toEqual([]);
  });

  it("every engine states a ceiling, and the in-runner exceptions are real", () => {
    for (const key of KEYS) expect(() => engineCeiling(key)).not.toThrow();
    // Both directions: an exception for an engine whose deps DO carry a limit
    // would hide that limit behind a second number.
    for (const key of Object.keys(LIMIT_INSIDE_RUNNER) as DepsKey[]) {
      expect(KEYS).toContain(key);
      expect(
        depsLimit(key),
        `${key} carries deps.limits now — read it there, drop the exception`,
      ).toBeUndefined();
    }
    // Health: the exception reads an ENABLED config, not the disabled default.
    expect(
      resolveNativeOcrConfig({ [NATIVE_OCR_ENV.enable]: "1" }).enabled,
    ).toBe(true);
  });

  it("the published engine map names the processor that really runs each tool", () => {
    // `WORKER_ENGINE_FILE_CEILINGS` is keyed by processor id. A key that no
    // longer routes its tools would state one engine's number for another's.
    const wired = createProcessorRegistry(resolved);
    const entries = Object.entries(WORKER_ENGINE_FILE_CEILINGS);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const [processorId, engine] of entries) {
      for (const slug of engine.tools) {
        expect(
          wired.resolve(slug)?.id,
          `${slug} is listed under ${processorId}`,
        ).toBe(processorId);
      }
    }
  });

  it("the binding set is not empty, and each binding engine has a run probe", () => {
    // If no engine were tighter than the worker's cap this whole file would be
    // checking one number against itself.
    expect(BINDING_KEYS.length).toBeGreaterThanOrEqual(1);
    for (const key of BINDING_KEYS) {
      expect(
        WITH_FAKE_BINARY[key],
        `${key} refuses below the worker's cap but is never RUN against it`,
      ).toBeDefined();
    }
    for (const key of Object.keys(WITH_FAKE_BINARY) as DepsKey[]) {
      expect(
        BINDING_KEYS,
        `${key} has a run probe but its ceiling does not bind — decoration`,
      ).toContain(key);
    }
  });
});

describe("the published figure is an upper bound the worker's env cannot move", () => {
  it("every binding engine names its override variable, and only those do", () => {
    expect(Object.keys(OVERRIDE_ENV).sort()).toEqual([...BINDING_KEYS].sort());
  });

  it.each(BINDING_KEYS)(
    "%s: an override above the default is clamped; one below still applies",
    (key) => {
      const variable = OVERRIDE_ENV[key]!;
      const published = engineCeiling(key);
      const raised = resolveProcessorDeps({
        [variable]: String(published * 4),
      });
      expect(
        (raised[key] as { limits?: { maxInputBytes?: number } }).limits
          ?.maxInputBytes,
        `${variable} raised ${key} past the figure every page states`,
      ).toBe(published);
      // Positive control: the variable is really the one this engine reads,
      // so the clamp above is not a variable that does nothing.
      const lowered = resolveProcessorDeps({ [variable]: "1048576" });
      expect(
        (lowered[key] as { limits?: { maxInputBytes?: number } }).limits
          ?.maxInputBytes,
      ).toBe(1_048_576);
    },
  );
});

/* ================================================================== *
 *  2. The stated ceiling is one the engine honours.
 * ================================================================== */

describe("every stated per-file ceiling is within its engine's", () => {
  it.each(
    ROUTED_FILE_TOOLS.map(({ tool, key }) => [tool.slug, key, tool] as const),
  )("%s (%s) states no more than its engine accepts", (slug, key, tool) => {
    const stated = toolFileCeilingBytes(tool)!;
    const engine = engineCeiling(key);
    expect(
      stated <= engine,
      `${slug} states ${stated / MB} MB but the worker's ${key} engine ` +
        `refuses above ${engine / MB} MB — a file between the two is ` +
        "uploaded in full and then failed",
    ).toBe(true);
    // And where the ENGINE is the tighter gate, the page states the engine's
    // number rather than something arbitrarily lower.
    if (toolFileCeiling(tool).tier === "worker" && engine < WORKER_FILE_CEILING)
      expect(stated).toBe(engine);
  });
});

/* ================================================================== *
 *  3. RUN: the processor, the upload API, the browser driver.
 * ================================================================== */

describe("an over-ceiling file is refused before upload, in the page's number", () => {
  // One tool per binding engine: each run allocates the ceiling in bytes.
  const PROBES = BINDING_KEYS.map((key) => {
    const entry = ROUTED_FILE_TOOLS.find((routed) => routed.key === key);
    if (!entry) throw new Error(`${key} binds but routes no file tool`);
    return [key, entry.tool] as const;
  });

  it.each(PROBES)(
    "%s: the real processor accepts the stated ceiling and refuses one byte more, naming it",
    async (key, tool) => {
      const stated = toolFileCeilingBytes(tool)!;
      const at = await runAt(key, tool, stated);
      expect(
        at.ok,
        `${tool.slug} was refused AT its stated ceiling: ` +
          (at.ok ? "" : at.error.message),
      ).toBe(true);
      const over = await runAt(key, tool, stated + 1);
      expect(over.ok).toBe(false);
      if (over.ok) return;
      expect(over.error.code).toBe("payload_too_large");
      expect(
        mbFigures(over.error.message),
        `the worker's refusal must name the number the page stated`,
      ).toEqual([toolFileCeilingMb(tool)]);
    },
    30_000,
  );

  it.each(
    ROUTED_FILE_TOOLS.map(({ tool, key }) => [tool.slug, key, tool] as const),
  )(
    "%s: the upload API refuses a session one byte over its engine's ceiling",
    (slug, key, tool) => {
      const filename = filenameFor(tool);
      const contentType = declaredContentTypeFor(filename);
      expect(contentType, `${filename} has no declared type`).not.toBeNull();
      const session = (bytes: number) =>
        parseCreateUploadSessionRequest({
          tool: slug,
          files: [{ filename, contentType, bytes }],
        });
      const limit = Math.min(engineCeiling(key), WORKER_FILE_CEILING);
      expect(session(limit).ok, `${slug} refused at ${limit} bytes`).toBe(true);
      const over = session(limit + 1);
      expect(
        over.ok,
        `${slug}: a ${limit + 1}-byte file got an upload slot — it would be ` +
          "uploaded in full before the engine refused it",
      ).toBe(false);
    },
  );

  it.each(PROBES)(
    "%s: the browser driver refuses without a single request, naming the ceiling",
    async (_key, tool) => {
      const stated = toolFileCeilingBytes(tool)!;
      // A counter, not a spy: a failing spy prints the request body, which is
      // the byte array.
      const requested: string[] = [];
      const fetchImpl = async (input: string) => {
        requested.push(input);
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      };
      const result = await runSecurityJob(
        tool.slug,
        filenameFor(tool),
        new Uint8Array(stated + 1),
        {},
        { fetchImpl: fetchImpl as never },
      );
      expect(result.ok).toBe(false);
      expect(
        requested,
        `${tool.slug}: the driver made a request for an over-ceiling file`,
      ).toEqual([]);
      if (result.ok) return;
      expect(mbFigures(result.message)).toEqual([toolFileCeilingMb(tool)]);
    },
    30_000,
  );
});

/* ================================================================== *
 *  4. Controls.
 * ================================================================== */

/* ================================================================== *
 *  4. The other drop zone: homepage and workspace.
 * ================================================================== */

/** File extensions a kind admits, in the catalogue's `accept` spelling. */
function kindFormats(kind: (typeof ACCEPTED_KINDS)[number]): Set<string> {
  return new Set(
    kind.accept
      .filter((token) => token.startsWith("."))
      .map((token) => token.slice(1).toUpperCase()),
  );
}

describe("the general drop zone never promises a kind more than a tool taking it accepts", () => {
  // Rendered: the caption a visitor reads above the homepage picker, before
  // they have chosen a tool. It stated "Word, Excel, PowerPoint up to 100 MB"
  // while the only tools taking those files refuse above 50.
  const caption = renderToStaticMarkup(createElement(UploadZone, {}))
    .replace(/<[^>]*>/g, " ")
    .replace(/&middot;|&#183;/g, "·");

  function statedMb(label: string): number | undefined {
    const clause = caption.split("·").find((part) => part.includes(label));
    const figures = clause ? mbFigures(clause) : [];
    return figures.length === 1 ? figures[0] : undefined;
  }

  it("the caption states a figure for every kind (health check)", () => {
    expect(ACCEPTED_KINDS.length).toBeGreaterThanOrEqual(5);
    for (const kind of ACCEPTED_KINDS) {
      expect(statedMb(kind.label), `no figure for ${kind.label}`).toBeDefined();
    }
  });

  it.each(ACCEPTED_KINDS.map((kind) => [kind.label, kind] as const))(
    "%s: every tool that takes it accepts at least the stated size",
    (label, kind) => {
      const formats = kindFormats(kind);
      const takers = tools.filter(
        (tool) =>
          toolFileCeilingBytes(tool) !== null &&
          tool.accept.some((format) => formats.has(format.toUpperCase())),
      );
      // Vacuity: a kind no tool takes would pass every comparison below.
      expect(takers.length, `no tool takes ${label}`).toBeGreaterThanOrEqual(1);
      const stated = statedMb(label)! * MB;
      for (const tool of takers) {
        expect(
          stated <= toolFileCeilingBytes(tool)!,
          `the drop zone promises ${label} up to ${stated / MB} MB, but ` +
            `${tool.slug} refuses above ${toolFileCeilingMb(tool)} MB`,
        ).toBe(true);
      }
    },
  );
});

describe("controls", () => {
  it("positive control: the ceiling excel-to-pdf shipped with is caught", () => {
    // What the panel and FAQ stated until 2026-09-27, against the engine that
    // runs the tool. If ownership or the engine read goes blind, this stops
    // failing the predicate and "every tool is within its engine" means nothing.
    const key = ownerOf("excel-to-pdf");
    expect(key).toBe("officeConversion");
    const shipped = WORKER_FILE_CEILING;
    expect(shipped <= engineCeiling(key!)).toBe(false);
    expect(getToolBySlug("excel-to-pdf")).toBeDefined();
  });

  it("health check: the MB extractor reads the spellings that ship", () => {
    expect(mbFigures("exceeds the 50 MB per-file limit")).toEqual([50]);
    expect(mbFigures("This file is 62.5 MB; the limit is 20 MB.")).toEqual([
      62.5, 20,
    ]);
    expect(
      mbFigures("The Office input exceeds the worker's size limit."),
    ).toEqual([]);
  });
});
