// @vitest-environment node
/**
 * THE PROPERTY: for a worker-tier tool, the size its page states is no more
 * than what the ENGINE that runs it accepts — and the upload validator refuses
 * above that same figure, so a file the engine would reject never moves.
 *
 * Measured before this guard (audit at 67e8d0f, production): Word, Excel and
 * PowerPoint to PDF stated "Up to 100 MB per file" (FAQ + FAQPage JSON-LD +
 * the panel's "Limit 100.0 MB/file"), while LibreOffice refused anything over
 * 50 MB, after the upload, with a message that named no number. HTML to PDF
 * stated 100 MB over a 20 MB renderer. `file-ceilings.ts` said every worker
 * tool is refused at the upload gate; two engines refuse less.
 *
 * DERIVED, never typed:
 *  - the engines come from walking `src/lib/workers` for every
 *    `*native-config.ts` and CALLING each `resolveNative*Config({})`, the same
 *    resolver the daemon's deps builders call. Any engine whose default input
 *    cap is under the upload gate must be declared in
 *    WORKER_ENGINE_FILE_CEILINGS (`@/lib/workers/engine-file-ceilings`),
 *    linked by the identity of its exported tool list;
 *  - each declared engine's gate is RUN, through its real deps builder
 *    (env → config → deps.limits → engine), at the ceiling and one byte over;
 *  - each tool's upload is run through the real `parseCreateUploadSessionRequest`.
 *
 * EXIT CONDITION (the property, not a mechanism): an engine leaves the table
 * when its enforced default is at least the upload gate — never because the
 * page and a constant agree.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getToolInputKind } from "@/lib/jobs/capabilities";
import { MIME_BY_FORMAT } from "@/lib/jobs/mime-by-format";
import { parseCreateUploadSessionRequest } from "@/lib/jobs/validation";
import { runHtmlToPdf } from "@/lib/workers/html-render/engine";
import { nativeHtmlRenderDeps } from "@/lib/workers/html-render/native";
import {
  runOfficeToPdf,
  type OfficeToPdfTool,
} from "@/lib/workers/office-conversion/engine";
import { nativeOfficeConversionDeps } from "@/lib/workers/office-conversion/native";
import { WORKER_ENGINE_FILE_CEILINGS } from "@/lib/workers/engine-file-ceilings";
import {
  WORKER_FILE_CEILING,
  fileOverCeilingMessage,
  toolFileCeiling,
  toolFileCeilingMb,
} from "./file-ceilings";
import { getToolBySlug } from "./index";

/**
 * The engine table, as `[processor id, entry]` pairs. At the merge of
 * wave1/l06-copy-other two lanes had each written this table — this lane in
 * `src/lib/tools/worker-engine-ceilings.ts`, the other in
 * `@/lib/workers/engine-file-ceilings` — with the same two engines and the
 * same two numbers. One table survived; this guard reads it, so the figures
 * it runs are the ones the upload API and the pages read.
 */
const WORKER_ENGINE_CEILINGS = Object.entries(WORKER_ENGINE_FILE_CEILINGS).map(
  ([engine, entry]) => ({ engine, tools: entry.tools, bytes: entry.bytes }),
);

const WORKERS = path.join(process.cwd(), "src", "lib", "workers");
const FAKE_PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const NO_BINARY = { resolveOnPath: () => false, fileExists: () => false };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

interface DiscoveredEngine {
  file: string;
  defaultInputBytes: number;
  toolLists: unknown[];
}

async function discoverEngines(): Promise<DiscoveredEngine[]> {
  const files = walk(WORKERS).filter(
    (f) => /native-config\.ts$/.test(f) && !/\.test\.ts$/.test(f),
  );
  const found: DiscoveredEngine[] = [];
  for (const file of files) {
    const mod = (await import(/* @vite-ignore */ file)) as Record<
      string,
      unknown
    >;
    for (const [name, value] of Object.entries(mod)) {
      if (!/^resolveNative\w+Config$/.test(name)) continue;
      if (typeof value !== "function") continue;
      const resolved = (value as (env: object) => unknown)({}) as Record<
        string,
        unknown
      >;
      // Some resolvers return the config, some a `{ ok, config }` result.
      const config = (resolved.config ?? resolved) as Record<string, unknown>;
      const bytes = config.maxInputBytes;
      if (typeof bytes !== "number") continue;
      found.push({
        file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
        defaultInputBytes: bytes,
        toolLists: Object.entries(mod)
          .filter(([k, v]) => /_TOOLS$/.test(k) && Array.isArray(v))
          .map(([, v]) => v),
      });
    }
  }
  return found;
}

