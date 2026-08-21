// @vitest-environment node
/**
 * A refused request is refused BEFORE its body is read.
 *
 * The abuse guard exists so a flood costs us as little as possible. If a handler
 * reads and parses the body first and throttles afterwards, it still returns
 * 429 and every test of it still passes — while the work the guard was built to
 * avoid has already been paid for. **The defect is invisible in the response**,
 * which is why this looks at the request instead.
 *
 * It is the cheap-probe property from the other side, too: a caller can ask "am
 * I throttled?" and pay nothing for the answer, but only while the refusal
 * happens first.
 *
 * ── THE INSTRUMENT IS NOT `bodyUsed`, AND THAT WAS MEASURED ─────────────────
 *
 * The obvious check — `request.bodyUsed === false` after the refusal — is a
 * MECHANISM for the property, and it leaks in **both** directions. Measured in
 * this exact Node/undici build:
 *
 *  - **False while the handler DID consume.** `new Request(url, {method:"POST"})`
 *    has `body === null`; `await request.text()` returns `""` and `bodyUsed`
 *    stays false *forever*. A fixture with no body makes this whole file
 *    vacuous — the handler reads, and the assertion still passes. (`{body: ""}`
 *    behaves the opposite way, so an empty payload silently picks the answer.)
 *    Reading `request.clone().json()` also leaves the original false while
 *    draining the underlying source.
 *  - **True while the handler did NOT consume.** `request.body.cancel()` and
 *    `new Request(oldRequest)` each flip it with zero bytes moved. It also
 *    flips SYNCHRONOUSLY the instant `.text()` is called, before any byte is
 *    pulled: an intent flag, not a delivery flag.
 *    (An earlier draft of this list also named `new Response(request.body)`.
 *    Re-measured: constructing that Response leaves `bodyUsed` FALSE with zero
 *    pulls — only *reading* the Response disturbs it. A wrong reason in a
 *    docblock is the defect this file exists to catch, so it is corrected here
 *    rather than quietly dropped.)
 *
 * So the property — *zero bytes of the body were pulled* — is measured with a
 * body that COUNTS. `bodyUsed` and `cancelled` are reported as DIAGNOSTICS and
 * deliberately not asserted: each has a measured false positive on a correct
 * handler. One that refuses and then calls `request.body.cancel()` for socket
 * hygiene pulls nothing, yet `bodyUsed` is true and `cancelled` is 1 — and a
 * guard that reddens on a correct handler gets deleted.
 *
 * `highWaterMark: 0` is load-bearing. With the default strategy the stream
 * pre-pulls one chunk the instant the `Request` is constructed — measured
 * `{pulls: 1, bytesOut: 2}` before any handler ran — so a counter built the
 * obvious way reports consumption that never happened. `duplex: "half"` is
 * mandatory or the constructor throws.
 *
 * `cancelled === 0` matters too: without it, "refused before reading" cannot be
 * told apart from "read the body and threw it away".
 *
 * ── THE STATIC HALF LEAKS, IN BOTH DIRECTIONS, AND IT WAS MEASURED ─────
 *
 * Source order proves the guard call precedes the body read *in the text*. An
 * adversarial pass built six handlers that satisfy it and pull the whole body
 * anyway — all six run, none argued:
 *
 * ```
 *   guard called but NOT awaited          static PASS   429, 49 bytes pulled
 *   guard awaited, verdict ignored        static PASS   200, 49 bytes pulled
 *   guard behind `if (false)`             static PASS   200, 49 bytes pulled
 *   body read via an IMPORTED helper      static PASS   vacuous — read unseen
 *   body read via an ALIASED receiver     static PASS   vacuous — read unseen
 *   helper called twice, 2nd path bad     static PASS   `seen` stops at call 1
 * ```
 *
 * The first is now caught here, because a guard step is recorded where its
 * VERDICT BECOMES AVAILABLE rather than where the call appears: a guard whose
 * result is never awaited sorts after everything, which is where it runs. The rest are
 * why the behavioural half exists. The two “vacuous” rows are the worst shape —
 * the handler registers guard-only and the ordering rule never fires — which
 * is what the `withBody` floor below is for: if aliasing or a helper ever hides
 * a body read on a SHIPPED route, that count drops and the corpus check fails.
 *
 * It leaks the other way too: a body read inside a callback lexically above the
 * guard is reported as a violation though it runs after. Source order records a
 * callback’s position, not its execution point.
 *
 * ── WHAT THIS CANNOT SAY ────────────────────────────────────────────────────
 *
 * Stated because a guard that overclaims is worse than none.
 *
 *  - It proves the HANDLER pulled no bytes. **It does not prove the flood was
 *    free.** Measured against a real `node:http` server: an 8 MB POST whose
 *    handler answers 429 immediately and never touches the body still shows
 *    `socket.bytesRead === 8,388,844` and RSS +34 MB, identical to a control
 *    that never constructs a `Request` at all. Transfer and buffering are paid
 *    at the edge whatever the statement order inside the handler is. What
 *    ordering buys is the PARSING and validation, which is real and is what
 *    this measures — not the bandwidth.
 *  - Next hands a deployed handler a `NextRequest` it constructed; these tests
 *    construct a plain undici `Request`. Same interface, different object.
 *  - `guarded` here means the handler CALLS the guard, not that anything is
 *    throttled. On a default build `enforceRateLimit` short-circuits to
 *    `allowUnenforced` before reading a single header — so ordering is what is
 *    proven, and enforcement is a separate question owned by `ratelimit/`.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ENV,
  policyFor,
  type RateLimitAction,
} from "@/lib/ratelimit";
import {
  enforceRateLimit,
  resetRateLimitGuardForTests,
} from "@/lib/ratelimit/guard";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

/** HTTP methods Next.js treats as route handlers. */
const HTTP_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

