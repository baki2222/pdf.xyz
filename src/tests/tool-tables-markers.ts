/**
 * How to recognise, in a BUILT chunk, the tables that answer for every tool —
 * the ones a tool page's first load must not carry (`lazy-chunks.test.ts`,
 * "no tool page loads a table of every tool").
 *
 * Each table is recognised by its own rows, read from the module that defines
 * it, as minification writes them: an object key is quoted only when it is
 * not an identifier, and a string keeps its quotes. No marker is typed here,
 * so a row added to a table adds a row to its marker, and a table whose rows
 * the build no longer writes this way fails the positive control (the table
 * must still be FOUND in some chunk) rather than passing every page.
 *
 *  - the tool directory: `{slug:"merge-pdf",name:"Merge PDF",processing:…,
 *    accept:[` for each entry;
 *  - the runner registry: `"jpg-to-pdf":"image-to-pdf"` for each slug;
 *  - the runner kind → hand-off mode table: `merge:"collect"` for each kind;
 *  - the worker batch slugs: an array literal of them;
 *  - the runner kind → file ceiling table: its keys, in order;
 *  - the worker engines' ceilings: `"office-conversion":{tools:` per engine.
 *
 * A table "is in" a chunk when at least half its rows are (the whole table,
 * for the two ordered ones): one row can be quoted anywhere — a slug in a
 * link — and no other module repeats half of any of these.
 */
import { handoffCapabilityFor } from "@/lib/handoff/capability";
import { getRunnerKind, supportedToolSlugs } from "@/lib/pdf/registry";
import { TOOL_DIRECTORY } from "@/lib/tools/directory.generated";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { WORKER_ENGINE_FILE_CEILINGS } from "@/lib/workers/engine-file-ceilings";
import { getAllToolSlugs } from "@/lib/tools";

export interface ToolTable {
  readonly what: string;
  /** How many of its rows `text` carries, and how many it has. */
  rowsIn(text: string): { found: number; of: number };
  /** The share of rows that means the table is there. */
  readonly needs: "half" | "all";
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** An object key as a minifier writes it. */
const key = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function countRows(rows: readonly string[]) {
  return (text: string) => ({
    found: rows.filter((row) => text.includes(row)).length,
    of: rows.length,
  });
}

/** One slug per runner kind, to ask the capability which mode each kind has. */
function kindsWithASlug(): [string, string][] {
  const seen = new Map<string, string>();
  for (const slug of supportedToolSlugs) {
    const kind = getRunnerKind(slug)!;
    if (!seen.has(kind)) seen.set(kind, slug);
  }
  return [...seen.entries()];
}

/** The worker batch slugs: a batch mode and no in-browser runner. */
export function workerBatchSlugs(): string[] {
  return getAllToolSlugs().filter(
    (slug) =>
      !getRunnerKind(slug) && handoffCapabilityFor(slug).mode === "batch",
  );
}

export function toolTables(): ToolTable[] {
  const ceilingKeys = Object.keys(RUNNER_FILE_CEILINGS);
  const ceilings = new RegExp(
    ceilingKeys.map((k) => `${escape(key(k))}:[^,{}]+`).join(","),
  );
  const batch = new Set(workerBatchSlugs());
  return [
    {
      what: "the tool directory (TOOL_DIRECTORY)",
      needs: "half",
      rowsIn: countRows(
        TOOL_DIRECTORY.map(
          (t) =>
            `slug:${JSON.stringify(t.slug)},name:${JSON.stringify(t.name)},processing:${JSON.stringify(t.processing)},accept:[`,
        ),
      ),
    },
    {
      what: "the runner registry (RUNNERS)",
      needs: "half",
      rowsIn: countRows(
        supportedToolSlugs.map(
          (slug) =>
            `${JSON.stringify(slug)}:${JSON.stringify(getRunnerKind(slug))}`,
        ),
      ),
    },
    {
      what: "the runner kind to hand-off mode table (MODE_BY_KIND)",
      needs: "half",
      rowsIn: countRows(
        kindsWithASlug().map(
          ([kind, slug]) =>
            `${key(kind)}:${JSON.stringify(handoffCapabilityFor(slug).mode)}`,
        ),
      ),
    },
    {
      what: "the worker batch slugs (WORKER_BATCHES)",
      needs: "half",
      rowsIn: (text) => {
        let found = 0;
        for (const m of text.matchAll(
          /\[((?:"[a-z0-9-]+",)*"[a-z0-9-]+")\]/g,
        )) {
          const members = m[1]!.split(",").map((s) => s.slice(1, -1));
          if (members.every((s) => batch.has(s)))
            found = Math.max(found, members.length);
        }
        return { found, of: batch.size };
      },
    },
    {
      what: "the runner kind to file ceiling table (RUNNER_FILE_CEILINGS)",
      needs: "all",
      rowsIn: (text) => ({
        found: ceilings.test(text) ? ceilingKeys.length : 0,
        of: ceilingKeys.length,
      }),
    },
    {
      what: "the worker engines' file ceilings (WORKER_ENGINE_FILE_CEILINGS)",
      needs: "all",
      rowsIn: countRows(
        Object.keys(WORKER_ENGINE_FILE_CEILINGS).map(
          (engine) => `${key(engine)}:{tools:`,
        ),
      ),
    },
  ];
}

/** Is `table` in `text`, by its own rule? */
export function carriesTable(table: ToolTable, text: string): boolean {
  const { found, of } = table.rowsIn(text);
  return table.needs === "all" ? found === of : found * 2 >= of;
}
