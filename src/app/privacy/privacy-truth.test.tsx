// @vitest-environment jsdom
/**
 * /privacy, held to what the code — and production, where only production
 * can say — actually does. Read from the RENDERED page, every subject DERIVED.
 *
 * ── WHY THIS FILE EXISTS (2026-10-10) ──────────────────────────────────────
 *
 * A sweep of the legal pages against the code (the Art. 30 record and the
 * representative pack, §5 "Conflicts between the page text and the code",
 * rows 1-18) found /privacy stating things the code does not do, and leaving
 * out things it does. Every one of them was true when written or plausible
 * when written, and every one was invisible to the guards that existed,
 * because those guards banned WORDS and the page had moved one word over:
 *
 *  - §7 named four unnamed categories of provider; the code integrates
 *    Google, OpenAI and Cloudflare R2, and production runs on InterServer
 *    and Contabo behind Cloudflare. "Storage we control" was Cloudflare R2.
 *  - §4 said logs were "retained for a short period by those providers";
 *    the origin is our own server, and no period exists anywhere.
 *  - §4 said "We do not ask for a name, an email address, or a password"
 *    beside a tool that asks for up to ten signers' names and emails, and
 *    two that ask for a password. Webpage to PDF's address was nowhere.
 *  - §4 listed "the pages you view, the names of tools you use" for Google
 *    Analytics; the event schema sends eight events and sixteen fields.
 *  - §2 said nothing about an in-browser file's size reaches our servers —
 *    true — while a consented `tool_completed` hands Google its size band.
 *  - §3 said the AI provider's cache "lasts minutes, not days" — grounded in
 *    the DORMANT Anthropic adapter; production uses OpenAI, which may keep
 *    what it receives for up to 30 days for abuse monitoring.
 *  - §5 called Google Analytics' cookie "the one kind of cookie on this
 *    site"; the site sits behind Cloudflare, which may set its own.
 *  - §9 promised a "strict" CSP whose script-src carries 'unsafe-inline',
 *    and that "a deployment with no scanner refuses to start" — true only if
 *    an opt-in flag is set, which strict mode does not imply.
 *  - §4 said analytics events are stripped of query strings. Measured in a
 *    real browser against a production build on 2026-10-10: `tool_viewed`
 *    carried `dl=…/tools/sign-pdf?handoff=h_…` to Google.
 *
 * ── HOW THE SUBJECTS ARE DERIVED (house rule 4) ─────────────────────────────
 *
 * Nothing here names a subject the code can name instead:
 *  - third-party ORIGINS from the served CSP (`next.config.mjs` headers), the
 *    storage origin the publish workflow's smoke step demands on the wire,
 *    and the AI provider hosts in `src/lib/workers/ai`;
 *  - the analytics EVENTS and their FIELDS from the `ProductEvent` union in
 *    `src/lib/telemetry/events.ts`, by TypeScript AST;
 *  - the free text a tool ASKS FOR from every job-options interface a
 *    `parse…Options` function returns, by AST, plus every URL-input tool in
 *    the catalogue;
 *  - the scanner promise from `evaluateGuardrails` itself, the CSP promise
 *    from the served header, the cookie promise from every `.cookie =`
 *    write in `src`.
 *
 * What the repository CANNOT know — which companies run production — is
 * `OUTSIDE_FACTS` below, each with its provenance. It is the second,
 * independent bound (house rule 3): the page draws its names from its own
 * registry; this list was recorded separately, and the two must agree.
 *
 * Every predicate has a positive control: the sentence that shipped, run
 * through it, must be caught.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EVENT_NAMES } from "@/lib/telemetry/events";
import { tools } from "@/lib/tools";
import { getToolInputKind } from "@/lib/jobs/capabilities";
import { AI_PROVIDER_FAMILIES } from "@/lib/workers/ai/config";
import { GTAG_SRC } from "@/lib/analytics/ga4";
import {
  GUARDRAIL_ENV,
  evaluateGuardrails,
} from "@/lib/workers/deploy/guardrails";
import { PASSWORD_QUEUE_LIFETIME } from "@/lib/jobs/pdf-security";
import { RETENTION_WINDOWS } from "@/lib/retention-windows";
import { ASKED_FOR as ASKED_FOR_COPY } from "@/lib/privacy/asked-for";
import { CSP_ALLOWS_INLINE_SCRIPTS } from "@/lib/privacy/site-security";
import {
  AI_PROVIDER,
  AI_PROVIDER_RETENTION,
  PROCESSORS,
} from "@/lib/privacy/processors";
import PrivacyPage from "./page";

afterEach(cleanup);

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/* ------------------------------------------------------------------ *
 *  Facts the repository cannot prove (rule 3: the independent bound)
 * ------------------------------------------------------------------ */

/**
 * Production facts verified outside the repository on 2026-10-10 (the Art. 30
 * record, §5). A later deployment can make any of them stale: re-check at the
 * wire before relying on one, and change this list and the page together.
 */
const OUTSIDE_FACTS = {
  /** F5 — operator record (web host), RIPE RDAP (worker host's IP holder). */
  webHost: { company: "InterServer", country: "USA" },
  workerHost: { company: "Contabo", country: "Germany" },
  /** F5/F6 — every request passes through it; it also runs Email Routing. */
  edge: { company: "Cloudflare", services: ["R2", "Email Routing"] },
  /** F7 — the production AI family, as the live heartbeat publishes it. */
  aiFamily: "openai" as const,
  /** F7 — OpenAI's default abuse-monitoring retention, absent ZDR. */
  aiProviderRetention: "30 days",
} as const;

/** The company behind each third-party origin the code can contact. */
const ORIGIN_OWNERS: { host: RegExp; company: string; family?: string }[] = [
  { host: /(?:^|\.)googletagmanager\.com$/, company: "Google" },
  { host: /(?:^|\.)google-analytics\.com$/, company: "Google" },
  { host: /(?:^|\.)analytics\.google\.com$/, company: "Google" },
  { host: /(?:^|\.)r2\.cloudflarestorage\.com$/, company: "Cloudflare" },
  { host: /(?:^|\.)openai\.com$/, company: "OpenAI", family: "openai" },
  {
    host: /(?:^|\.)anthropic\.com$/,
    company: "Anthropic",
    family: "anthropic",
  },
];

/* ------------------------------------------------------------------ *
 *  Reading the page the way a reader does
 * ------------------------------------------------------------------ */

const BLOCKS = "p, li, dt, dd, h2, address";