/** Calls that consume the request body. */
const BODY_READS = new Set([
  "readJsonBody",
  "json",
  "text",
  "arrayBuffer",
  "formData",
  "blob",
  "bytes",
]);

/** Calls that refuse a request cheaply, before any body work. */
const GUARDS = new Set(["enforceRateLimit"]);

interface Step {
  readonly kind: "guard" | "body";
  readonly what: string;
  /** The policy action, on a guard step whose first argument is a literal. */
  readonly action?: string;
}

interface Handler {
  readonly method: string;
  /** Guard/body steps in the order the source performs them, delegation followed. */
  readonly steps: Step[];
}

/**
 * Every route handler file in the app — ALL of `src/app`, not just `src/app/api`.
 *
 * Scoping this to `api/` was the first version and it was wrong in the way this
 * codebase keeps paying for: a correct command over a set that quietly excluded
 * `src/app/manifest-icon-192.png/route.ts` and its 512 sibling, both real
 * `export function GET()` handlers. Neither violates the rule, so the check
 * would have stayed green — while any sentence of the form "every route handler
 * is guard-first" was already false by two.
 *
 * Untracked-but-not-ignored files are included because Next serves a route the
 * moment the file exists, and a brand new route is exactly when you want this.
 */
function routeFiles(): string[] {
  const listings = [
    execFileSync("git", ["ls-files", "src/app"], { encoding: "utf8" }),
    execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "src/app"],
      {
        encoding: "utf8",
      },
    ),
  ].join("\n");
  return [...new Set(listings.split("\n").map((line) => line.trim()))]
    .filter((line) => line.endsWith("/route.ts"))
    .sort();
}

/**
 * Flatten a handler into the guard/body steps it performs, in order.
 *
 * Local function calls are FOLLOWED, which is the whole reason this is a walk
 * and not a regex: `artifacts/[artifactId]` exports one-line `GET`/`HEAD` that
 * `return handle(request, context)`, and the guard lives in that private
 * `handle`. A check scoped to the exported function's own body reports four of
 * twelve handlers as unguarded — and reports it as a pass.
 *
 * ONE IMPLEMENTATION, TAKING A SOURCE STRING, so the controls below exercise
 * the same classifier the corpus does rather than a second opinion about it.
 */
