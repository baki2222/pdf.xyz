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

/**
 * The most a tool page's own row (`toolRunInfoFor`) may weigh, serialised —
 * held on the value (`tool-run-info.test.ts`) and on the prerendered
 * document that carries it (`lazy-chunks.test.ts`). The largest row is
 * ~520 B (request-signatures); a table of every tool is kilobytes.
 */
export const RUN_ROW_MAX_BYTES = 700;

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

/*
 * THE PROPERTY, NOT THE SHAPES. The six markers above recognise the tables
 * that exist, by their rows, and give a good diagnostic when one returns.
 * They cannot see a NEW table in another shape — a `{"merge-pdf":"Merge
 * PDF",…}` name map (exactly the fallback a version-1 record's name lookup
 * invites), or a bare array of every slug — and the guard's title promises
 * "no table of every tool". This is that promise, shape-blind: how many of
 * the catalogue's slugs one chunk quotes as string literals. Measured
 * 2026-11-09 over every tool page's first-load chunks: main 89486c09 had a
 * chunk with all 56 (the [slug] page chunk, which carried the directory);
 * the branch has at most 11, all in the page chunk, and all of them runner
 * KIND names that happen to equal a slug ("extract-images", "fill-forms",
 * …: the dispatcher's arms). A new runner kind named like its slug adds
 * one; a table of every tool adds every one.
 */

/** The most catalogue slugs one first-load chunk of a tool page may quote. */
export const SLUG_LITERALS_MAX = 20;

/** The catalogue slugs `text` quotes as a string literal, distinct. */
export function slugLiteralsIn(
  text: string,
  slugs: readonly string[] = getAllToolSlugs(),
): string[] {
  return slugs.filter(
    (slug) => text.includes(`"${slug}"`) || text.includes(`'${slug}'`),
  );
}

/**
 * The React flight data a prerendered page carries: the text of every
 * `self.__next_f.push([1, "…"])` in the HTML, in order. This is what the
 * browser parses to hydrate, and where a server page's props to a client
 * component travel — bytes no JS chunk budget sees.
 */
export function flightText(html: string): string {
  let out = "";
  for (const m of html.matchAll(
    /<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g,
  )) {
    const row = JSON.parse(m[1]!) as unknown[];
    if (row[0] === 1 && typeof row[1] === "string") out += row[1];
  }
  return out;
}

/** The JSON object that starts at `text[start]` (`{`), string-aware. */
function objectAt(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated object at ${start}`);
}

/**
 * Every `"tool":{"slug":"<slug>",…}` prop in a page's flight data that is
 * the page's own run row (it carries `handoff`, which the catalogue `Tool`
 * a panel receives does not), as the reader receives it.
 */
export function runRowsIn(flight: string, slug: string): string[] {
  const opener = `"tool":{"slug":${JSON.stringify(slug)},`;
  const rows: string[] = [];
  for (let at = flight.indexOf(opener); at >= 0;) {
    const row = objectAt(flight, at + '"tool":'.length);
    if (row.includes('"handoff":{')) rows.push(row);
    at = flight.indexOf(opener, at + 1);
  }
  return rows;
}
