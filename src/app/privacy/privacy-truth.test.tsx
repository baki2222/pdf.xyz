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

/**
 * Every free-text leaf (`string`, through arrays and same-file interfaces)
 * of every interface a `parse…Options` function in `src/lib/jobs` returns,
 * as `Interface.path`. String-literal aliases (enums) are not free text.
 */
function freeTextOptionFields(): string[] {
  const dir = path.join(ROOT, "src", "lib", "jobs");
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.ts$/.test(f) || f.includes(".test.") || f.includes(".examples."))
      continue;
    const sf = parseTs(path.join(dir, f));
    const interfaces = new Map<string, ts.InterfaceDeclaration>();
    const returned = new Set<string>();
    sf.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        /^parse\w*Options$/.test(node.name.text) &&
        node.type
      ) {
        const m = /^ParseResult<(\w+)>$/.exec(node.type.getText(sf));
        if (m) returned.add(m[1]!);
      }
    });
    const walk = (decl: ts.InterfaceDeclaration, prefix: string) => {
      for (const member of decl.members) {
        if (!ts.isPropertySignature(member) || !member.type) continue;
        const name = (member.name as ts.Identifier).text;
        let type = member.type;
        let suffix = "";
        if (ts.isArrayTypeNode(type)) {
          type = type.elementType;
          suffix = "[]";
        }
        if (type.kind === ts.SyntaxKind.StringKeyword) {
          out.push(`${prefix}.${name}${suffix}`);
        } else if (ts.isTypeReferenceNode(type)) {
          const inner = interfaces.get(type.typeName.getText(sf));
          if (inner) walk(inner, `${prefix}.${name}${suffix}`);
        }
      }
    };
    for (const name of returned) {
      const decl = interfaces.get(name);
      if (!decl) throw new Error(`${f}: ${name} is returned but not declared`);
      walk(decl, name);
    }
  }
  return out.sort();
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
    expect(para).toMatch(/until the job finishes or is cancelled/i);
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