function analyzeSource(file: string, source: string): Handler[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

  const locals = new Map<string, TS.Node>();
  const record = (name: string, body: TS.Node | undefined): void => {
    if (body) locals.set(name, body);
  };
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      record(statement.name.text, statement.body);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          record(declaration.name.text, init.body);
        }
      }
    }
  }

  const stepsOf = (
    node: TS.Node,
    seen: Set<string>,
    steps: Step[],
    pending: Map<string, Step>,
  ): void => {
    const visit = (child: TS.Node): void => {
      if (ts.isCallExpression(child)) {
        // Arguments evaluate before the call, so descend into them first —
        // otherwise `foo(await request.json())` records the call before the
        // body read it depends on.
        for (const argument of child.arguments) visit(argument);

        const callee = child.expression;
        if (ts.isIdentifier(callee)) {
          const name = callee.text;
          if (GUARDS.has(name)) {
            const first = child.arguments[0];
            const step: Step = {
              kind: "guard",
              what: name,
              ...(first && ts.isStringLiteral(first)
                ? { action: first.text }
                : {}),
            };
            /**
             * A guard step is recorded where its VERDICT BECOMES AVAILABLE,
             * never where the call appears.
             *
             * The first version recorded it at the call and flagged anything
             * not lexically inside an `await` — which reddens
             * `const p = enforceRateLimit(...); const limit = await p;`, a
             * perfectly correct handler. Caught by running the control, not by
             * reading it. The defect being hunted is not "the call is not an
             * await"; it is "the body is read before the verdict exists":
             *
             *   const limit = enforceRateLimit(...);        // no await
             *   const body  = await readJsonBody(request);  // runs FIRST
             *   if (!(await limit).allowed) ...             // too late
             *
             * So: awaited at the call site -> record now. Assigned to a name ->
             * hold it until that name is awaited. Never awaited -> flushed after
             * every other step by the caller, which is exactly where it runs.
             */
            if (ts.isAwaitExpression(child.parent)) {
              steps.push(step);
            } else if (
              ts.isVariableDeclaration(child.parent) &&
              ts.isIdentifier(child.parent.name)
            ) {
              pending.set(child.parent.name.text, step);
            } else {
              steps.push(step);
            }
          } else if (BODY_READS.has(name)) {
            steps.push({ kind: "body", what: name });
          } else {
            const local = locals.get(name);
            if (local && !seen.has(name)) {
              seen.add(name);
              stepsOf(local, seen, steps, pending);
            }
          }
        } else if (ts.isPropertyAccessExpression(callee)) {
          // `request.json()` and friends — only when the receiver looks like
          // the incoming request, so a ZIP entry's `.text()` is not counted.
          const receiver = ts.isIdentifier(callee.expression)
            ? callee.expression.text
            : "";
          if (
            BODY_READS.has(callee.name.text) &&
            /^(request|req|r)$/i.test(receiver)
          ) {
            steps.push({
              kind: "body",
              what: `${receiver}.${callee.name.text}`,
            });
          }
        }
        visit(child.expression);
        return;
      }
      if (
        ts.isAwaitExpression(child) &&
        ts.isIdentifier(child.expression) &&
        pending.has(child.expression.text)
      ) {
        steps.push(pending.get(child.expression.text)!);
        pending.delete(child.expression.text);
      }
      // `for await (const chunk of request.body)` and friends never call a
      // method, so the bare property access counts as consumption too.
      if (
        ts.isPropertyAccessExpression(child) &&
        child.name.text === "body" &&
        ts.isIdentifier(child.expression) &&
        /^(request|req)$/i.test(child.expression.text)
      ) {
        steps.push({ kind: "body", what: `${child.expression.text}.body` });
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  };

  const exported = new Map<string, TS.Node>();
  const hasExportModifier = (statement: TS.Statement): boolean =>
    ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      : false;
  for (const statement of sf.statements) {
    const isExported = hasExportModifier(statement);
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported) {
      if (statement.body) exported.set(statement.name.text, statement.body);
    } else if (ts.isVariableStatement(statement) && isExported) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          exported.set(declaration.name.text, init.body);
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      !statement.moduleSpecifier
    ) {
      // `export { handle as POST }` — the exported NAME is what Next dispatches
      // on, and the body is the local it aliases.
      for (const element of statement.exportClause.elements) {
        const local = locals.get((element.propertyName ?? element.name).text);
        if (local) exported.set(element.name.text, local);
      }
    }
  }

  const handlers: Handler[] = [];
  for (const [method, body] of exported) {
    if (!HTTP_METHODS.has(method)) continue;
    const steps: Step[] = [];
    const pending = new Map<string, Step>();
    stepsOf(body, new Set([method]), steps, pending);
    // A guard whose verdict is never awaited gates nothing, so it is recorded
    // last — after the body read it failed to precede.
    for (const step of pending.values()) steps.push(step);
    handlers.push({ method, steps });
  }
  return handlers;
}

