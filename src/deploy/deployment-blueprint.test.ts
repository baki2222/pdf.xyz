// @vitest-environment node
/**
 * Static validators for the Phase 32 deployment BLUEPRINT under
 * `docs/examples/deployment/`. The Docker daemon, a broker, storage, and ClamAV are
 * all unavailable in this repo's build environment, so nothing here is ever run —
 * instead these assertions pin the blueprint's structure and prove it leaks no secret,
 * endpoint, real domain, public IP, object key, or password. They are the testable
 * stand-in for a live deploy, and they require NO Docker or external service.
 *
 * The compose parser is a focused, line-based reader (the same idiom as the Dockerfile
 * stage parser in `artifacts.test.ts`) — enough to assert per-service structure without
 * pulling a YAML dependency the repo does not have.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = "docs/examples/deployment";
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

// --------------------------------------------------------------------------- //
// Secret / leak vocabulary (re-declared locally, matching the repo idiom).
// --------------------------------------------------------------------------- //
/** AWS-style access-key ids — a hard fail wherever they appear. */
const AWS_KEY = /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/;
/** A value is safe-by-inspection when it is empty, an interpolation, or a placeholder. */
const PLACEHOLDER =
  /(REPLACE|EXAMPLE|CHANGE|CHANGEME|YOUR[-_]|PLACEHOLDER|\bXXX+\b|<[^>]+>|\.\.\.|\.invalid\b|\.local\b)/i;
/** Variable names whose committed value must be a placeholder/interpolation/empty. */
const SECRETISH = /(SECRET|TOKEN|PASSWORD|ACCESS_KEY_ID|ACCESS_KEY|PRIVATE_KEY|_KEY)$/i;
/** Known managed-provider endpoints — never a committed literal in a template. */
const PROVIDER_LEAK =
  /(amazonaws\.com|\.upstash\.io|\.r2\.cloudflarestorage\.com|googleapis\.com|\.blob\.core\.windows\.net|\bsupabase\.co\b)/i;

/** Compose service names that are legitimate internal URL authorities. */
const SERVICE_AUTHORITIES = new Set(["web", "worker", "broker", "redis", "clamav"]);
/** Loopback / any-address authorities that are never a real endpoint. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Worker-only variable prefixes that must NEVER appear in the web service env. */
const WORKER_ONLY_ENV =
  /^PDFXYZ_(STORAGE|S3|QUEUE|REDIS|MALWARE|CLAMAV|OCR|COMPRESSION|NATIVE_COMPRESSION|WORKER)/;

// --------------------------------------------------------------------------- //
// A minimal, line-based compose reader.
// --------------------------------------------------------------------------- //
interface ComposeService {
  name: string;
  /** The service's body lines, at their original indentation. */
  lines: string[];
}

const indentOf = (line: string): number => {
  const match = /^( *)/.exec(line);
  return match?.[0].length ?? 0;
};

