// @vitest-environment jsdom
// @native-canvas
/**
 * Protect PDF's and Unlock PDF's batch (batch plan P4), through the page's
 * own panel (`PdfSecurityWorkerPanel`), real Files on its file input, and
 * the network the real job client meets (`stubJobNetwork`).
 *
 * What is held here, each with a control that sees it fail:
 *   - the same validated options in every job body (one password, one
 *     strength, one set of permissions);
 *   - the local look before an upload: Unlock leaves out a PDF that is not
 *     locked, Protect one already encrypted — no PUT, no job;
 *   - "Try another password" reruns only the failed rows, with the new one;
 *   - the passwords never reach storage, telemetry, an error, the rendered
 *     text, or React state — and once the batch ends, not even a ref
 *     (`secretsHeldByReact` walks the fiber tree for them).
 */
import { InToolPage } from "@/tests/in-tool-page";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { getToolBySlug } from "@/lib/tools";
import { RECENTS_STORAGE_KEY, readRecents } from "@/lib/intent/recents";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { enterToolPage } from "@/lib/telemetry/tool-outcome";
import { resetAnnouncer } from "@/components/a11y/live-region";
import { resetUnsavedForTests } from "@/lib/intent/unsaved";
import { canRunPdfSecurity } from "@/lib/workers/pdf-security-client";
import {
  OWNER_PASSWORD_REQUIRED_MESSAGE,
  UNREADABLE_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from "@/lib/workers/pdf-security/engine";
import {
  PROTECT_NEEDS_PASSWORD_REASON,
  PROTECT_RESTRICTED_REASON,
  SECURITY_RETRY_NOTE,
  securityBatchPageSentence,
  UNLOCK_NOT_LOCKED_REASON,
  unlockRetryHeading,
} from "@/lib/batch/security-copy";
import {
  OWNER_ONLY_PDF_BASE64,
  USER_PASSWORD_PDF_BASE64,
} from "@/tests/fixtures-encrypted";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import {
  stubJobNetwork,
  type StubbedJobOutcome,
} from "@/tests/stub-job-network";
import { PdfSecurityWorkerPanel } from "../../pdf-security-worker-panel";
import { NO_PASSWORD_FROZEN } from "./security-batch";
import { WORKER_BATCH_PAUSED } from "@/lib/batch/worker-copy";
import { BATCH_VIEW_LOADED } from "./batch-view";

const FIRST = "Fz-first-7Q2w";
const SECOND = "Fz-second-8R3e";
const OWNER = "Fz-owner-9T4r";

let events: RedactedEvent[] = [];
let leave: () => void = () => {};
let storageWrites: { key: string; value: string }[] = [];
let consoleText: string[] = [];
const originalSetItem = Storage.prototype.setItem;

beforeEach(() => {
  events = [];
  storageWrites = [];
  consoleText = [];
  configureTelemetry((e) => events.push(e));
  Storage.prototype.setItem = function (key: string, value: string) {
    storageWrites.push({ key, value });
    return originalSetItem.call(this, key, value);
  };
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleText.push(args.map((a) => String(a)).join(" "));
    });
});

afterEach(() => {
  cleanup();
  leave();
  resetTelemetry();
  resetAnnouncer();
  resetUnsavedForTests();
  Storage.prototype.setItem = originalSetItem;
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function plainPdf(name: string): Promise<File> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return new File([(await doc.save()) as BlobPart], `${name}.pdf`, {
    type: "application/pdf",
  });
}

function base64Pdf(base64: string, name: string): File {
  return new File([Buffer.from(base64, "base64")], `${name}.pdf`, {
    type: "application/pdf",
  });
}

function completed(n: number): StubbedJobOutcome {
  return {
    status: "completed",
    artifact: {
      artifact: {
        artifactId: `art_${n}`,
        filename: `out-${n}.pdf`,
        contentType: "application/pdf",
        bytes: 8,
        url: `/__art/${n}`,
        expiresAt: new Date(0).toISOString(),
      },
      bytes: new TextEncoder().encode("%PDF-out"),
    },
  };
}

/** A file named .pdf whose bytes pdf.js cannot open: "unreadable". */
function notAPdf(name: string): File {
  return new File(["%PDF-1.7 not really a pdf %%EOF"], `${name}.pdf`, {
    type: "application/pdf",
  });
}

const ownerPasswordRequired: StubbedJobOutcome = {
  status: "failed",
  error: {
    code: "unprocessable_entity",
    message: OWNER_PASSWORD_REQUIRED_MESSAGE,
    retryable: false,
  },
};

const unreadable: StubbedJobOutcome = {
  status: "failed",
  error: {
    code: "unprocessable_entity",
    message: UNREADABLE_MESSAGE,
    retryable: false,
  },
};

/**
 * Wraps the stubbed network: `handle` sees each request first and either
 * answers it or passes it on. `count(url)` is how many requests reached it.
 */
function wrapFetch(
  handle: (
    url: string,
    method: string,
    pass: () => Promise<Response>,
  ) => Promise<Response>,
) {
  const inner = globalThis.fetch;
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      return handle(url, init?.method ?? "GET", () => inner(input, init));
    }),
  );
  return { count: (url: string) => seen.filter((u) => u === url).length };
}