/** The same walk, over a file on disk. */
function analyze(file: string): Handler[] {
  return analyzeSource(file, readFileSync(file, "utf8"));
}

interface Analyzed extends Handler {
  readonly file: string;
}

function analyzeAll(): Analyzed[] {
  return routeFiles().flatMap((file) =>
    analyze(file).map((handler) => ({ file, ...handler })),
  );
}

// ---------------------------------------------------------------------------
// 1. Source order: the guard call precedes the body read
// ---------------------------------------------------------------------------

describe("the abuse guard precedes the body read", () => {
  it("in every route handler that has both", () => {
    const files = routeFiles();

    // BOUND THE CORPUS. An empty listing makes every assertion vacuously true
    // and reports the strongest possible pass.
    expect(
      files.length,
      "the route listing is implausibly small — the corpus, not the code, is what failed",
    ).toBeGreaterThanOrEqual(11);
    expect(
      files.some((file) => !file.startsWith("src/app/api/")),
      "the corpus has narrowed back to src/app/api — the two manifest-icon " +
        "route handlers outside it are invisible again",
    ).toBe(true);

    const analyzed = analyzeAll();
    expect(
      analyzed.length,
      "no exported HTTP handlers were found, so the parser is broken and every route passes",
    ).toBeGreaterThanOrEqual(14);

    // HEALTH CHECKS ON THE CLASSIFIER, not on the code under test. The corpus
    // must contain each shape this reasons about, or the loop asks nothing.
    const guarded = analyzed.filter((h) =>
      h.steps.some((s) => s.kind === "guard"),
    );
    const withBody = analyzed.filter((h) =>
      h.steps.some((s) => s.kind === "body"),
    );
    const both = analyzed.filter(
      (h) =>
        h.steps.some((s) => s.kind === "guard") &&
        h.steps.some((s) => s.kind === "body"),
    );
    expect(
      guarded.length,
      "no handler was seen to call the guard",
    ).toBeGreaterThanOrEqual(8);
    expect(
      withBody.length,
      "no handler was seen to read a body",
    ).toBeGreaterThanOrEqual(4);
    expect(
      both.length,
      "no handler has BOTH a guard and a body read, so the ordering rule is " +
        "vacuous — the classifier has probably stopped recognising one of them",
    ).toBeGreaterThanOrEqual(3);

    // DELEGATION IS FOLLOWED. Without this the two artifacts routes read as
    // unguarded and the guard reports a clean pass over them.
    expect(
      analyzed.filter(
        (h) =>
          h.file.includes("artifacts/") &&
          h.steps.some((s) => s.kind === "guard"),
      ).length,
      "the delegating artifact handlers no longer register a guard — the walk " +
        "has stopped following local calls, and every delegating route is invisible",
    ).toBeGreaterThanOrEqual(4);

    for (const handler of both) {
      expect(
        handler.steps[0]?.kind,
        `${handler.file} ${handler.method} reads the request body before it runs ` +
          `the abuse guard (${handler.steps.map((s) => `${s.kind}:${s.what}`).join(" → ")}). ` +
          "The refusal still returns 429, so nothing visible changes — but the " +
          "parsing the guard exists to avoid has already been paid for.",
      ).toBe("guard");
    }
  });

  it("POSITIVE CONTROL: a body-first handler is reported, in every export form", () => {
    // The check above passes today, and a check nobody has seen fail has not
    // been checked. Each shape the parser claims to understand is exercised
    // here — including the two export forms the tree does not currently use,
    // which would otherwise be untested decoration.
    const cases: [string, string][] = [
      [
        "function declaration",
        `export async function POST(request: Request) {
           const body = await readJsonBody(request);
           await enforceRateLimit("jobs.create", request);
         }`,
      ],
      [
        "delegated",
        `async function handle(request: Request) {
           const body = await request.json();
           await enforceRateLimit("jobs.create", request);
         }
         export function POST(request: Request) { return handle(request); }`,
      ],
      [
        "export const arrow",
        `export const POST = async (request: Request) => {
           await request.formData();
           await enforceRateLimit("jobs.create", request);
         };`,
      ],
      [
        "named re-export",
        `async function handle(request: Request) {
           for await (const chunk of request.body) void chunk;
           await enforceRateLimit("jobs.create", request);
         }
         export { handle as PUT };`,
      ],
    ];
    for (const [name, source] of cases) {
      const handlers = analyzeSource(
        `src/app/__control__/${name}/route.ts`,
        source,
      );
      expect(handlers, `${name}: no handler was parsed`).toHaveLength(1);
      expect(
        handlers[0]!.steps.map((s) => s.kind),
        `${name}: a handler that reads the body first was not reported as body-first`,
      ).toEqual(["body", "guard"]);
    }
  });

  it("POSITIVE CONTROL: a correct handler is reported guard-first", () => {
    // The other direction. A classifier that returned "body" for everything
    // would satisfy the control above and fail the real corpus for the wrong
    // reason — and a red guard nobody can explain gets deleted.
    const handlers = analyzeSource(
      "src/app/__control__/ok/route.ts",
      `export async function POST(request: Request) {
         const limit = await enforceRateLimit("jobs.create", request);
         if (!limit.allowed) return respondRateLimited(limit);
         const body = await readJsonBody(request);
       }`,
    );
    expect(handlers[0]!.steps.map((s) => s.kind)).toEqual(["guard", "body"]);
    expect(handlers[0]!.steps[0]!.action).toBe("jobs.create");
  });
});

