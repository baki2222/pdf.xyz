// @vitest-environment node
/**
 * Every product event has a sender, and every sender sends a real event.
 *
 * THE DEFECT (audit at 67e8d0f): `EVENT_NAMES` declared eight events and the
 * app sent three. `tool_viewed`, `tool_completed`, `tool_failed`,
 * `workspace_handoff_created` and `worker_contract_hit` were typed, bucketed,
 * redacted, unit-tested — and emitted by nothing. GA4 went live on 2026-08-25
 * behind the existing sink, so the owner could see page views and not one
 * tool failure; the Office-to-PDF upload refusal (#165) ran for months with no
 * signal. A schema is a claim about what is measured. Nothing checked it.
 *
 * CORPUS IN BOTH DIRECTIONS (house style rule 1):
 *  - every `EVENT_NAMES` member has at least one `track()` call site;
 *  - every `track()` call site names a member — and a site this walker cannot
 *    resolve is FATAL, not skipped, because a skipped site is a hole.
 *
 * DERIVED, NOT TYPED (rule 4): the files come from `git ls-files` (tracked and
 * untracked-but-not-ignored, so a file written today is in the set), the
 * builders from `events.ts` itself. The corpus is bounded below, and a fixture
 * source is run through the same resolver as a positive control.
 *
 * ONE HOP OF REACHABILITY, stated rather than overclaimed: the function or
 * component holding each `track()` must be called or mounted by some OTHER
 * product module. That catches a helper nobody wires up and a component no
 * page renders. It does not prove the caller itself runs — the behavioural
 * chain tests in `tool-outcome.test.tsx` do that for the tool-run events.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "./events";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = resolve(__dirname, "..", "..", "..");
const EVENTS_MODULE = "src/lib/telemetry/events.ts";

function productFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".d.ts"));
}

function parse(file: string, source: string): TS.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function nameLiteral(obj: TS.ObjectLiteralExpression): string | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "name" &&
      ts.isStringLiteralLike(prop.initializer)
    ) {
      return prop.initializer.text;
    }
  }
  return undefined;
}

/** Builder function → the one event name its body constructs. */
function builders(): Map<string, string> {
  const sf = parse(
    EVENTS_MODULE,
    readFileSync(resolve(ROOT, EVENTS_MODULE), "utf8"),
  );
  const out = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue;
    const names = new Set<string>();
    const walk = (node: TS.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const n = nameLiteral(node);
        if (n) names.add(n);
      }
      ts.forEachChild(node, walk);
    };
    walk(stmt.body);
    if (names.size === 1) out.set(stmt.name.text, [...names][0]!);
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  /** The resolved event name, or null when the argument could not be read. */
  event: string | null;
  /** The top-level function the call sits in, when there is one. */
  enclosing: string | null;
}

function enclosingTopLevel(node: TS.Node): string | null {
  let cur: TS.Node | undefined = node;
  let name: string | null = null;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isFunctionDeclaration(cur) && cur.name) name = cur.name.text;
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) ||
        ts.isFunctionExpression(cur.initializer))
    )
      name = cur.name.text;
    cur = cur.parent;
  }
  return name;
}

function trackSites(
  file: string,
  source: string,
  builderMap: Map<string, string>,
): Site[] {
  const sf = parse(file, source);
  const sites: Site[] = [];
  const walk = (node: TS.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "track"
    ) {
      const arg = node.arguments[0];
      let event: string | null = null;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        event = nameLiteral(arg) ?? null;
      } else if (
        arg &&
        ts.isCallExpression(arg) &&
        ts.isIdentifier(arg.expression)
      ) {
        event = builderMap.get(arg.expression.text) ?? null;
      }
      sites.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        event,
        enclosing: enclosingTopLevel(node),
      });
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return sites;
}

const AST_CACHE = new Map<string, TS.SourceFile>();
function parsed(file: string): TS.SourceFile {
  let sf = AST_CACHE.get(file);
  if (!sf) {
    sf = parse(file, readFileSync(resolve(ROOT, file), "utf8"));
    AST_CACHE.set(file, sf);
  }
  return sf;
}