function renderPage(): HTMLElement {
  const { container } = render(<PrivacyPage />);
  for (const el of Array.from(container.querySelectorAll(BLOCKS))) {
    el.append(document.createTextNode("\n"));
  }
  return container;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function sectionText(page: HTMLElement, id: string): string {
  const section = page.querySelector(`#${id}`);
  expect(section, `/privacy has no #${id} section`).not.toBeNull();
  return norm(section!.textContent ?? "");
}

/** Every innermost block (a `p`, `li`, `dd` …) of a section, as text. */
function blocksOf(page: HTMLElement, id?: string): string[] {
  const root = id ? page.querySelector(`#${id}`)! : page;
  return Array.from(root.querySelectorAll("p, li, dd"))
    .filter((el) => el.querySelector("p, li, dd") === null)
    .map((el) => norm(el.textContent ?? ""))
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 *  Derivations
 * ------------------------------------------------------------------ */

/** Host names in the CSP the real `next.config.mjs` serves. */
async function servedCspHosts(): Promise<{
  hosts: string[];
  scriptSrc: string[];
}> {
  const config = (await import(path.join(ROOT, "next.config.mjs"))).default as {
    headers: () => Promise<
      { source: string; headers: { key: string; value: string }[] }[]
    >;
  };
  const all = (await config.headers()).find((r) => r.source === "/:path*")!;
  const csp = all.headers.find((h) => h.key === "Content-Security-Policy")!;
  const hosts = new Set<string>();
  let scriptSrc: string[] = [];
  for (const part of csp.value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === "script-src") scriptSrc = sources;
    for (const source of sources) {
      const m = /^https?:\/\/(?:\*\.)?([^/]+)/.exec(source);
      if (m) hosts.add(m[1]!);
    }
  }
  return { hosts: [...hosts], scriptSrc };
}

/**
 * The storage origin production serves, as the publish workflow demands it
 * on the wire (its smoke step fails the release without it). The CSP's own
 * storage entry is a build argument, absent here, so this is where the repo
 * records which company holds uploads. A missing step is FATAL, not a skip.
 */
function storageHostFromPublish(): string {
  const yml = read(".github/workflows/publish.yml");
  const m =
    /content-security-policy"\s*\/tmp\/headers\s*\|\s*grep -q "([a-z0-9.-]+)"/.exec(
      yml,
    );
  if (!m) throw new Error("publish.yml no longer pins the storage origin");
  return m[1]!;
}

/** `https://api.…` hosts the AI adapters call. */
function aiProviderHosts(): string[] {
  const dir = path.join(ROOT, "src", "lib", "workers", "ai");
  const hosts = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!/\.ts$/.test(f) || f.includes(".test.")) continue;
    const text = readFileSync(path.join(dir, f), "utf8");
    for (const m of text.matchAll(/"https:\/\/(api\.[a-z0-9.-]+)"/g))
      hosts.add(m[1]!);
  }
  return [...hosts];
}

/** The companies the page must name, derived from the code + outside facts. */
async function requiredProcessors(): Promise<{
  origins: { host: string; company: string; active: boolean }[];
  names: string[];
}> {
  const { hosts } = await servedCspHosts();
  const all = [...hosts, storageHostFromPublish(), ...aiProviderHosts()];
  const origins = all.map((host) => {
    const owner = ORIGIN_OWNERS.find((o) => o.host.test(host));
    if (!owner)
      throw new Error(
        `third-party origin ${host} has no owner here — classify it, and name it on /privacy if it receives visitor data`,
      );
    // A dormant AI family is code, not a recipient: production runs one.
    const active = !owner.family || owner.family === OUTSIDE_FACTS.aiFamily;
    return { host, company: owner.company, active };
  });
  const names = new Set(origins.filter((o) => o.active).map((o) => o.company));
  names.add(OUTSIDE_FACTS.webHost.company);
  names.add(OUTSIDE_FACTS.workerHost.company);
  names.add(OUTSIDE_FACTS.edge.company);
  for (const s of OUTSIDE_FACTS.edge.services) names.add(s);
  return { origins, names: [...names] };
}

/* ---- the free text a tool asks for, from the option schemas ---- */

const parseTs = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

/** What one module's `parse…Options` functions return, walked. */
interface OptionsWalk {
  /** Every free-text leaf, as `Interface.path` (`[]` marks an array). */
  readonly fields: string[];
  /** Parsers that declare no fields (`ParseResult<unknown>`, the envelope), named so a reader sees them. */
  readonly dispatchers: string[];
}

/**
 * Every free-text leaf of every type a `parse…Options` function in `source`
 * returns. FAILS CLOSED: a type it cannot classify THROWS rather than being
 * skipped.
 *
 * ── WHY IT THROWS (review, 2026-10-10) ─────────────────────────────────────
 *
 * The first version counted a field only when its type was the bare `string`
 * keyword, after unwrapping `T[]` and resolving same-file interfaces — and
 * dropped everything else WITHOUT A WORD. Mutation B: `audience?: string |
 * null` added to `SummarizeOptions` left this file green (43/43), while the
 * same field typed `audience?: string` turned the health test red. A union, a
 * `readonly` array, `Array<string>`, an imported interface or an arrow-function
 * parser all fell through, under a module (`asked-for.ts`) that promised "A
 * field added to a form without a line here is red there". `[] ⊆ X` reported
 * the strongest pass on the fields it could not see.
 *
 * So every shape the TypeScript in `src/lib/jobs` uses is unwrapped —
 * parentheses, `readonly`, `T[]`, `Array<T>` / `ReadonlyArray<T>`, unions
 * (free text if ANY member is), `extends` — and a reference resolves only to a
 * same-file interface, type alias or `as const` table. Anything else is an
 * error naming the field, so the next shape is a red, not a hole.
 *
 * Takes SOURCE TEXT, so the controls below can hand it the shapes it missed.
 */
