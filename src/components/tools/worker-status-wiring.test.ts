// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { panelDispatchArms } from "@/tests/worker-panel-dispatch";

/**
 * One status check per page, one stage list per panel, one phase source per
 * job (spec E.10).
 *
 * WHAT IT REPLACED: thirteen panels each ran their own copy of the status
 * effect — plus Compress PDF's deep panel, a fourteenth — and each rendered
 * its own copy of `workerPipelineStages(…)` as a "What happens" list that no
 * job ever updated. A page that mounted two of them asked twice; a list that
 * never moved said nothing about the job in front of it.
 *
 * The SET is discovered, never typed: every `*-worker-panel.tsx` in this
 * directory, held equal to the panels the tool page's registry routes
 * (`panelDispatchArms`), and every `.ts`/`.tsx` under `src` for the two
 * call shapes. A walk that finds too few files is FATAL, not a pass.
 */

const SRC = path.join(process.cwd(), "src");
const TOOLS = path.join(SRC, "components", "tools");

const rel = (file: string) =>
  path.relative(process.cwd(), file).replace(/\\/g, "/");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const SOURCES = walk(SRC);
const PANELS = readdirSync(TOOLS)
  .filter((name) => name.endsWith("-worker-panel.tsx"))
  .map((name) => path.join(TOOLS, name));

/** `fetch("/api/worker/status"` with any quote, and whitespace after `(`. */
export const STATUS_FETCH = /\bfetch\(\s*["'`]\/api\/worker\/status["'`]/;
/** A call (not an import or a mention in prose) of the stage function. */
export const STAGES_CALL = /\bworkerPipelineStages\(/;

/** The one owner of each shape, and why it is allowed. */
const STATUS_FETCH_OWNERS = new Set([
  // The shared, cached, once-per-page check.
  "src/components/tools/use-worker-status.ts",
  // The /status page: an operator's live view, not a tool panel. It shows the
  // status itself, polls it on purpose, and never gates a run.
  "src/components/status/system-status.tsx",
]);
const STAGES_CALL_OWNERS = new Set([
  "src/lib/jobs/capabilities.ts", // the definition
  "src/components/tools/worker-panel-shell.tsx", // the one panel caller
]);

/** Lines with their full-line comments dropped; prose may name the call. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

describe("worker status wiring", () => {
  it("health: the walk is the size of the tree, and the panels are all found", () => {
    expect(SOURCES.length).toBeGreaterThan(400);
    expect(PANELS.length).toBeGreaterThanOrEqual(13);
  });

  it("the panel files are exactly the panels the tool page routes", () => {
    const routed = new Set(panelDispatchArms().map((arm) => arm.file));
    expect(routed.size).toBeGreaterThanOrEqual(13);
    expect(new Set(PANELS.map(rel))).toEqual(routed);
  });

  it("positive control: both patterns catch the shapes they name", () => {
    expect(
      STATUS_FETCH.test(
        `fetch("/api/worker/status", { headers: { accept: "x" } })`,
      ),
    ).toBe(true);
    expect(STATUS_FETCH.test("fetch( '/api/worker/status')")).toBe(true);
    expect(STAGES_CALL.test("workerPipelineStages(status, tool)")).toBe(true);
    expect(STATUS_FETCH.test(`import { x } from "./status"`)).toBe(false);
  });

  it("no module but the shared hook fetches the worker status", () => {
    const callers = SOURCES.filter((f) => STATUS_FETCH.test(code(f))).map(rel);
    // Health: the owner is still found — a moved hook would make this empty.
    expect(callers).toContain("src/components/tools/use-worker-status.ts");
    expect(callers.filter((f) => !STATUS_FETCH_OWNERS.has(f))).toEqual([]);
  });

  it("no panel or runner builds its own stage list", () => {
    const callers = SOURCES.filter((f) => STAGES_CALL.test(code(f))).map(rel);
    expect(callers).toContain("src/components/tools/worker-panel-shell.tsx");
    expect(callers.filter((f) => !STAGES_CALL_OWNERS.has(f))).toEqual([]);
  });

  it("every panel is drawn on the shell", () => {
    const off = PANELS.filter((f) => !/<WorkerPanelShell\b/.test(code(f))).map(
      rel,
    );
    expect(off).toEqual([]);
  });

  it("every pollJobToTerminal( call site forwards onStatus", () => {
    const sites = SOURCES.flatMap((file) => {
      const source = code(file);
      const out: { file: string; call: string }[] = [];
      for (const m of source.matchAll(/\bpollJobToTerminal\(\s*\{/g)) {
        // The options object, to its closing brace.
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < source.length; end++) {
          if (source[end] === "{") depth++;
          else if (source[end] === "}" && --depth === 0) break;
        }
        out.push({ file: rel(file), call: source.slice(m.index, end + 1) });
      }
      return out;
    }).filter((site) => site.file !== "src/lib/workers/job-polling.ts");
    // The corpus bound: client.ts, ocr-client.ts and pdf-security-client.ts
    // (which html-render, office, structure, archive and the AI clients reach
    // through `runSecurityJob` / `finishSecurityJob`).
    expect(sites.length).toBeGreaterThanOrEqual(3);
    const silent = sites
      .filter((site) => !/\bonStatus\b/.test(site.call))
      .map((site) => site.file);
    expect(silent).toEqual([]);
  });
});