/** Files other than `exclude` that CALL `name` or render it as a JSX tag. */
function referencesTo(
  name: string,
  files: string[],
  exclude: string,
): string[] {
  return files.filter((file) => {
    if (file === exclude) return false;
    const sf = parsed(file);
    let found = false;
    const walk = (node: TS.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === name) ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === name))
      )
        found = true;
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName) &&
        node.tagName.text === name
      )
        found = true;
      ts.forEachChild(node, walk);
    };
    walk(sf);
    return found;
  });
}

const FILES = productFiles();
const BUILDERS = builders();
const SITES = FILES.flatMap((file) =>
  trackSites(file, readFileSync(resolve(ROOT, file), "utf8"), BUILDERS),
);

describe("the instruments", () => {
  it("the corpus is plausibly sized", () => {
    expect(
      FILES.length,
      "git ls-files found implausibly few files",
    ).toBeGreaterThan(300);
    // Fifteen track() sites existed before this guard; it must never see fewer.
    expect(
      SITES.length,
      "the walker found implausibly few track() calls",
    ).toBeGreaterThanOrEqual(15);
    expect(
      BUILDERS.size,
      "no event builders were read from events.ts",
    ).toBeGreaterThanOrEqual(2);
  });

  it("positive control: the resolver reads both argument shapes", () => {
    const [builderName, builderEvent] = [...BUILDERS][0]!;
    const fixture = [
      `track({ name: "worker_status_checked", mode: "disabled", enabled: false });`,
      `function f() { track(${builderName}({} as never)); }`,
      `track(someVariable);`,
    ].join("\n");
    const sites = trackSites("fixture.ts", fixture, BUILDERS);
    expect(sites.map((s) => s.event)).toEqual([
      "worker_status_checked",
      builderEvent,
      null,
    ]);
    expect(sites[1]!.enclosing).toBe("f");
  });

  it("positive control: a known real site is found", () => {
    expect(
      SITES.some(
        (s) =>
          s.event === "worker_status_checked" &&
          s.file === "src/components/tools/summarize-worker-panel.tsx",
      ),
    ).toBe(true);
  });
});

describe("product events: declared ⇔ sent", () => {
  it("every track() call site resolves to a declared event", () => {
    const unresolved = SITES.filter((s) => s.event === null).map(
      (s) => `${s.file}:${s.line}`,
    );
    expect(
      unresolved,
      "track() called with an argument this guard cannot read — pass an " +
        "object literal with `name`, or an events.ts builder",
    ).toEqual([]);
    const undeclared = SITES.filter(
      (s) =>
        s.event !== null &&
        !(EVENT_NAMES as readonly string[]).includes(s.event),
    ).map((s) => `${s.file}:${s.line} ${s.event}`);
    expect(undeclared).toEqual([]);
  });

  it("every declared event has a sender", () => {
    const silent = EVENT_NAMES.filter(
      (name) => !SITES.some((s) => s.event === name),
    );
    expect(
      silent,
      "these events are declared, typed and tested — and sent by nothing",
    ).toEqual([]);
  });

  it("every sender is called or mounted from some other module", () => {
    // One hop: the function or component holding the track() call is used
    // somewhere else — a helper nobody calls, or a component no page renders
    // (`ToolTelemetry` without the tool page), is a declared event with extra
    // steps.
    const unenclosed = SITES.filter((s) => s.enclosing === null).map(
      (s) => `${s.file}:${s.line}`,
    );
    expect(unenclosed, "a track() call outside any function").toEqual([]);
    const orphaned = SITES.filter(
      (s) => referencesTo(s.enclosing!, FILES, s.file).length === 0,
    ).map((s) => `${s.file}:${s.line} ${s.enclosing} (${s.event})`);
    expect(
      orphaned,
      "an emitter nothing calls or mounts is a declared event with extra steps",
    ).toEqual([]);
  });
});