const wrongPassword: StubbedJobOutcome = {
  status: "failed",
  error: {
    code: "unprocessable_entity",
    message: WRONG_PASSWORD_MESSAGE,
    retryable: false,
  },
};

async function drop(slug: "protect-pdf" | "unlock-pdf", files: File[]) {
  expect(canRunPdfSecurity(READY_WORKER_STATUS)).toBe(true);
  const tool = getToolBySlug(slug)!;
  leave = enterToolPage({ toolSlug: slug, capability: "secure-worker" });
  const view = render(
    <InToolPage tool={tool}>
      <PdfSecurityWorkerPanel tool={tool} />
    </InToolPage>,
  );
  const input = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(el).not.toBeNull();
    return el!;
  });
  fireEvent.change(input, { target: { files } });
  await waitFor(() =>
    expect(
      view.container.querySelector(`[data-chunk="${BATCH_VIEW_LOADED}"]`),
    ).not.toBeNull(),
  );
  return view;
}

function type(label: string, value: string, within: ParentNode = document) {
  const input = [...within.querySelectorAll<HTMLInputElement>("input")].find(
    (el) => el.labels?.[0]?.textContent === label,
  );
  if (!input) throw new Error(`no field labelled ${label}`);
  fireEvent.change(input, { target: { value } });
}

async function pressWhenReady(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  fireEvent.click(button);
}

/**
 * Every string React holds for this tree that contains `secret`: each
 * fiber's props, and each hook's state — `useState`/`useReducer` (a hook
 * with an update queue) always; a ref (`{ current }`, no queue) only when
 * `includeRefs`. Never a DOM node: an uncontrolled input's value is the
 * browser's, not React's.
 */
function secretsHeldByReact(
  container: HTMLElement,
  secret: string,
  { includeRefs }: { includeRefs: boolean },
): string[] {
  const host = container.firstElementChild ?? container;
  const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
  if (!key) throw new Error("no React fiber on the container");
  let root = (host as unknown as Record<string, unknown>)[key] as Fiber;
  while (root.return) root = root.return;
  const found: string[] = [];
  const seen = new WeakSet<object>();
  const scan = (value: unknown, where: string, depth: number) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.includes(secret)) found.push(where);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (typeof Node !== "undefined" && value instanceof Node) return;
    if ("$$typeof" in value) return; // a React element: its own fiber is walked
    for (const [k, v] of Object.entries(value))
      if (!k.startsWith("_") && k !== "return" && k !== "stateNode")
        scan(v, `${where}.${k}`, depth + 1);
  };
  let fibers = 0;
  const walk = (fiber: Fiber | null) => {
    for (let f = fiber; f; f = f.sibling) {
      fibers += 1;
      const name =
        typeof f.type === "function"
          ? (f.type as { name?: string }).name
          : String(f.type);
      scan(f.memoizedProps, `${name}.props`, 0);
      if (typeof f.type === "function") {
        let hook = f.memoizedState as Hook | null;
        let i = 0;
        while (hook && typeof hook === "object" && "next" in hook) {
          const isState = hook.queue !== null && hook.queue !== undefined;
          const isRef =
            !isState &&
            hook.memoizedState !== null &&
            typeof hook.memoizedState === "object" &&
            "current" in (hook.memoizedState as object) &&
            Object.keys(hook.memoizedState as object).length === 1;
          if (isState || (isRef && includeRefs))
            scan(hook.memoizedState, `${name}.hook${i}`, 0);
          hook = hook.next;
          i += 1;
        }
      }
      walk(f.child);
    }
  };
  walk(root);
  // Health: the walk saw a real tree, not an empty one.
  expect(fibers).toBeGreaterThan(50);
  return found;
}