// ---------------------------------------------------------------------------
// 2. Behaviour: a real refusal pulls zero bytes
// ---------------------------------------------------------------------------

/**
 * A request body that reports exactly what was taken from it.
 *
 * `highWaterMark: 0` is not a detail. With the default strategy the stream
 * pre-pulls a chunk at `Request` construction — measured `{pulls: 1,
 * bytesOut: 2}` before any handler existed — so the instrument would accuse a
 * correct handler.
 */
function countingBody(payload: string): {
  stream: ReadableStream<Uint8Array>;
  state: { pulls: number; bytesOut: number; cancelled: number };
} {
  const state = { pulls: 0, bytesOut: 0, cancelled: 0 };
  let sent = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls += 1;
        if (sent) {
          controller.close();
          return;
        }
        sent = true;
        const bytes = new TextEncoder().encode(payload);
        state.bytesOut += bytes.byteLength;
        controller.enqueue(bytes);
      },
      cancel() {
        state.cancelled += 1;
      },
    },
    { highWaterMark: 0, size: () => 1 },
  );
  return { stream, state };
}

function probe(url: string, payload: string) {
  const { stream, state } = countingBody(payload);
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    // Absent from the DOM lib types and REQUIRED by undici: without it the
    // constructor throws "duplex option is required when sending a body".
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, state };
}

const PAYLOAD = JSON.stringify({
  tool: "translate-pdf",
  inputs: ["f_probe0001"],
});

/** Route file → module specifier, so the set stays derived rather than typed. */
function specifierFor(file: string): string {
  return `@/${file.replace(/^src\//, "").replace(/\.ts$/, "")}`;
}