/** Engines under the gate that the table does not declare. */
function undeclared(engines: DiscoveredEngine[]): string[] {
  return engines
    .filter((e) => e.defaultInputBytes < WORKER_FILE_CEILING)
    .filter(
      (e) =>
        !WORKER_ENGINE_CEILINGS.some(
          (entry) =>
            e.toolLists.includes(entry.tools) &&
            entry.bytes === e.defaultInputBytes,
        ),
    )
    .map((e) => `${e.file} (${e.defaultInputBytes} bytes)`);
}

describe("every engine that refuses under the upload gate is declared", () => {
  it("discovers the worker engines (size floor) and none is missing", async () => {
    const engines = await discoverEngines();
    // compression, html-render, ocr, office-conversion, pdf-archive,
    // pdf-security, pdf-structure, pdf-text at the time of writing.
    expect(engines.length).toBeGreaterThanOrEqual(8);
    expect(undeclared(engines)).toEqual([]);
  });

  it("positive control: an undeclared low-cap engine is flagged", async () => {
    const engines = await discoverEngines();
    const phantom: DiscoveredEngine = {
      file: "src/lib/workers/phantom/native-config.ts",
      defaultInputBytes: 10 * 1024 * 1024,
      toolLists: [["phantom-tool"]],
    };
    expect(undeclared([...engines, phantom])).toEqual([
      "src/lib/workers/phantom/native-config.ts (10485760 bytes)",
    ]);
  });
});

type EngineRun = { ok: true } | { ok: false; kind: string; message: string };
type GateRun = (slug: string, bytes: number) => Promise<EngineRun>;

/** How to RUN each declared engine's gate, through its real deps builder. */
const ENGINE_GATES: Record<string, GateRun> = {
  "office-conversion": async (slug, bytes) => {
    const deps = {
      ...nativeOfficeConversionDeps({}, NO_BINARY),
      libreoffice: { convertToPdf: async () => FAKE_PDF },
    };
    const tool = getToolBySlug(slug)!;
    return runOfficeToPdf(
      slug as OfficeToPdfTool,
      new Uint8Array(bytes),
      `a.${tool.accept[0]!.toLowerCase()}`,
      deps,
    );
  },
  "html-render": async (_slug, bytes) => {
    const deps = {
      ...nativeHtmlRenderDeps({}, NO_BINARY),
      chromium: {
        renderHtml: async () => FAKE_PDF,
        renderUrl: async () => FAKE_PDF,
      },
    };
    return runHtmlToPdf(new Uint8Array(bytes), deps);
  },
};

const verdict = (run: EngineRun) =>
  !run.ok && run.kind === "too_large" ? "too_large" : "accepted";

const fileTools = WORKER_ENGINE_CEILINGS.flatMap((entry) =>
  entry.tools
    .filter((slug) => getToolInputKind(slug) !== "url")
    .map((slug) => [slug, entry] as const),
);

describe("the stated ceiling is the enforced one, for every declared engine tool", () => {
  it("every declared engine has a runnable gate (and the set is not empty)", () => {
    expect(fileTools.length).toBeGreaterThanOrEqual(4);
    for (const entry of WORKER_ENGINE_CEILINGS) {
      expect(ENGINE_GATES[entry.engine], entry.engine).toBeTypeOf("function");
    }
  });

  it.each(fileTools)("%s", async (slug, entry) => {
    const tool = getToolBySlug(slug);
    expect(tool, `${slug} is not in the catalogue`).toBeDefined();
    const stated = toolFileCeiling(tool!);
    expect(stated.tier).toBe("worker");
    expect(stated.bytes).toBe(Math.min(WORKER_FILE_CEILING, entry.bytes));
    const bytes = stated.bytes!;

    // The engine, run through env → config → deps.limits.
    const gate = ENGINE_GATES[entry.engine]!;
    expect(verdict(await gate(slug, bytes))).toBe("accepted");
    const refused = await gate(slug, bytes + 1);
    expect(verdict(refused)).toBe("too_large");
    // ...and the refusal names the figure the page states.
    if (!refused.ok) {
      expect(refused.message).toContain(`${toolFileCeilingMb(tool!)} MB`);
    }

    // The upload validator refuses at the same figure, before a byte moves.
    const format = tool!.accept[0]!;
    const session = (n: number) =>
      parseCreateUploadSessionRequest({
        tool: slug,
        files: [
          {
            filename: `a.${format.toLowerCase()}`,
            contentType: MIME_BY_FORMAT[format]![0],
            bytes: n,
          },
        ],
      }).ok;
    expect(session(bytes)).toBe(true);
    expect(session(bytes + 1)).toBe(false);

    // The panel's pre-upload refusal quotes the page's figure.
    expect(fileOverCeilingMessage(tool!, bytes)).toBeNull();
    expect(fileOverCeilingMessage(tool!, bytes + 1)).toContain(
      `${toolFileCeilingMb(tool!)} MB`,
    );
  });
});