interface Fiber {
  type: unknown;
  memoizedProps: unknown;
  memoizedState: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
}
interface Hook {
  memoizedState: unknown;
  queue: unknown;
  next: Hook | null;
}

/**
 * Storage after a batch: sessionStorage empty, and localStorage holding
 * nothing but the product's recent-tools list (`recordCompletion`, written
 * for any finished run of any tool: a slug and a time). That one entry is
 * also the control that this read sees writes at all.
 */
function expectStorageUntouched(slug: string) {
  expect(Object.keys(sessionStorage)).toEqual([]);
  expect(Object.keys(localStorage)).toEqual([RECENTS_STORAGE_KEY]);
  expect(readRecents().map((r) => r.slug)).toEqual([slug]);
  expect(
    [...new Set(storageWrites.map((w) => w.key))],
    "a write other than the recent-tools list",
  ).toEqual([RECENTS_STORAGE_KEY]);
}

/** Everything a password must never reach, as text. */
function leaks(container: HTMLElement, secret: string): string[] {
  const where: string[] = [];
  if (container.textContent?.includes(secret)) where.push("rendered text");
  if (JSON.stringify(events).includes(secret)) where.push("telemetry");
  if (storageWrites.some((w) => `${w.key}${w.value}`.includes(secret)))
    where.push("storage");
  if (consoleText.some((t) => t.includes(secret))) where.push("console");
  if (window.location.href.includes(encodeURIComponent(secret)))
    where.push("URL");
  for (const el of container.querySelectorAll("[role=alert], .text-warn"))
    if (el.textContent?.includes(secret)) where.push("an error");
  return where;
}