/** Parse the `services:` block into a name → body-lines map. */
function parseComposeServices(yaml: string): Map<string, ComposeService> {
  const lines = yaml.split("\n");
  const services = new Map<string, ComposeService>();
  let i = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (i < 0) return services;
  let current: ComposeService | null = null;
  for (i += 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || /^\s*#/.test(line)) {
      if (current) current.lines.push(line);
      continue;
    }
    if (indentOf(line) === 0) break; // dedented out of the services block
    const svc = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (indentOf(line) === 2 && svc) {
      current = { name: svc[1]!, lines: [] };
      services.set(current.name, current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return services;
}

/** Lines strictly more indented than a 4-space `key:` block header. */
function keyBlock(svc: ComposeService, key: string, keyIndent = 4): string[] {
  const header = new RegExp(`^ {${keyIndent}}${key}:\\s*$`);
  const out: string[] = [];
  let capturing = false;
  for (const line of svc.lines) {
    if (!capturing) {
      if (header.test(line)) capturing = true;
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (indentOf(line) <= keyIndent) break;
    out.push(line);
  }
  return out;
}

/** The service's `environment:` map (6-space `NAME: value`). */
function serviceEnv(svc: ComposeService): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of keyBlock(svc, "environment")) {
    const m = /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!.trim();
  }
  return env;
}

const hasPublishedPorts = (svc: ComposeService): boolean =>
  svc.lines.some((l) => /^ {4}ports:\s*$/.test(l));

function serviceProfiles(svc: ComposeService): string[] {
  return keyBlock(svc, "profiles")
    .map((l) => /^ {6}-\s*(\S+)/.exec(l)?.[1])
    .filter((x): x is string => Boolean(x));
}

const healthcheckText = (svc: ComposeService): string => keyBlock(svc, "healthcheck").join("\n");

function buildTarget(svc: ComposeService): string | undefined {
  const t = keyBlock(svc, "build").find((l) => /^ {6}target:/.test(l));
  return t ? /target:\s*(\S+)/.exec(t)?.[1] : undefined;
}

// --------------------------------------------------------------------------- //
// URL authority + public-IP extraction (for the honesty scans).
// --------------------------------------------------------------------------- //
function authorities(text: string): string[] {
  const out: string[] = [];
  const re = /\b[a-z][a-z0-9+.-]*:\/\/([^/\s"'\]]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!);
  return out;
}

function hostOf(authority: string): string {
  const a = authority.replace(/^[^@]*@/, ""); // strip userinfo
  if (a.startsWith("[")) return a.slice(1, a.indexOf("]")); // IPv6 literal
  const colon = a.lastIndexOf(":");
  return colon > 0 ? a.slice(0, colon) : a;
}

function isAllowedHost(host: string): boolean {
  if (host.includes("$")) return true; // ${VAR} / nginx $var interpolation, not a literal
  if (SERVICE_AUTHORITIES.has(host) || LOOPBACK.has(host)) return true;
  return PLACEHOLDER.test(host);
}

/** Non-loopback, non-private IPv4 literals — a leaked real address. */
function publicIPv4s(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (m[0] === "0.0.0.0") continue;
    if (a === 127 || a === 10) continue; // loopback / private
    if (a === 192 && b === 168) continue;
    if (a === 172 && b >= 16 && b <= 31) continue;
    if (a === 169 && b === 254) continue; // link-local
    if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) continue; // not an IP
    out.push(m[0]);
  }
  return out;
}

/** Extract `NAME=value` env assignments, dropping full-line comments. */
function assignments(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*#.*$/, "");
    if (!line.trim()) continue;
    const m = /^\s*([A-Z][A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    out.push({ name: m[1]!, value: m[2]!.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim() });
  }
  return out;
}

// --------------------------------------------------------------------------- //
const COMPOSE = `${DIR}/docker-compose.blueprint.yml`;

describe("blueprint compose — structure & the four topology services", () => {
  const yaml = read(COMPOSE);
  const services = parseComposeServices(yaml);

  it("parses structurally: a services block, even indentation, no tabs", () => {
    expect(yaml).toMatch(/^services:\s*$/m);
    expect(yaml).not.toContain("\t");
    for (const line of yaml.split("\n")) {
      if (line.trim() === "" || /^\s*#/.test(line)) continue;
      expect(indentOf(line) % 2, `odd indent: ${JSON.stringify(line)}`).toBe(0);
    }
  });

  it("defines web, worker, a Redis-compatible broker (+ backing redis), and clamav", () => {
    for (const name of ["web", "worker", "redis", "broker", "clamav"]) {
      expect([...services.keys()], `missing service ${name}`).toContain(name);
    }
  });

  it("builds the web and worker from the two independent Dockerfile targets", () => {
    expect(buildTarget(services.get("web")!)).toBe("web");
    expect(buildTarget(services.get("worker")!)).toBe("worker");
  });

  it("publishes a port ONLY for web — worker/broker/redis/clamav expose none", () => {
    expect(hasPublishedPorts(services.get("web")!)).toBe(true);
    for (const name of ["worker", "broker", "redis", "clamav"]) {
      expect(hasPublishedPorts(services.get(name)!), `${name} must not publish a port`).toBe(false);
    }
  });

  it("keeps the broker/redis (local-broker) and clamav (scanner) behind opt-in profiles", () => {
    expect(serviceProfiles(services.get("redis")!)).toContain("local-broker");
    expect(serviceProfiles(services.get("broker")!)).toContain("local-broker");
    expect(serviceProfiles(services.get("clamav")!)).toContain("scanner");
    // web + worker always run — no profile gate.
    expect(serviceProfiles(services.get("web")!)).toEqual([]);
    expect(serviceProfiles(services.get("worker")!)).toEqual([]);
  });
});

describe("blueprint compose — web ↔ worker env separation", () => {
  const services = parseComposeServices(read(COMPOSE));
  const webEnv = serviceEnv(services.get("web")!);
  const workerEnv = serviceEnv(services.get("worker")!);

  it("the web service receives NO worker-only provider/OCR/scanner/engine env", () => {
    for (const name of Object.keys(webEnv)) {
      expect(WORKER_ONLY_ENV.test(name), `web must not receive worker-only env ${name}`).toBe(
        false,
      );
    }
    // It carries only the innocuous runtime env.
    expect(webEnv.NODE_ENV).toBe("production");
  });

  it("the worker service references the storage + queue providers by interpolation", () => {
    for (const name of [
      "PDFXYZ_STORAGE_PROVIDER",
      "PDFXYZ_S3_BUCKET",
      "PDFXYZ_S3_SECRET_ACCESS_KEY",
      "PDFXYZ_REDIS_REST_URL",
      "PDFXYZ_REDIS_REST_TOKEN",
    ]) {
      expect(workerEnv[name], `worker env ${name}`).toBeDefined();
      expect(workerEnv[name], `worker env ${name} must interpolate, not inline`).toContain("${");
    }
  });

  it("wires the optional scanner + heartbeat consistently with Phase 30/31, by interpolation", () => {
    expect(workerEnv.PDFXYZ_MALWARE_SCANNER).toContain("${");
    expect(workerEnv.PDFXYZ_WORKER_HEARTBEAT).toContain("${");
    expect(workerEnv.PDFXYZ_WORKER_HEARTBEAT_INTERVAL_SECONDS).toContain("${");
  });

  it("supplies every secret-ish value by interpolation, never inline", () => {
    for (const [name, value] of Object.entries(workerEnv)) {
      if (!SECRETISH.test(name)) continue;
      expect(value, `${name} must interpolate`).toContain("${");
    }
  });
});

describe("blueprint compose — content-free healthchecks (no user documents)", () => {
  const services = parseComposeServices(read(COMPOSE));

  it("the worker healthcheck is the presence-only readiness probe, never a processing mode", () => {
    const hc = healthcheckText(services.get("worker")!);
    expect(hc).toContain("--dry-run-status");
    expect(hc).not.toMatch(/--drain|--once|worker:daemon"\s*\]$/m);
  });

  it("no healthcheck claims a job or processes a document", () => {
    for (const name of ["web", "worker", "redis", "broker", "clamav"]) {
      const hc = healthcheckText(services.get(name)!);
      // A health probe touches no job/artifact/upload and runs no processing mode.
      // (`process.exit` in the web node one-liner is Node's process object, not a
      // document-processing mode, so it is deliberately not in this list.)
      expect(hc, `${name} healthcheck`).not.toMatch(
        /--drain|--once|artifact|upload|clamdscan\b|\bjob\b/i,
      );
    }
  });

  it("the web healthcheck is a content-free loopback liveness check", () => {
    const hc = healthcheckText(services.get("web")!);
    expect(hc).toMatch(/127\.0\.0\.1:3000/);
  });
});

describe("blueprint env-file — placeholders only, honest broker framing", () => {
  const ENV = `${DIR}/.env.blueprint.example`;
  const text = read(ENV);
  const active = assignments(text);

  it("parses as NAME=value assignments with no tabs", () => {
    expect(text).not.toContain("\t");
    expect(active.length).toBeGreaterThan(4);
  });

  it("every secret-ish value is a placeholder (no committed credential)", () => {
    for (const { name, value } of active) {
      if (!SECRETISH.test(name)) continue;
      const safe = value === "" || value.includes("${") || PLACEHOLDER.test(value);
      expect(safe, `${name} looks like a committed secret ("${value}")`).toBe(true);
    }
  });

  it("points the local broker + scanner at the internal service names only", () => {
    const map = Object.fromEntries(active.map((a) => [a.name, a.value]));
    expect(map.PDFXYZ_REDIS_REST_URL).toBe("http://broker:80");
    expect(map.PDFXYZ_MALWARE_SCANNER).toBe("clamav://clamav:3310");
  });

  it("exposes no server-only secret via NEXT_PUBLIC_", () => {
    for (const { name } of active) expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});

// --------------------------------------------------------------------------- //
// Whole-tree honesty scan: no committed artifact may leak a real endpoint.
// --------------------------------------------------------------------------- //
const BLUEPRINT_FILES = [
  `${DIR}/docker-compose.blueprint.yml`,
  `${DIR}/.env.blueprint.example`,
  `${DIR}/reverse-proxy/nginx.conf.example`,
  `${DIR}/README.md`,
];

describe("blueprint files leak no secret, real endpoint, domain, or public IP", () => {
  for (const rel of BLUEPRINT_FILES) {
    it(`${rel}: no AWS key, no managed-provider endpoint, no public IP`, () => {
      const text = read(rel);
      expect(text, "AWS key").not.toMatch(AWS_KEY);
      expect(text, "managed-provider endpoint").not.toMatch(PROVIDER_LEAK);
      expect(publicIPv4s(text), "public IPv4").toEqual([]);
    });

    it(`${rel}: every URL authority is an internal service name or a placeholder`, () => {
      for (const authority of authorities(read(rel))) {
        const host = hostOf(authority);
        expect(isAllowedHost(host), `${rel}: leaked authority "${authority}"`).toBe(true);
      }
    });

    it(`${rel}: no NEXT_PUBLIC_ leak of a server-only secret`, () => {
      // A comment MAY state the "never NEXT_PUBLIC_" rule; no assignment may set one.
      const code = read(rel)
        .split("\n")
        .map((l) => l.replace(/(^|\s)#.*$/, "$1"))
        .join("\n");
      expect(code).not.toMatch(/NEXT_PUBLIC_\w*(SECRET|TOKEN|KEY|PROVIDER|URL)/);
    });
  }
});

describe("blueprint docs cross-references resolve", () => {
  it("every file the deployment README links to exists on disk", () => {
    const readme = read(`${DIR}/README.md`);
    const links = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);
    const local = links.filter((l) => !l.startsWith("http") && !l.startsWith("#"));
    expect(local.length).toBeGreaterThan(0);
    for (const link of local) {
      const target = path.join(ROOT, DIR, link.split("#")[0]!);
      expect(existsSync(target), `README links to missing ${link}`).toBe(true);
    }
  });

  it("the root DEPLOYMENT + RUNBOOK docs point at the blueprint directory", () => {
    for (const doc of ["docs/DEPLOYMENT.md", "docs/RUNBOOK.md"]) {
      expect(read(doc), `${doc} should reference the blueprint`).toContain(
        "docs/examples/deployment",
      );
    }
  });
});

// --------------------------------------------------------------------------- //
// Kubernetes web ↔ worker separation. The scheduler-templates suite pins most of
// the k8s shape; this closes the one gap that a text-only grep of the web manifest
// misses — the EFFECTIVE env a `envFrom` reference would inject. The public web pod
// must inherit no worker secret and no worker-only engine/heartbeat/ops-check config.
// --------------------------------------------------------------------------- //
describe("kubernetes web pod receives no worker secret or worker-only engine env", () => {
  const K8S = `${DIR}/kubernetes`;
  const web = read(`${K8S}/web-deployment.yaml`);
  const worker = read(`${K8S}/worker-deployment.yaml`);

  it("the web Deployment mounts no worker secret and does not inherit the worker ConfigMap", () => {
    // Strip comments so a comment that NAMES the rule (e.g. "does not mount pdfxyz-config")
    // can't trip these checks — only real manifest keys count.
    const webCode = web
      .split("\n")
      .map((l) => l.replace(/(^|\s)#.*$/, "$1"))
      .join("\n");
    expect(webCode).not.toContain("secretRef:"); // no provider secret on the public tier
    // Mounting no ConfigMap/envFrom is what keeps the worker-only engine/heartbeat/
    // ops-check knobs out of the web pod's EFFECTIVE environment; it uses inline env only.
    expect(webCode).not.toContain("configMapRef:");
    expect(webCode).not.toContain("envFrom:");
    expect(webCode).not.toMatch(
      /PDFXYZ_(S3|REDIS|MALWARE|CLAMAV|OCR|COMPRESSION|NATIVE_COMPRESSION|WORKER|OPSCHECK)/,
    );
  });

  it("the web Deployment still serves the site over a ClusterIP Service on the web port", () => {
    expect(web).toMatch(/kind:\s*Service/);
    expect(web).toMatch(/containerPort:\s*3000/);
  });

  it("the worker Deployment takes the provider secret and exposes no public Service", () => {
    expect(worker).toContain("secretRef:");
    expect(worker).toMatch(/worker:daemon/);
    expect(worker).not.toMatch(/kind:\s*Service/); // the worker is never publicly exposed
  });
});