function freeTextFieldsIn(fileName: string, source: string): OptionsWalk {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  const consts = new Map<string, ts.Expression>();
  const returned = new Set<string>();
  const dispatchers: string[] = [];
  const fail = (what: string): never => {
    throw new Error(
      `${fileName}: ${what} — the options walk cannot tell whether it is free text`,
    );
  };

  const parserReturns = (name: string, type: ts.TypeNode | undefined) => {
    if (!/^parse\w*Options$/.test(name)) return;
    if (!type) fail(`${name} declares no return type`);
    const text = type!.getText(sf).replace(/\s+/g, " ");
    const m = /^ParseResult<(\w+)>$/.exec(text);
    if (m && m[1] !== "unknown") returned.add(m[1]!);
    // A dispatcher hands the options to a tool's own parser (walked above)
    // or validates only the envelope; it declares no fields of its own.
    else if (
      /^ParseResult<(?:unknown|Record<string, unknown>)>(?: \| null)?$/.test(
        text,
      )
    )
      dispatchers.push(`${fileName}:${name}`);
    else fail(`${name} returns ${text}`);
  };

  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node);
    if (ts.isFunctionDeclaration(node) && node.name)
      parserReturns(node.name.text, node.type);
    if (ts.isVariableStatement(node))
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        if (d.initializer) consts.set(d.name.text, d.initializer);
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
          parserReturns(d.name.text, init.type);
        else if (/^parse\w*Options$/.test(d.name.text))
          fail(`${d.name.text} is not a function this walk can read`);
      }
  });

  /** `X` is a same-file `as const` table or literal, so `typeof X` is closed. */
  const isClosedConst = (name: string): boolean => {
    let init = consts.get(name);
    while (
      init &&
      (ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))
    )
      init = init.expression;
    if (!init) return false;
    if (ts.isStringLiteral(init) || ts.isNumericLiteral(init)) return true;
    return (
      ts.isAsExpression(init) &&
      ts.isTypeReferenceNode(init.type) &&
      init.type.typeName.getText(sf) === "const"
    );
  };

  const out = new Set<string>();

  const visit = (type: ts.TypeNode, at: string, seen: Set<string>): void => {
    if (ts.isParenthesizedTypeNode(type)) return visit(type.type, at, seen);
    if (ts.isTypeOperatorNode(type)) {
      if (type.operator === ts.SyntaxKind.ReadonlyKeyword)
        return visit(type.type, at, seen);
      if (type.operator === ts.SyntaxKind.KeyOfKeyword) return;
      return fail(`${at} uses an operator it cannot read`);
    }
    if (ts.isArrayTypeNode(type))
      return visit(type.elementType, `${at}[]`, seen);
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      for (const member of type.types) visit(member, at, seen);
      return;
    }
    if (type.kind === ts.SyntaxKind.StringKeyword) {
      out.add(at);
      return;
    }
    if (
      type.kind === ts.SyntaxKind.NumberKeyword ||
      type.kind === ts.SyntaxKind.BooleanKeyword ||
      type.kind === ts.SyntaxKind.UndefinedKeyword ||
      type.kind === ts.SyntaxKind.NullKeyword ||
      ts.isLiteralTypeNode(type)
    )
      return;
    if (ts.isTypeLiteralNode(type)) return walkMembers(type.members, at, seen);
    if (ts.isTypeQueryNode(type)) {
      if (isClosedConst(type.exprName.getText(sf))) return;
      return fail(
        `${at} is typeof ${type.exprName.getText(sf)}, not a same-file constant`,
      );
    }
    if (ts.isIndexedAccessTypeNode(type)) {
      // `(typeof TABLE)[number]` and `(typeof TABLE)[number]["code"]`.
      let root: ts.TypeNode = type;
      while (
        ts.isIndexedAccessTypeNode(root) ||
        ts.isParenthesizedTypeNode(root)
      )
        root = ts.isIndexedAccessTypeNode(root) ? root.objectType : root.type;
      if (ts.isTypeQueryNode(root) && isClosedConst(root.exprName.getText(sf)))
        return;
      return fail(
        `${at} indexes something other than a same-file \`as const\` table`,
      );
    }
    if (ts.isTypeReferenceNode(type)) {
      const name = type.typeName.getText(sf);
      if (
        (name === "Array" || name === "ReadonlyArray") &&
        type.typeArguments?.length === 1
      )
        return visit(type.typeArguments[0]!, `${at}[]`, seen);
      if (seen.has(name)) return;
      const next = new Set([...seen, name]);
      const iface = interfaces.get(name);
      if (iface) return walkInterface(iface, at, next);
      const alias = aliases.get(name);
      if (alias) return visit(alias.type, at, next);
      return fail(`${at} is typed ${name}, which is not declared in this file`);
    }
    return fail(`${at} has a type of kind ${ts.SyntaxKind[type.kind]}`);
  };

  const walkMembers = (
    members: ts.NodeArray<ts.TypeElement>,
    prefix: string,
    seen: Set<string>,
  ): void => {
    for (const member of members) {
      if (ts.isPropertySignature(member)) {
        const at = `${prefix}.${member.name.getText(sf).replace(/^["']|["']$/g, "")}`;
        if (!member.type) fail(`${at} has no type`);
        visit(member.type!, at, seen);
      } else if (ts.isIndexSignatureDeclaration(member)) {
        visit(member.type, `${prefix}[key]`, seen);
      } else fail(`${prefix} has a member that is not a property`);
    }
  };

  const walkInterface = (
    decl: ts.InterfaceDeclaration,
    prefix: string,
    seen: Set<string>,
  ): void => {
    for (const clause of decl.heritageClauses ?? [])
      for (const base of clause.types) {
        const name = base.expression.getText(sf);
        const parent = interfaces.get(name);
        if (!parent)
          fail(`${prefix} extends ${name}, which is not declared in this file`);
        walkInterface(parent!, prefix, new Set([...seen, name]));
      }
    walkMembers(decl.members, prefix, seen);
  };

  for (const name of returned) {
    const decl = interfaces.get(name);
    const alias = aliases.get(name);
    if (decl) walkInterface(decl, name, new Set([name]));
    else if (alias) visit(alias.type, name, new Set([name]));
    else fail(`${name} is returned but not declared`);
  }
  return { fields: [...out].sort(), dispatchers };
}

/** {@link freeTextFieldsIn} over every non-test module in `src/lib/jobs`. */
function optionsWalk(): OptionsWalk {
  const dir = path.join(ROOT, "src", "lib", "jobs");
  const fields: string[] = [];
  const dispatchers: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.ts$/.test(f) || f.includes(".test.") || f.includes(".examples."))
      continue;
    const walk = freeTextFieldsIn(f, readFileSync(path.join(dir, f), "utf8"));
    fields.push(...walk.fields);
    dispatchers.push(...walk.dispatchers);
  }
  return { fields: fields.sort(), dispatchers: dispatchers.sort() };
}

/** Every free-text option field a tool's parser accepts. */
function freeTextOptionFields(): string[] {
  return optionsWalk().fields;
}

/**
 * Which tool asks for each options interface, and what a reader would call
 * each free-text field. Held to the derived set BOTH ways below, so a new
 * field or a new options interface fails until someone decides what /privacy
 * says about it.
 */
const ASKED_FOR: Record<
  string,
  { tools: string[]; nouns: Record<string, RegExp> }
> = {
  ChatOptions: {
    tools: ["chat-with-pdf"],
    nouns: {
      "ChatOptions.question": /question/i,
      "ChatOptions.context[].content": /conversation/i,
    },
  },
  ExtractOptions: {
    tools: ["ai-extract"],
    nouns: {
      "ExtractOptions.prompt": /instructions/i,
      "ExtractOptions.schema[].name": /field/i,
      "ExtractOptions.schema[].description": /field/i,
    },
  },
  ProtectPdfOptions: {
    tools: ["protect-pdf"],
    nouns: {
      "ProtectPdfOptions.password": /password/i,
      "ProtectPdfOptions.ownerPassword": /password/i,
    },
  },
  UnlockPdfOptions: {
    tools: ["unlock-pdf"],
    nouns: { "UnlockPdfOptions.password": /password/i },
  },
  SignatureRequestOptions: {
    tools: ["request-signatures"],
    nouns: {
      "SignatureRequestOptions.signers[].name": /\bnames?\b/i,
      "SignatureRequestOptions.signers[].email": /email address/i,
      "SignatureRequestOptions.title": /title/i,
      "SignatureRequestOptions.message": /message/i,
      "SignatureRequestOptions.fields[].label": /label/i,
    },
  },
  SummarizeOptions: {
    tools: ["summarize-pdf"],
    nouns: { "SummarizeOptions.focus": /focus/i },
  },
  TranslateOptions: {
    tools: ["translate-pdf"],
    nouns: { "TranslateOptions.instructions": /instructions/i },
  },
};