describe("Unlock PDF's batch (batch plan P4)", () => {
  it("one password for every file, a not-locked file left out unsent, and Try another password reruns only the failed row", async () => {
    let jobs = 0;
    // File A opens with FIRST, file B with SECOND; jobs run A then B.
    const net = stubJobNetwork(READY_WORKER_STATUS, (body) => {
      jobs += 1;
      const password = (body.options as { password?: string }).password;
      if (jobs === 1) return password === FIRST ? completed(1) : wrongPassword;
      return password === SECOND ? completed(jobs) : wrongPassword;
    });
    const view = await drop("unlock-pdf", [
      await plainPdf("plain"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "statement-a"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "statement-b"),
    ]);
    // Run waits for the password.
    const run = await screen.findByRole("button", { name: "Unlock 3 PDFs" });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(view.container.textContent).toContain(
      "Type the password that opens these PDFs first.",
    );
    type("Current password", FIRST);
    // Typed, and held in a ref only: no React state carries it.
    expect(
      secretsHeldByReact(view.container, FIRST, { includeRefs: false }),
    ).toEqual([]);
    // Control: the walk can see the ref that does hold it.
    expect(
      secretsHeldByReact(view.container, FIRST, { includeRefs: true }).length,
    ).toBeGreaterThan(0);
    await pressWhenReady("Unlock 3 PDFs");
    await screen.findByText(
      "Batch complete. 1 done, 1 failed, 1 skipped.",
      undefined,
      { timeout: 10_000 },
    );
    // The not-locked file never left: two uploads, two jobs.
    expect(view.container.textContent).toContain(UNLOCK_NOT_LOCKED_REASON);
    expect(net.uploads()).toBe(2);
    expect(net.jobBodies).toHaveLength(2);
    // The same validated options in every job body.
    for (const body of net.jobBodies) {
      expect(body.tool).toBe("unlock-pdf");
      expect(body.inputs).toHaveLength(1);
      expect(body.options).toEqual({ password: FIRST });
    }
    // The failed row says the processor's own sentence.
    expect(view.container.textContent).toContain(WRONG_PASSWORD_MESSAGE);
    // The batch ended: the page holds the password nowhere, refs included.
    await waitFor(() =>
      expect(
        secretsHeldByReact(view.container, FIRST, { includeRefs: true }),
      ).toEqual([]),
    );
    expect(leaks(view.container, FIRST)).toEqual([]);

    // Try another password, for the failed row only.
    const retry = view.container.querySelector("[data-security-retry]")!;
    expect(retry.textContent).toContain(unlockRetryHeading(1));
    expect(retry.textContent).toContain(SECURITY_RETRY_NOTE);
    // No plain "Retry failed": it would send no password at all.
    expect(screen.queryByRole("button", { name: /^Retry failed/ })).toBeNull();
    const tryIt = screen.getByRole("button", { name: "Try it on 1 PDF" });
    expect(tryIt).toHaveAttribute("aria-disabled", "true");
    type("Another password", SECOND, retry);
    fireEvent.click(tryIt);
    await screen.findByText(
      "Batch complete. 2 done, 0 failed, 1 skipped.",
      undefined,
      { timeout: 10_000 },
    );
    // Only the failed file ran again, with the new password.
    expect(net.jobBodies).toHaveLength(3);
    expect(net.uploads()).toBe(3);
    expect(net.jobBodies[2]!.options).toEqual({ password: SECOND });
    // The row that worked kept its output: two downloads.
    expect(
      screen.getByRole("button", { name: "Download out-1.pdf" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download out-3.pdf" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download all (2)" }),
    ).toBeTruthy();
    // One telemetry outcome per file sent, the skipped one none.
    expect(
      events
        .map((e) => e.name)
        .filter((n) => n === "tool_completed" || n === "tool_failed"),
    ).toEqual(["tool_completed", "tool_failed", "tool_completed"]);
    // Nothing of the batch stored, anywhere, and no password in any of it.
    expectStorageUntouched("unlock-pdf");
    for (const secret of [FIRST, SECOND]) {
      expect(leaks(view.container, secret), secret).toEqual([]);
      expect(
        secretsHeldByReact(view.container, secret, { includeRefs: true }),
        secret,
      ).toEqual([]);
    }
  });

  it("a restricted file and an unreadable one are sent with the frozen password: Unlock skips only a file that is not locked", async () => {
    // Jobs run in drop order: restricted, unreadable, locked. The restricted
    // file opens with no password; only its owner password lifts the
    // restrictions, and the worker says so when it is not given it.
    let jobs = 0;
    const net = stubJobNetwork(READY_WORKER_STATUS, (body) => {
      jobs += 1;
      const password = (body.options as { password?: string }).password;
      if (jobs === 1) return ownerPasswordRequired;
      if (jobs === 2) return unreadable;
      if (jobs === 3) return password === FIRST ? completed(3) : wrongPassword;
      // The retry: the restricted file, now with its owner password; the
      // damaged one stays unreadable whatever the password.
      if (jobs === 4)
        return password === OWNER ? completed(4) : ownerPasswordRequired;
      return unreadable;
    });
    const view = await drop("unlock-pdf", [
      base64Pdf(OWNER_ONLY_PDF_BASE64, "restricted"),
      notAPdf("damaged"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "locked"),
    ]);
    type("Current password", FIRST);
    await pressWhenReady("Unlock 3 PDFs");
    await screen.findByText("Batch complete. 1 done, 2 failed.", undefined, {
      timeout: 10_000,
    });
    // None was left out: all three uploaded, each with the frozen password.
    expect(view.container.textContent).not.toContain(UNLOCK_NOT_LOCKED_REASON);
    expect(net.uploads()).toBe(3);
    expect(net.jobBodies).toHaveLength(3);
    for (const body of net.jobBodies) {
      expect(body.tool).toBe("unlock-pdf");
      expect(body.options).toEqual({ password: FIRST });
    }
    // Each failed row says the processor's own sentence.
    expect(view.container.textContent).toContain(
      OWNER_PASSWORD_REQUIRED_MESSAGE,
    );
    expect(view.container.textContent).toContain(UNREADABLE_MESSAGE);
    // The owner password, typed as another password, lifts the restrictions.
    const retry = view.container.querySelector("[data-security-retry]")!;
    expect(retry.textContent).toContain(unlockRetryHeading(2));
    type("Another password", OWNER, retry);
    fireEvent.click(screen.getByRole("button", { name: "Try it on 2 PDFs" }));
    await screen.findByText("Batch complete. 2 done, 1 failed.", undefined, {
      timeout: 10_000,
    });
    expect(net.jobBodies).toHaveLength(5);
    expect(net.jobBodies[3]!.options).toEqual({ password: OWNER });
    expect(net.jobBodies[4]!.options).toEqual({ password: OWNER });
    expect(
      screen.getByRole("button", { name: "Download out-4.pdf" }),
    ).toBeTruthy();
    for (const secret of [FIRST, OWNER])
      expect(leaks(view.container, secret), secret).toEqual([]);
  }, 20_000);

  it("a rate-limit pause keeps the frozen password: the resumed file is sent with it, and the end forgets it", async () => {
    const net = stubJobNetwork(READY_WORKER_STATUS, () =>
      completed(net.jobBodies.length),
    );
    let reservations = 0;
    const served = wrapFetch(async (url, method, pass) => {
      if (url === "/api/uploads" && method === "POST") {
        reservations += 1;
        if (reservations === 2)
          return new Response(
            JSON.stringify({
              error: { code: "rate_limited", message: "Too many." },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "Retry-After": "1",
              },
            },
          );
      }
      return pass();
    });
    const view = await drop("unlock-pdf", [
      base64Pdf(USER_PASSWORD_PDF_BASE64, "a"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "b"),
    ]);
    type("Current password", FIRST);
    await pressWhenReady("Unlock 2 PDFs");
    await screen.findByText(WORKER_BATCH_PAUSED, undefined, {
      timeout: 10_000,
    });
    // Paused, not ended: the frozen password is still held (in a ref only).
    expect(
      secretsHeldByReact(view.container, FIRST, { includeRefs: true }).length,
    ).toBeGreaterThan(0);
    expect(
      secretsHeldByReact(view.container, FIRST, { includeRefs: false }),
    ).toEqual([]);
    await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
      timeout: 10_000,
    });
    // The refused reservation was asked for again; both jobs carry it.
    expect(served.count("/api/uploads")).toBe(3);
    expect(net.jobBodies.map((b) => b.options)).toEqual([
      { password: FIRST },
      { password: FIRST },
    ]);
    expect(view.container.textContent).not.toContain(NO_PASSWORD_FROZEN);
    await waitFor(() =>
      expect(
        secretsHeldByReact(view.container, FIRST, { includeRefs: true }),
      ).toEqual([]),
    );
    expect(leaks(view.container, FIRST)).toEqual([]);
  }, 20_000);

  it("Cancel forgets the frozen password at once, and the queued file is never sent", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const net = stubJobNetwork(READY_WORKER_STATUS, () => completed(1));
    wrapFetch(async (url, method, pass) => {
      if (url.startsWith("/api/uploads/local/") && method === "PUT") await held;
      return pass();
    });
    const view = await drop("unlock-pdf", [
      base64Pdf(USER_PASSWORD_PDF_BASE64, "a"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "b"),
    ]);
    type("Current password", FIRST);
    await pressWhenReady("Unlock 2 PDFs");
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    // Control: while the first file uploads, the password is held.
    await waitFor(() =>
      expect(
        secretsHeldByReact(view.container, FIRST, { includeRefs: true }).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(cancel);
    await screen.findByText("Batch canceled.");
    // Canceled is an end: no ref holds it, even with a file still in flight.
    await waitFor(() =>
      expect(
        secretsHeldByReact(view.container, FIRST, { includeRefs: true }),
      ).toEqual([]),
    );
    release();
    await waitFor(() => expect(net.uploads()).toBe(1));
    // The queued second file never left the browser.
    await new Promise((r) => setTimeout(r, 200));
    expect(net.uploads()).toBe(1);
    expect(net.jobBodies.length).toBeLessThanOrEqual(1);
    expect(leaks(view.container, FIRST)).toEqual([]);
  }, 20_000);

  it("Run again asks for the password again: the page kept none", async () => {
    stubJobNetwork(READY_WORKER_STATUS, () => completed(1));
    const view = await drop("unlock-pdf", [
      base64Pdf(USER_PASSWORD_PDF_BASE64, "a"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "b"),
    ]);
    type("Current password", FIRST);
    await pressWhenReady("Unlock 2 PDFs");
    await screen.findByText("Batch complete. 2 done, 0 failed.", undefined, {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    const run = await screen.findByRole("button", { name: "Unlock 2 PDFs" });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(view.container.textContent).toContain(
      "Type the password that opens these PDFs first.",
    );
    expect(
      secretsHeldByReact(view.container, FIRST, { includeRefs: true }),
    ).toEqual([]);
  });

  it("a password typed for one file does not follow the files into a batch", async () => {
    stubJobNetwork(READY_WORKER_STATUS, () => completed(1));
    const tool = getToolBySlug("unlock-pdf")!;
    leave = enterToolPage({
      toolSlug: "unlock-pdf",
      capability: "secure-worker",
    });
    const view = render(
      <InToolPage tool={tool}>
        <PdfSecurityWorkerPanel tool={tool} />
      </InToolPage>,
    );
    type("Current password", FIRST);
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          base64Pdf(USER_PASSWORD_PDF_BASE64, "a"),
          base64Pdf(USER_PASSWORD_PDF_BASE64, "b"),
        ],
      },
    });
    await screen.findByRole("button", { name: "Unlock 2 PDFs" });
    expect(
      secretsHeldByReact(view.container, FIRST, { includeRefs: true }),
    ).toEqual([]);
  });
});