describe("a throttled request is refused without a byte being pulled", () => {
  beforeEach(() => {
    resetRateLimitGuardForTests();
    process.env[RATE_LIMIT_ENV.provider] = "local-memory";
  });
  afterEach(() => {
    // BOTH, and this is not belt-and-braces. `vitest.config.ts` runs
    // `isolate: false`, so the limiter singleton and `process.env` are shared
    // with every other file in this worker: a spent hour-long window or a
    // provider left switched on leaks straight into unrelated tests.
    resetRateLimitGuardForTests();
    delete process.env[RATE_LIMIT_ENV.provider];
  });

  it("HEALTH CHECK: the instrument can move, and can stay still", async () => {
    // `bytesOut === 0` is the strongest possible pass and is also what a
    // broken instrument reports. Both directions are proven before it is
    // trusted to say a handler took nothing.
    const consuming = probe("http://localhost/probe", PAYLOAD);
    await new Response(await consuming.request.text()).text();
    expect(consuming.state.bytesOut).toBeGreaterThan(0);
    expect(consuming.request.bodyUsed).toBe(true);

    const inert = probe("http://localhost/probe", PAYLOAD);
    expect(inert.state.bytesOut).toBe(0);
    expect(inert.state.pulls).toBe(0);
    expect(inert.request.bodyUsed).toBe(false);
    // And the fixture must have a real body, or the whole file is vacuous:
    // a null-body Request reads as "not consumed" no matter what a handler does.
    expect(
      inert.request.body,
      "the probe has no body to not-read",
    ).not.toBeNull();
  });

  it("across every guarded body-reading handler the parser found", async () => {
    // The SET IS DERIVED from the source walk above, so a new route that
    // guards and reads a body is covered the day it lands rather than the day
    // someone remembers to add it here.
    /**
     * Keyed on the first GUARD step, never on `steps[0]`.
     *
     * The first draft filtered on `steps[0]?.action !== undefined`, which reads
     * as a harmless way to get the policy name and is a hole: a handler that
     * read the body first would have a BODY step at index 0, no action, and
     * would quietly drop OUT of the subject set. The corpus would shrink by
     * exactly the route that broke, and this test would go green because it
     * had stopped asking about it. Verified by mutation, not by reading.
     */
    const subjects = analyzeAll()
      .map((handler) => ({
        ...handler,
        guard: handler.steps.find((step) => step.kind === "guard"),
      }))
      .filter(
        (handler) =>
          handler.guard?.action !== undefined &&
          handler.steps.some((step) => step.kind === "body"),
      );
    expect(
      subjects.length,
      "no guarded body-reading handler was found, so this test asks nothing",
    ).toBeGreaterThanOrEqual(3);

    for (const subject of subjects) {
      const action = subject.guard!.action as RateLimitAction;
      const limit = policyFor(action).limit;

      // Spend the window. The client token is the constant "shared" while
      // trust-proxy is off, so any Request drains the same bucket.
      const spender = new Request("http://localhost/spend", { method: "POST" });
      for (let i = 0; i < limit; i += 1) {
        await enforceRateLimit(action, spender);
      }

      const routeModule = (await import(specifierFor(subject.file))) as Record<
        string,
        (request: Request, context?: unknown) => Promise<Response>
      >;
      const handler = routeModule[subject.method];
      expect(
        handler,
        `${subject.file} has no ${subject.method} export`,
      ).toBeTypeOf("function");

      const { request, state } = probe(
        `http://localhost/${subject.file}`,
        PAYLOAD,
      );
      const response = await handler!(request, {
        params: Promise.resolve({}),
      });

      expect(
        response.status,
        `${subject.file} ${subject.method} did not refuse after ${limit} calls to ${action}`,
      ).toBe(429);
      expect(
        state.bytesOut,
        `${subject.file} ${subject.method} pulled ${state.bytesOut} bytes of a ` +
          "request it was going to refuse — the parsing the guard exists to avoid " +
          "was paid for anyway",
      ).toBe(0);
      expect(
        state.pulls,
        `${subject.file} signalled demand for the body (bodyUsed=${request.bodyUsed}, cancelled=${state.cancelled})`,
      ).toBe(0);

      // `cancelled` and `bodyUsed` are DIAGNOSTICS in the messages above, and
      // deliberately not assertions. A correct handler that refuses and then
      // calls `request.body.cancel()` for socket hygiene pulls zero bytes while
      // showing `cancelled: 1, bodyUsed: true` — asserting on either would
      // redden a handler that is doing the right thing, and a guard nobody can
      // explain gets deleted. The property is bytes pulled.

      resetRateLimitGuardForTests();
    }
  });
});