/** The fields of each `ProductEvent` variant, by AST. */
function productEventFields(): Map<string, string[]> {
  const sf = parseTs(path.join(ROOT, "src", "lib", "telemetry", "events.ts"));
  const out = new Map<string, string[]>();
  sf.forEachChild((node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== "ProductEvent")
      return;
    if (!ts.isUnionTypeNode(node.type)) throw new Error("ProductEvent moved");
    for (const variant of node.type.types) {
      if (!ts.isTypeLiteralNode(variant)) continue;
      let name = "";
      const fields: string[] = [];
      for (const m of variant.members) {
        if (!ts.isPropertySignature(m)) continue;
        const key = (m.name as ts.Identifier).text;
        if (key === "name") name = m.type!.getText(sf).replace(/"/g, "");
        else fields.push(key);
      }
      out.set(name, fields);
    }
  });
  return out;
}

/** Every `.cookie =` write in non-test source under `src`, as file paths. */
function cookieWriters(): { file: string; lines: string[] }[] {
  const out: { file: string; lines: string[] }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
        const lines = readFileSync(full, "utf8")
          .split("\n")
          .filter((l) => /\.cookie\s*=[^=]/.test(l));
        if (lines.length) out.push({ file: rel(full), lines });
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

/* ------------------------------------------------------------------ *
 *  Health checks on the derivations
 * ------------------------------------------------------------------ */

describe("the derived subjects are the real ones (health)", () => {
  it("the integrations walk finds Google, R2 and both AI adapters", async () => {
    const { origins } = await requiredProcessors();
    const hosts = origins.map((o) => o.host);
    expect(hosts).toContain(new URL(GTAG_SRC).hostname);
    expect(hosts).toContain(storageHostFromPublish());
    expect(aiProviderHosts().sort()).toEqual([
      "api.anthropic.com",
      "api.openai.com",
    ]);
    expect(AI_PROVIDER_FAMILIES).toContain(OUTSIDE_FACTS.aiFamily);
  });

  it("the options walk finds every option schema, and the table covers it both ways", () => {
    const found = freeTextOptionFields();
    // Implausibly small means the walk broke, not that the forms shrank.
    expect(found.length, found.join("\n")).toBeGreaterThanOrEqual(12);
    const table = Object.values(ASKED_FOR).flatMap((t) => Object.keys(t.nouns));
    expect(found).toEqual([...table].sort());
    for (const { tools: slugs } of Object.values(ASKED_FOR))
      for (const slug of slugs)
        expect(
          tools.map((t) => t.slug),
          slug,
        ).toContain(slug);
  });

  it("the options walk names its dispatchers, which declare no fields of their own", () => {
    // Printed, not counted: a parser that slips into this list stops being
    // walked, so the list is read by a person every time it changes.
    expect(optionsWalk().dispatchers).toEqual([
      "ai-tool-options.ts:parseAiToolOptions",
      "validation.ts:parseOptions",
    ]);
  });

  it("positive control: the walk finds free text in every shape it used to drop", () => {
    // Each of these was skipped silently by the first walker (review,
    // 2026-10-10, mutation B: `audience?: string | null` stayed green).
    const probe = `
      import type { ParseResult } from "./responses";
      type Mode = "x" | "y";
      export const MODES = ["p", "q"] as const;
      interface Base { inherited: string }
      export interface ProbeOptions extends Base {
        a?: string | null;
        b: readonly string[];
        c: Array<string>;
        d: Mode;
        e: (typeof MODES)[number];
        f: number;
      }
      export const parseProbeOptions = (raw: unknown): ParseResult<ProbeOptions> => {
        throw raw;
      };
    `;
    expect(freeTextFieldsIn("probe.ts", probe).fields).toEqual([
      "ProbeOptions.a",
      "ProbeOptions.b[]",
      "ProbeOptions.c[]",
      "ProbeOptions.inherited",
    ]);
  });

  it("control: a type the walk cannot place is an error, not a skip", () => {
    const imported = `
      import type { ParseResult } from "./responses";
      import type { Elsewhere } from "./elsewhere";
      export interface ProbeOptions { g: Elsewhere }
      export function parseProbeOptions(raw: unknown): ParseResult<ProbeOptions> {
        throw raw;
      }
    `;
    expect(() => freeTextFieldsIn("probe.ts", imported)).toThrow(/Elsewhere/);
    const untyped = `export const parseProbeOptions = (raw: unknown) => raw;`;
    expect(() => freeTextFieldsIn("probe.ts", untyped)).toThrow(
      /no return type/,
    );
  });

  it("the events walk finds every event the runtime allowlist accepts", () => {
    const fields = productEventFields();
    expect([...fields.keys()].sort()).toEqual([...EVENT_NAMES].sort());
    expect(fields.get("tool_completed")).toContain("outputSize");
  });

  it("the cookie walk sees the one writer, and every write it makes expires", () => {
    const writers = cookieWriters();
    expect(writers.map((w) => w.file)).toEqual(["src/lib/analytics/ga4.ts"]);
    for (const line of writers[0]!.lines) expect(line).toMatch(/expire/);
  });
});

/* ------------------------------------------------------------------ *
 *  The predicates, each with its positive control
 * ------------------------------------------------------------------ */

/** The §2/§9 sentences that called a provider's storage ours. */
const CALLS_STORAGE_OURS =
  /\b(?:storage|infrastructure)\s+we\s+(?:control|own|run)\b/i;

/** A log sentence that puts every log at the providers, none at our servers. */
function logIssues(blocks: string[]): string[] {
  const log = blocks.find(
    (b) => /\bIP address\b/.test(b) && /user-agent/i.test(b),
  );
  if (!log) return ["no block describes the request logs"];
  const issues: string[] = [];
  if (/\bby those providers\b/i.test(log))
    issues.push(`places every log at "those providers": ${log}`);
  if (!/\bour own servers?\b/i.test(log))
    issues.push(`does not say our own servers keep logs too: ${log}`);
  if (!/\bCloudflare\b/.test(log))
    issues.push(`does not name Cloudflare, which every request passes: ${log}`);
  if (!/\b(?:how long|period)\b/i.test(log))
    issues.push(`gives no retention period or criterion: ${log}`);
  return issues;
}

/** The in-browser paragraph must carve out the size band analytics sends. */
function sizeCarveOutIssues(paragraph: string | undefined): string[] {
  if (!paragraph) return ["no in-browser paragraph"];
  return /\bGoogle Analytics\b/.test(paragraph) && /\bsize\b/i.test(paragraph)
    ? []
    : [
        `the in-browser paragraph omits the size band analytics sends: ${paragraph}`,
      ];
}

const SHIPPED = {
  section7:
    "We do not sell personal information, and we do not share it for cross-context behavioural advertising. We use a small number of service providers who process data on our instructions: a hosting and content-delivery provider for the website itself; an object-storage provider that holds uploaded files and results for the short windows described above; infrastructure we operate for processing, including malware scanning; AI model providers, which receive extracted document text when you use an AI tool.",
  logs: "Ordinary server logs. Our hosting and storage providers record the technical details every web request produces — IP address, time, the page or endpoint requested, browser user-agent. These are used to operate and secure the service, including to detect abuse, and are retained for a short period by those providers.",
  inBrowser:
    "Tools that run in your browser (29 of 50). The file is opened and processed by code running on your own device. It is not sent to us, and we could not read it if we wanted to. Closing the tab discards it. Nothing about the file's contents, name, or size reaches our servers.",
  storage:
    "your file is uploaded over an encrypted connection to storage we control, scanned for malware, processed, and then removed on this timetable:",
  analytics:
    "When allowed, Google receives the pages you view, the names of tools you use, coarse browser and device information, and an approximate location derived from your IP address, acting as our processor.",
  /*
   * The 2026-10-10 rewrite's own sentences that review found wrong — each a
   * positive control for the check written against it.
   */
  inBrowserEverything:
    "The one exception is analytics, and only if you allow it: Google Analytics is then told which tool you used and a coarse size band of the result, never the file, its name or its exact size (section 4 lists everything it receives).",
  /** §4's Google Analytics bullet: 1,179 characters, one block. */
  analyticsBullet:
    "Product analytics — only after you say yes. We use Google Analytics to count visits and see which tools are used, and it is loaded only after you choose “Allow analytics” in the banner. Until then — and always, if you decline — no analytics code loads and nothing is sent to Google. When allowed, Google receives, acting as our processor: coarse browser and device information, an approximate location derived from your IP address, the random identifier its cookie holds, and for each page you view the page's address without its query string, the page's title, and the address of the previous page, also without its query string. It also receives the events below, each with the fields shown, every one of them carrying the page it happened on without its query string. It never sees your documents: analytics events are stripped of filenames, links, and query strings before they are sent, and file contents never pass through this channel at all. How long Google keeps this data is set by the retention setting of our Google Analytics property. There is no advertising pixel and no error-tracking SDK, and you can change your decision at any time in the cookies section below.",
  /** Rendered after five of the seven "What some tools ask you for" items. */
  inTheQueue:
    "Our job queue keeps them only until the job ends — or, if no server ever runs the job, until the queue's retention lapses after 24 hours.",
  passwordLifetime:
    "It waits in our job queue only until the job finishes or is cancelled (or, if no server picks it up, until the queue's retention lapses), then it is deleted.",
  jobRecord:
    "A record of the job — including your file's name — is kept for about 24 hours so the system can report status, avoid duplicating work, and retry safely. It does not contain your document's contents.",
} as const;

describe("positive controls: each predicate catches the sentence that shipped", () => {
  it("the processors predicate finds every name missing from the shipped §7", async () => {
    const { names } = await requiredProcessors();
    const missing = names.filter((n) => !SHIPPED.section7.includes(n));
    expect(missing.length).toBe(names.length);
  });

  it("the storage predicate catches 'storage we control'", () => {
    expect(SHIPPED.storage).toMatch(CALLS_STORAGE_OURS);
  });

  it("the log predicate catches the shipped log bullet", () => {
    expect(logIssues([SHIPPED.logs]).length).toBeGreaterThanOrEqual(3);
  });

  it("the size predicate catches the shipped in-browser paragraph", () => {
    expect(sizeCarveOutIssues(SHIPPED.inBrowser)).toHaveLength(1);
  });

  it("the events predicate finds nearly every event missing from the shipped list", () => {
    const missing = [...productEventFields().keys()].filter(
      (e) => !SHIPPED.analytics.includes(e),
    );
    expect(missing).toHaveLength(EVENT_NAMES.length);
  });
});

/* ------------------------------------------------------------------ *
 *  The page
 * ------------------------------------------------------------------ */

describe("/privacy names who processes what (rows 3, 4, 6)", () => {
  it("§7 names every company the code integrates and production runs on", async () => {
    const page = renderPage();
    const sharing = sectionText(page, "sharing");
    const { names } = await requiredProcessors();
    const missing = names.filter((n) => !sharing.includes(n));
    expect(missing, `§7 does not name: ${missing.join(", ")}`).toEqual([]);
  });

  it("§7 says where each company is based, and §8 how to ask for the safeguards", () => {
    const page = renderPage();
    const sharing = sectionText(page, "sharing");
    expect(sharing).toContain(OUTSIDE_FACTS.webHost.country);
    expect(sharing).toContain(OUTSIDE_FACTS.workerHost.country);
    expect(sectionText(page, "transfers")).toMatch(/\bask us\b/i);
  });

  it("no section calls a provider's storage ours", () => {
    const page = renderPage();
    for (const id of ["files", "security"])
      expect(sectionText(page, id)).not.toMatch(CALLS_STORAGE_OURS);
  });

  it("the log bullet says who keeps logs, including our own servers, and for how long", () => {
    const issues = logIssues(blocksOf(renderPage(), "what-we-collect"));
    expect(issues).toEqual([]);
  });
});

describe("/privacy says what each tool asks for beyond the file (rows 5, 15)", () => {
  it("every free-text option a tool takes is named beside that tool", () => {
    const blocks = blocksOf(renderPage());
    const missing: string[] = [];
    const found = new Set(freeTextOptionFields());
    for (const { tools: slugs, nouns } of Object.values(ASKED_FOR)) {
      for (const slug of slugs) {
        const name = tools.find((t) => t.slug === slug)!.name;
        const about = blocks.filter((b) => b.includes(name));
        for (const [field, noun] of Object.entries(nouns)) {
          if (!found.has(field)) continue;
          if (!about.some((b) => noun.test(b)))
            missing.push(`${name}: ${field} (${String(noun)})`);
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("every URL-input tool says the page is fetched by our server", () => {
    const urlTools = tools.filter((t) => getToolInputKind(t.slug) === "url");
    expect(urlTools.length).toBeGreaterThan(0);
    const blocks = blocksOf(renderPage());
    for (const tool of urlTools) {
      const about = blocks.filter((b) => b.includes(tool.name));
      expect(
        about.some(
          (b) => /\baddress\b/i.test(b) && /\bour\b[^.]*\bserver\b/i.test(b),
        ),
        `${tool.name}: no sentence says its address is fetched by our server`,
      ).toBe(true);
    }
  });
});

describe("/privacy lists what Google Analytics receives (rows 9, 10, 2, 17)", () => {
  it("every product event, and every field it carries, is listed", () => {
    const text = sectionText(renderPage(), "what-we-collect");
    const missing: string[] = [];
    for (const [event, fields] of productEventFields()) {
      if (!text.includes(event)) missing.push(event);
      for (const field of fields)
        if (!text.includes(field)) missing.push(`${event}.${field}`);
    }
    expect(missing, `§4 omits: ${missing.join(", ")}`).toEqual([]);
  });

  it("page views are described with their title and the previous page", () => {
    const text = sectionText(renderPage(), "what-we-collect");
    expect(text).toMatch(/\btitle\b/i);
    expect(text).toMatch(/\bprevious page\b/i);
  });

  it("the in-browser paragraph carves out the size band a consented run sends", () => {
    const fields = productEventFields().get("tool_completed") ?? [];
    expect(fields).toContain("outputSize");
    const paragraph = blocksOf(renderPage(), "files").find((b) =>
      b.startsWith("Tools that run in your browser"),
    );
    expect(sizeCarveOutIssues(paragraph)).toEqual([]);
  });

  it("the Notify me bullet says the press also reaches Google Analytics", () => {
    // Derived: the button tracks the event, and the event is real.
    expect(read("src/components/tools/notify-me.tsx")).toMatch(
      /name:\s*"gated_tool_interest"/,
    );
    expect(EVENT_NAMES).toContain("gated_tool_interest");
    const bullet = blocksOf(renderPage(), "what-we-collect").find((b) =>
      b.includes("Notify me"),
    );
    expect(bullet).toMatch(/\bGoogle Analytics\b/);
  });
});

describe("/privacy says the AI provider's retention (row 13)", () => {
  it("§3 names the production provider and what it may keep", () => {
    const ai = sectionText(renderPage(), "ai");
    expect(ai).toContain("OpenAI");
    expect(ai).toContain(OUTSIDE_FACTS.aiProviderRetention);
    expect(ai).not.toMatch(/minutes,\s+not\s+days/i);
  });
});

describe("/privacy describes cookies the code cannot rule out (row 14)", () => {
  it("§5 says our code sets none and Cloudflare may set its own", () => {
    const cookies = sectionText(renderPage(), "cookies");
    expect(cookies).not.toMatch(/\bthe one kind of cookie\b/i);
    expect(cookies).toMatch(/\bour own code sets no cookies\b/i);
    expect(cookies).toContain("Cloudflare");
    expect(cookies).toMatch(/\blifetime\b/i);
  });
});

describe("/privacy §9 promises only what the code enforces (rows 7, 12)", () => {
  it("the CSP is not called strict while script-src allows inline scripts", async () => {
    const { scriptSrc } = await servedCspHosts();
    const security = sectionText(renderPage(), "security");
    if (scriptSrc.includes("'unsafe-inline'")) {
      expect(security).not.toMatch(/\bstrict\b/i);
      expect(security).toMatch(/\binline scripts\b/i);
    }
  });

  it("no sentence says a scanner-less deployment refuses to start while strict mode does not demand one", () => {
    const strictOnly = evaluateGuardrails({ [GUARDRAIL_ENV.strict]: "1" });
    const armed = evaluateGuardrails({ [GUARDRAIL_ENV.requireScan]: "1" });
    const scanCodes = (r: typeof armed) =>
      r.violations.map((v) => v.code).filter((c) => c === "require_scan_unmet");
    // Positive control: the predicate can see the guardrail when it IS armed.
    expect(scanCodes(armed)).toEqual(["require_scan_unmet"]);
    if (scanCodes(strictOnly).length === 0) {
      const security = sectionText(renderPage(), "security");
      expect(security).not.toMatch(/refuses?\s+to\s+(?:start|run)/i);
      expect(security).not.toMatch(/quietly\s+lapse/i);
    }
  });
});

describe("/privacy states the password's real lifetime (row 8)", () => {
  it("the password paragraph matches the Protect/Unlock panel", () => {
    const blocks = blocksOf(renderPage(), "files");
    const para = blocks.find((b) => /\bpassword you type\b/i.test(b));
    expect(para).toBeDefined();
    expect(para).not.toMatch(/sits in that job record/i);
    // AMENDED 2026-10-10 (review): "until the job finishes or is cancelled"
    // was the shape of "waits only until …, then it is deleted" — silent about
    // the queue's on-disk journal. The event is unchanged; the verb is not.
    expect(para).toMatch(/when the job finishes or is cancelled/i);
  });

  it("the page and the panel say it from one constant", () => {
    // They disagreed until 2026-10-10 because each had its own sentence.
    expect(sectionText(renderPage(), "files")).toContain(
      PASSWORD_QUEUE_LIFETIME,
    );
    expect(read("src/components/tools/pdf-security-worker-panel.tsx")).toMatch(
      /\{PASSWORD_QUEUE_LIFETIME\}/,
    );
  });

  it("the password's lifetime names the queue's window, as every other input's does", () => {
    // Review, 2026-10-10: the signer's email address got "after 24 hours" and
    // the password — the most sensitive input — got "until the queue's
    // retention lapses", no figure. Mutation: dropping the window from
    // PASSWORD_QUEUE_LIFETIME turns this red.
    const para = blocksOf(renderPage(), "files").find((b) =>
      b.startsWith("One case worth naming."),
    );
    expect(para).toBeDefined();
    expect(para).toContain(RETENTION_WINDOWS.jobRecord);
    expect(PASSWORD_QUEUE_LIFETIME).toContain(RETENTION_WINDOWS.jobRecord);
    // Positive control: the sentence that shipped carries no figure.
    expect(SHIPPED.passwordLifetime).not.toContain(RETENTION_WINDOWS.jobRecord);
  });
});

/* ------------------------------------------------------------------ *
 *  The queue's on-disk journal (review, 2026-10-10)
 * ------------------------------------------------------------------ */

/**
 * A block that says how long our job queue keeps something: until (or when)
 * the job ends, or a job record kept for / expiring after a window.
 *
 * The queue is a self-hosted Redis 7 with append-only persistence
 * (`docs/RATE_LIMITING.md`: `--appendonly yes`), so a key the queue DELETEs
 * at FINALIZE — or lets expire — stays in the append-only file on the web
 * server's disk until that file is rewritten. The 2026-10-10 copy said what
 * the queue does and was silent about its journal; how often production
 * rewrites it is not recorded anywhere (the Art. 30 record: owner to
 * confirm). So every such sentence must say the journal can keep a copy.
 */
const QUEUE_LIFETIME =
  /\b(?:job queue|our queue)\b[^.]*\b(?:until|when)\s+the\s+job\s+(?:ends|finishes)\b|\b(?:record of the job|job record)\b[^.]*\b(?:kept\s+for|expires)\b/i;

const lifetimesWithoutJournal = (blocks: readonly string[]) =>
  blocks.filter((b) => QUEUE_LIFETIME.test(b) && !/\bjournal\b/i.test(b));

describe("/privacy says the queue's journal can outlive what the queue deletes", () => {
  it("positive control: every lifetime sentence that shipped without the journal is caught", () => {
    expect(
      lifetimesWithoutJournal([
        SHIPPED.inTheQueue,
        SHIPPED.passwordLifetime,
        SHIPPED.jobRecord,
      ]),
    ).toHaveLength(3);
  });

  it("health: the page states queue lifetimes at all (three blocks or more)", () => {
    const stating = blocksOf(renderPage()).filter((b) =>
      QUEUE_LIFETIME.test(b),
    );
    expect(stating.length, stating.join("\n")).toBeGreaterThanOrEqual(3);
  });

  it("every block on the page that says how long the queue keeps something names the journal", () => {
    const missing = lifetimesWithoutJournal(blocksOf(renderPage()));
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("so does every sentence the registries hand to other pages", () => {
    // The Protect/Unlock panel renders PASSWORD_QUEUE_LIFETIME on its own.
    expect(lifetimesWithoutJournal([PASSWORD_QUEUE_LIFETIME])).toEqual([]);
    expect(QUEUE_LIFETIME.test(PASSWORD_QUEUE_LIFETIME)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 *  §2 as a reader meets it (review, 2026-10-10)
 * ------------------------------------------------------------------ */

/** The `ul` the timetable intro promises must be the next thing rendered. */
function timetableOrderIssues(section: Element): string[] {
  const intro = Array.from(section.querySelectorAll("p")).find((p) =>
    norm(p.textContent ?? "").endsWith("timetable:"),
  );
  if (!intro) return ["no paragraph introduces the timetable"];
  const next = intro.nextElementSibling;
  if (!next || next.tagName !== "UL")
    return [
      `"…timetable:" is followed by <${next?.tagName.toLowerCase()}>: ${norm(next?.textContent ?? "").slice(0, 80)}`,
    ];
  const first = norm(next.querySelector("li")?.textContent ?? "");
  return first.startsWith("The uploaded file is actively deleted")
    ? []
    : [`the timetable's first item is: ${first.slice(0, 80)}`];
}

/** Links to /status inside the inputs block — which /status does not list. */
function statusLinksInInputs(section: Element): string[] {
  const lead = Array.from(section.querySelectorAll("p")).find((p) =>
    norm(p.textContent ?? "").startsWith("What some tools ask you for."),
  );
  if (!lead) return ["no inputs block"];
  const found: string[] = [];
  for (let el: Element | null = lead; el; el = el.nextElementSibling)
    if (el.querySelector('a[href="/status"]'))
      found.push(norm(el.textContent ?? "").slice(0, 100));
  return found;
}

/** A DOM fragment, for the controls. */
function fragment(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("§2 puts each answer where its question is", () => {
  it("positive control: the order that shipped is caught", () => {
    const shipped = fragment(
      "<p>…processed on our processing server, and then removed on this timetable:</p>" +
        "<p>Counted here, but browser-first (1 of 21). This group — Compress PDF — …</p>" +
        "<ul><li>The uploaded file is actively deleted as soon as …</li></ul>",
    );
    expect(timetableOrderIssues(shipped)).toHaveLength(1);
  });

  it("the timetable follows the sentence that promises it", () => {
    const files = renderPage().querySelector("#files")!;
    expect(timetableOrderIssues(files)).toEqual([]);
  });

  it("positive control: a status link inside the inputs block is caught", () => {
    const shipped = fragment(
      "<p>What some tools ask you for. 8 of our server and AI tools also take something you type.</p>" +
        "<ul><li>Request Signatures asks for …</li></ul>" +
        '<p>Every tool page states which of these applies before you choose a file, and <a href="/status">the status page</a> lists them all.</p>',
    );
    expect(statusLinksInInputs(shipped)).toHaveLength(1);
  });

  it("no link in the inputs block sends the reader to /status, which does not list inputs", () => {
    const files = renderPage().querySelector("#files")!;
    expect(statusLinksInInputs(files)).toEqual([]);
  });

  it("the inputs list states the queue's rule once, and leads each item with its tools", () => {
    const files = renderPage().querySelector("#files")!;
    const lead = Array.from(files.querySelectorAll("p")).find((p) =>
      norm(p.textContent ?? "").startsWith("What some tools ask you for."),
    )!;
    expect(lead).toBeDefined();
    expect(norm(lead.textContent ?? "")).toMatch(/\bjob queue\b/);
    expect(norm(lead.textContent ?? "")).toContain(RETENTION_WINDOWS.jobRecord);
    const list = lead.nextElementSibling!;
    expect(list.tagName).toBe("UL");
    const items = Array.from(list.querySelectorAll(":scope > li"));
    expect(items.length).toBe(ASKED_FOR_COPY.length);
    const names = new Set(tools.map((t) => t.name));
    for (const li of items) {
      const text = norm(li.textContent ?? "");
      // The rule is said once, above — not after each item.
      expect(text, text).not.toMatch(/\bjob queue\b/);
      const strong = li.firstElementChild;
      expect(strong?.tagName, `no bold lead: ${text}`).toBe("STRONG");
      const lead = norm(strong!.textContent ?? "");
      expect(
        [...names].some((n) => lead.includes(n)),
        `the lead names no tool: ${lead}`,
      ).toBe(true);
    }
    // Positive control: the per-item sentence that shipped says "job queue".
    expect(SHIPPED.inTheQueue).toMatch(/\bjob queue\b/);
  });
});

/* ------------------------------------------------------------------ *
 *  §4's Google Analytics bullet (review, 2026-10-10)
 * ------------------------------------------------------------------ */

/** The most one block may hold before it is a wall of text on a phone. */
const LONGEST_BLOCK = 600;

/** Every `p` and `li` of a section, its OWN text — nested blocks removed. */
function ownBlocks(page: HTMLElement, id: string): string[] {
  const root = page.querySelector(`#${id}`)!;
  return Array.from(root.querySelectorAll("p, li"))
    .map((el) => {
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll("p, ul, ol, dl").forEach((n) => n.remove());
      return norm(clone.textContent ?? "");
    })
    .filter(Boolean);
}

const overlong = (blocks: readonly string[]) =>
  blocks.filter((b) => b.length > LONGEST_BLOCK);

/**
 * What §4 must say about hits our code does not author. gtag.js sends its own
 * automatic events (session start, first visit, engagement time), and a GA4
 * property's Enhanced Measurement setting — in the GA admin, not in code, and
 * not verified off (the Art. 30 record) — can add scrolls, outbound clicks,
 * site searches and file downloads. And every product event carries a
 * query-free `page_referrer` beside its location (`pageOf` in ga4.ts).
 */
function gaDisclosureIssues(text: string): string[] {
  const issues: string[] = [];
  if (!/\b(?:session|visit)\b[^.]*\bstart/i.test(text))
    issues.push("does not say Google records that a visit started");
  if (!/\bfirst visit\b/i.test(text))
    issues.push("does not say Google records a first visit");
  if (!/\bhow long\b[^.]*\bin use\b|\bengage/i.test(text))
    issues.push("does not say Google records engagement time");
  if (!/\bevents?\b[^.]*\bprevious page\b/i.test(text))
    issues.push("does not say events carry the previous page");
  if (!/\bscroll/i.test(text) || !/\bdownload/i.test(text))
    issues.push("does not name what a property setting can add");
  return issues;
}

describe("§4 says what Google Analytics receives, readably (rows 9, 10)", () => {
  it("positive control: the 1,179-character bullet is caught, and so is its silence", () => {
    expect(SHIPPED.analyticsBullet.length).toBe(1179);
    expect(overlong([SHIPPED.analyticsBullet])).toHaveLength(1);
    expect(gaDisclosureIssues(SHIPPED.analyticsBullet).length).toBe(5);
  });

  it(`no §4 paragraph or list item runs past ${LONGEST_BLOCK} characters`, () => {
    const blocks = ownBlocks(renderPage(), "what-we-collect");
    expect(blocks.length).toBeGreaterThan(8);
    expect(overlong(blocks), overlong(blocks).join("\n\n")).toEqual([]);
  });

  it("names Google's own measurements and the previous page on events", () => {
    const text = sectionText(renderPage(), "what-we-collect");
    expect(gaDisclosureIssues(text)).toEqual([]);
  });

  it("§2 does not call §4's list everything Google receives", () => {
    // Positive control first: the sentence that shipped.
    expect(SHIPPED.inBrowserEverything).toMatch(/\beverything\b/);
    const paragraph = blocksOf(renderPage(), "files").find((b) =>
      b.startsWith("Tools that run in your browser"),
    );
    expect(paragraph).toBeDefined();
    expect(paragraph).not.toMatch(/\beverything\b/);
  });
});

describe("the registries the page renders agree with the bounds above", () => {
  it("the CSP flag §9 reads is what the served header says", async () => {
    const { scriptSrc } = await servedCspHosts();
    expect(CSP_ALLOWS_INLINE_SCRIPTS).toBe(
      scriptSrc.includes("'unsafe-inline'"),
    );
  });

  it("the processor registry names the production facts, and nothing the code cannot place", async () => {
    const { names } = await requiredProcessors();
    const registered = PROCESSORS.map((p) => `${p.name} ${p.does}`).join(" ");
    expect(names.filter((n) => !registered.includes(n))).toEqual([]);
    // Every registered company is either a code integration or a recorded
    // outside fact — never a name typed in passing.
    const accounted = new Set([
      ...(await requiredProcessors()).origins
        .filter((o) => o.active)
        .map((o) => o.company),
      OUTSIDE_FACTS.webHost.company,
      OUTSIDE_FACTS.workerHost.company,
      OUTSIDE_FACTS.edge.company,
    ]);
    expect(
      PROCESSORS.map((p) => p.name).filter((n) => !accounted.has(n)),
    ).toEqual([]);
    expect(AI_PROVIDER.family).toBe(OUTSIDE_FACTS.aiFamily);
    expect(AI_PROVIDER_RETENTION).toBe(OUTSIDE_FACTS.aiProviderRetention);
  });
});

describe("/privacy describes the rate limiter as it runs (row 1)", () => {
  it("§4 says how requests are counted, and §6 does not deny identifiers the logs hold", () => {
    const page = renderPage();
    const limiter = blocksOf(page, "what-we-collect").find((b) =>
      /\brate limit/i.test(b),
    );
    expect(limiter, "no §4 block describes rate limiting").toBeDefined();
    expect(limiter).toMatch(/\bshared\b|\bhash\b/i);
    expect(sectionText(page, "why")).not.toMatch(/carry no identifiers/i);
  });
});

describe("/privacy covers what Art. 13 requires (omissions c-g, row 18)", () => {
  it("c — retention is stated for email, Google's data and the rate-limit counters", () => {
    const page = renderPage();
    const blocks = blocksOf(page, "what-we-collect");
    const email = blocks.find((b) => /\bemail us\b/i.test(b));
    expect(email).toMatch(/\b(?:period|how long|delete)\b/i);
    const collect = sectionText(page, "what-we-collect");
    expect(collect).toMatch(/\bretention setting\b/i);
    const limiter = blocks.find((b) => /\brate limit/i.test(b));
    expect(limiter).toMatch(/\b(?:reset|expire)s?\b/i);
  });

  it("d — says whether anyone must provide personal data, and what follows if not", () => {
    expect(sectionText(renderPage(), "why")).toMatch(
      /\bno law or contract requires you\b/i,
    );
  });

  it("e — says whether automated decision-making happens", () => {
    expect(sectionText(renderPage(), "why")).toMatch(/\bautomated\b/i);
  });

  it("g — maps a lawful basis to each purpose, email and signers included", () => {
    const why = sectionText(renderPage(), "why");
    for (const purpose of [
      /\bfiles?\b/i,
      /\blogs?\b/i,
      /\bemail\b/i,
      /\bsigners?\b/i,
      /\banalytics\b/i,
    ])
      expect(why).toMatch(purpose);
    for (const basis of [
      /contract/i,
      /legitimate interests/i,
      /consent/i,
      /legal obligation/i,
    ])
      expect(why).toMatch(basis);
  });

  it("18 — children: the analytics consent age above the site's minimum is addressed", () => {
    const children = sectionText(renderPage(), "children");
    expect(children).toMatch(/\b16\b/);
    expect(children).toMatch(/\banalytics\b/i);
  });
});

// Guards the guard: if the page moves, the section reads above must fail
// loudly rather than read an empty string.
describe("the sections this file reads exist", () => {
  it.each([
    "files",
    "ai",
    "what-we-collect",
    "cookies",
    "why",
    "sharing",
    "transfers",
    "security",
    "children",
  ])("#%s renders prose", (id) => {
    expect(sectionText(renderPage(), id).length).toBeGreaterThan(80);
  });

  it("this file's own source exists where vitest found it", () => {
    expect(
      existsSync(path.join(ROOT, "src", "app", "privacy", "page.tsx")),
    ).toBe(true);
  });
});