describe("Protect PDF's batch (batch plan P4)", () => {
  it("an encrypted input is refused before any upload, and every job carries the same password, strength and permissions", async () => {
    const net = stubJobNetwork(READY_WORKER_STATUS, () =>
      completed(net.jobBodies.length),
    );
    const view = await drop("protect-pdf", [
      await plainPdf("one"),
      base64Pdf(OWNER_ONLY_PDF_BASE64, "restricted"),
      base64Pdf(USER_PASSWORD_PDF_BASE64, "locked"),
      await plainPdf("two"),
    ]);
    type("New password", FIRST);
    type("Confirm password", FIRST);
    // One permission off: the owner password is asked for, once.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Printing/ }));
    const run = await screen.findByRole("button", { name: "Protect 4 PDFs" });
    expect(run).toHaveAttribute("aria-disabled", "true");
    type("Owner password", OWNER);
    type("Confirm owner password", OWNER);
    expect(
      secretsHeldByReact(view.container, OWNER, { includeRefs: false }),
    ).toEqual([]);
    await pressWhenReady("Protect 4 PDFs");
    await screen.findByText(
      "Batch complete. 2 done, 0 failed, 2 skipped.",
      undefined,
      { timeout: 10_000 },
    );
    expect(view.container.textContent).toContain(PROTECT_RESTRICTED_REASON);
    expect(view.container.textContent).toContain(PROTECT_NEEDS_PASSWORD_REASON);
    // Neither encrypted file left the browser.
    expect(net.uploads()).toBe(2);
    expect(net.jobBodies).toHaveLength(2);
    const [first, second] = net.jobBodies as { options: unknown }[];
    expect(first!.options).toEqual(second!.options);
    expect(first!.options).toMatchObject({
      password: FIRST,
      ownerPassword: OWNER,
      permissions: { print: false },
    });
    expectStorageUntouched("protect-pdf");
    for (const secret of [FIRST, OWNER]) {
      expect(leaks(view.container, secret), secret).toEqual([]);
      expect(
        secretsHeldByReact(view.container, secret, { includeRefs: true }),
        secret,
      ).toEqual([]);
    }
  });

  it("a file the browser cannot read is not refused locally on Protect: it goes to the server, which says what is wrong", async () => {
    // The page says only a file "this browser can tell is already encrypted"
    // is left out; this is the file it cannot tell about.
    let jobs = 0;
    const net = stubJobNetwork(READY_WORKER_STATUS, () => {
      jobs += 1;
      return jobs === 1 ? unreadable : completed(jobs);
    });
    const view = await drop("protect-pdf", [
      notAPdf("damaged"),
      await plainPdf("plain"),
    ]);
    expect(securityBatchPageSentence("protect-pdf")).toContain(
      "A file this browser can tell is already encrypted is left out, unsent",
    );
    type("New password", FIRST);
    type("Confirm password", FIRST);
    await pressWhenReady("Protect 2 PDFs");
    await screen.findByText("Batch complete. 1 done, 1 failed.", undefined, {
      timeout: 10_000,
    });
    expect(net.uploads()).toBe(2);
    expect(view.container.textContent).toContain(UNREADABLE_MESSAGE);
    expect(view.container.textContent).not.toContain(PROTECT_RESTRICTED_REASON);
    expect(view.container.textContent).not.toContain(
      PROTECT_NEEDS_PASSWORD_REASON,
    );
  }, 20_000);

  it("Protect's Run waits for the confirmation, as the single-file panel does", async () => {
    stubJobNetwork(READY_WORKER_STATUS, () => completed(1));
    const view = await drop("protect-pdf", [
      await plainPdf("one"),
      await plainPdf("two"),
    ]);
    type("New password", FIRST);
    const run = await screen.findByRole("button", { name: "Protect 2 PDFs" });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(view.container.textContent).toContain(
      "Type the new password again in Confirm password.",
    );
    type("Confirm password", FIRST);
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
  });
});
