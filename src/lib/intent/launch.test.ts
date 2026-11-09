// @vitest-environment node
/**
 * `launchWithFiles`: open a tool with the files already in it, or say that
 * they did not travel. Every surface that offers "Open Merge PDF with 2
 * files" — the workspace's suggestions and batch, the home drop zone, and
 * the ticket, palette and Continue with to come — launches through here.
 *
 * The contract, each part asked of what the RECEIVING page would claim:
 *
 *  - ORDER. The unsaved-work check runs first (a cancelled launch stashes
 *    nothing); then the gate decides what travels; then the stash; then the
 *    navigation; then the measurement — so a navigation is never measured
 *    before it happened, and never happens before the bytes are stored.
 *  - "carried" only when a record a tool can claim exists; "plain" when
 *    nothing could travel (the tool opens empty, honestly); "failed" when
 *    files should have travelled and storage refused them — and then it does
 *    NOT navigate, so the caller can say so instead of opening an empty tool.
 *    `handoffHref`, which this replaced, could only ever say "plain".
 *  - the record carries its ORIGIN (required — the compiler enforces it),
 *    and the trail and pending step when given.
 *  - the TOKEN travels in this tab's sessionStorage, addressed to the page
 *    it opens, and the navigation is to the plain address. INVERTED
 *    2026-10-20: these cases asserted `/tools/merge-pdf?handoff=h_…`, the
 *    address whose payload fetch put the token in the server's logs; they
 *    now hold that the address carries no token and the claim finds it
 *    where the receiving page looks (`takeCarriedHandoff`).
 *  - the launching page's history entry notes where the files went
 *    (`readDeparture`), so Back can say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_TRANSITIONS } from "@/lib/motion/view-transitions";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HANDOFF_MAX_TOTAL_BYTES,
  HandoffStore,
  MemoryHandoffBackend,
  type HandoffBackend,
} from "@/lib/handoff";
import { HANDOFF_CARRY_KEY } from "@/lib/handoff/carry-key";
import { takeCarriedHandoff } from "@/lib/handoff/carry";
import { readDeparture } from "@/lib/handoff/departure";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { handoffPush, launchWithFiles, type LaunchInput } from "./launch";

const pdf = (name: string) =>
  new File([`%PDF ${name}`], name, { type: "application/pdf" });
const docx = new File(["docx"], "letter.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

let pushed: string[];
let events: RedactedEvent[];
const router = { push: (href: string) => void pushed.push(href) };

function launch(input: Omit<LaunchInput, "router">) {
  return launchWithFiles({ ...input, router });
}

async function claimedFrom(href: string) {
  const url = new URL(href, "https://x.test");
  // The address itself carries nothing.
  expect(url.search).toBe("");
  const id = takeCarriedHandoff(url.pathname);
  return id ? claimHandoff(id) : null;
}

/** This tab, as far as a launch can see it: sessionStorage and history. */
let session: Map<string, string>;
let refuseSession = false;
function fakeTab() {
  session = new Map();
  refuseSession = false;
  const history = {
    state: { __NA: true } as unknown,
    replaceState(state: unknown) {
      history.state = state;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (k: string) => session.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (refuseSession) throw new Error("SecurityError");
          session.set(k, v);
        },
        removeItem: (k: string) => void session.delete(k),
      },
      history,
    },
  });
}

beforeEach(() => {
  fakeTab();
  pushed = [];
  events = [];
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
  configureTelemetry((event) => void events.push(event));
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  __setHandoffStoreForTests(null);
  resetTelemetry();
});

describe("carried: the tool opens with the files in it", () => {
  it("a collect tool receives every file it opens, in order, with where they came from", async () => {
    const result = await launch({
      toolSlug: "merge-pdf",
      files: [pdf("a.pdf"), docx, pdf("b.pdf")],
      origin: { kind: "workspace" },
      trail: ["compress-pdf"],
      pending: { toolSlug: "sign-pdf", parkedId: null },
    });
    expect(result).toBe("carried");
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toBe("/tools/merge-pdf");
    const record = await claimedFrom(pushed[0]!);
    expect(record?.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(record?.origin).toEqual({ kind: "workspace" });
    expect(record?.trail).toEqual(["compress-pdf"]);
    expect(record?.pending).toEqual({ toolSlug: "sign-pdf", parkedId: null });
  });

  // The example WAS rotate-pdf until 2026-11-08 (batch plan P1): Rotate now
  // runs a batch over two or more files, and receives them all.
  it("a single-file tool receives the first eligible file", async () => {
    await launch({
      toolSlug: "organize-pages",
      files: [docx, pdf("a.pdf"), pdf("b.pdf")],
      origin: { kind: "drop", surface: "home" },
    });
    const record = await claimedFrom(pushed[0]!);
    expect(record?.files.map((f) => f.name)).toEqual(["a.pdf"]);
    expect(record?.origin).toEqual({ kind: "drop", surface: "home" });
  });

  it("measures the hand-off, then the suggestion — after the navigation", async () => {
    await launch({
      toolSlug: "merge-pdf",
      files: [pdf("a.pdf"), pdf("b.pdf")],
      origin: { kind: "workspace" },
      suggestion: { source: "workspace", rank: 1 },
    });
    expect(events).toEqual([
      {
        name: "workspace_handoff_created",
        toolSlug: "merge-pdf",
        mode: "collect",
        fileCount: "2-5",
      },
      {
        name: "suggestion_opened",
        toolSlug: "merge-pdf",
        source: "workspace",
        rank: "1",
        carried: true,
      },
    ]);
  });

  it("a launch that is not a suggestion (the batch queue) measures only the hand-off", async () => {
    await launch({
      toolSlug: "compress-pdf",
      files: [pdf("a.pdf")],
      origin: { kind: "workspace" },
    });
    expect(events.map((e) => e.name)).toEqual(["workspace_handoff_created"]);
  });

  it("buckets the suggestion's position: 1, 2, 3, then 4+", async () => {
    for (const rank of [2, 3, 4, 9]) {
      await launch({
        toolSlug: "rotate-pdf",
        files: [pdf("a.pdf")],
        origin: { kind: "workspace" },
        suggestion: { source: "workspace", rank },
      });
    }
    expect(
      events.filter((e) => e.name === "suggestion_opened").map((e) => e.rank),
    ).toEqual(["2", "3", "4+", "4+"]);
  });
});

describe("plain: nothing could travel, and the tool opens empty", () => {
  // WAS Word to PDF, "a tool with no in-browser runner": before WP-10 a
  // worker panel took no hand-off. It stages the file now; the tool that
  // still takes none is the URL one.
  it("a tool that takes no file opens plainly and stashes nothing", async () => {
    const result = await launch({
      toolSlug: "webpage-to-pdf",
      files: [docx],
      origin: { kind: "workspace" },
      suggestion: { source: "workspace", rank: 2 },
    });
    expect(result).toBe("plain");
    expect(pushed).toEqual(["/tools/webpage-to-pdf"]);
    expect(events).toEqual([
      {
        name: "suggestion_opened",
        toolSlug: "webpage-to-pdf",
        source: "workspace",
        rank: "2",
        carried: false,
      },
    ]);
  });

  it("no eligible file opens plainly", async () => {
    expect(
      await launch({
        toolSlug: "merge-pdf",
        files: [docx],
        origin: { kind: "workspace" },
      }),
    ).toBe("plain");
    expect(pushed).toEqual(["/tools/merge-pdf"]);
  });
});

describe("failed: the files should have travelled and could not", () => {
  it("a storage failure does NOT navigate, and measures nothing", async () => {
    const broken: HandoffBackend = {
      put: () => Promise.reject(new Error("quota")),
      get: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(),
      getAll: () => Promise.reject(new Error("quota")),
      clear: () => Promise.resolve(),
    };
    __setHandoffStoreForTests(new HandoffStore({ backend: broken }));
    const result = await launch({
      toolSlug: "compress-pdf",
      files: [pdf("a.pdf")],
      origin: { kind: "workspace" },
      suggestion: { source: "workspace", rank: 1 },
    });
    expect(result).toBe("failed");
    expect(pushed).toEqual([]);
    expect(events).toEqual([]);
  });

  it("over the hand-off budget fails rather than opening an empty tool", async () => {
    // INVERTED from `handoffHref`'s "over the hand-off budget opens plainly":
    // that navigated to an empty tool after the visitor asked for their files.
    const huge = {
      name: "huge.pdf",
      type: "application/pdf",
      size: HANDOFF_MAX_TOTAL_BYTES + 1,
    } as File;
    expect(
      await launch({
        toolSlug: "compress-pdf",
        files: [huge],
        origin: { kind: "workspace" },
      }),
    ).toBe("failed");
    expect(pushed).toEqual([]);
  });
});

/*
 * Batch plan P6 review (2026-11-09). P6 made the thirteen worker batches
 * take every eligible file, uncapped — and a set past the hand-off budget
 * then FAILED, where before P6 (stage mode) the first file travelled: four
 * 80 MB PDFs for PDF to Word opened nothing. A worker batch now carries the
 * longest prefix that fits one hand-off; a set whose FIRST file is over the
 * budget still fails, so "failed" is never turned into a silent "plain".
 * The sizes are real `size`s, not tiny fixtures: the defect only exists
 * at hundreds of megabytes.
 */
describe("a worker batch past the hand-off budget carries what fits", () => {
  const MB = 1024 * 1024;
  const sized = (name: string, size: number): File => {
    const file = pdf(name);
    Object.defineProperty(file, "size", { value: size });
    return file;
  };

  it.each(["pdf-to-word", "ocr-pdf", "repair-pdf"])(
    "%s: four 80 MB PDFs carry the first three, in order",
    async (toolSlug) => {
      const files = ["a", "b", "c", "d"].map((n) => sized(`${n}.pdf`, 80 * MB));
      expect(
        await launch({ toolSlug, files, origin: { kind: "workspace" } }),
      ).toBe("carried");
      const record = await claimedFrom(pushed[0]!);
      expect(record?.files.map((f) => f.name)).toEqual([
        "a.pdf",
        "b.pdf",
        "c.pdf",
      ]);
    },
  );

  it("twelve 30 MB PDFs for Repair carry ten (300 MB exactly fits)", async () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      sized(`p${i}.pdf`, 30 * MB),
    );
    expect(
      await launch({
        toolSlug: "repair-pdf",
        files,
        origin: { kind: "workspace" },
      }),
    ).toBe("carried");
    expect((await claimedFrom(pushed[0]!))?.files).toHaveLength(10);
  });

  it("control: a first file over the budget still fails, never 'plain'", async () => {
    expect(
      await launch({
        toolSlug: "repair-pdf",
        files: [sized("huge.pdf", HANDOFF_MAX_TOTAL_BYTES + 1)],
        origin: { kind: "workspace" },
      }),
    ).toBe("failed");
    expect(pushed).toEqual([]);
  });

  it("control: a combine (Merge PDF) is all or nothing — it never merges a subset", async () => {
    const files = ["a", "b", "c", "d"].map((n) => sized(`${n}.pdf`, 80 * MB));
    expect(
      await launch({
        toolSlug: "merge-pdf",
        files,
        origin: { kind: "workspace" },
      }),
    ).toBe("failed");
  });
});

describe("cancelled: the unsaved-work check runs first", () => {
  it("a declined leave stashes nothing, navigates nowhere and measures nothing", async () => {
    const backend = new MemoryHandoffBackend();
    __setHandoffStoreForTests(new HandoffStore({ backend }));
    const result = await launch({
      toolSlug: "merge-pdf",
      files: [pdf("a.pdf"), pdf("b.pdf")],
      origin: { kind: "workspace" },
      suggestion: { source: "workspace", rank: 1 },
      confirmLeave: () => false,
    });
    expect(result).toBe("cancelled");
    expect(await backend.getAll()).toEqual([]);
    expect(pushed).toEqual([]);
    expect(events).toEqual([]);
  });

  it("an accepted leave launches as usual", async () => {
    expect(
      await launch({
        toolSlug: "merge-pdf",
        files: [pdf("a.pdf"), pdf("b.pdf")],
        origin: { kind: "workspace" },
        confirmLeave: () => true,
      }),
    ).toBe("carried");
  });
});

describe("openWorkspaceWithFiles: every file, into the workspace", () => {
  it("stashes all of them for the workspace's own target and opens it", async () => {
    const { openWorkspaceWithFiles } = await import("./launch");
    const result = await openWorkspaceWithFiles({
      files: [pdf("a.pdf"), docx],
      origin: { kind: "drop", surface: "home" },
      router,
    });
    expect(result).toBe("carried");
    expect(pushed[0]).toBe("/workspace");
    const record = await claimedFrom(pushed[0]!);
    expect(record?.toolSlug).toBe("workspace");
    expect(record?.files.map((f) => f.name)).toEqual(["a.pdf", "letter.docx"]);
    expect(record?.origin).toEqual({ kind: "drop", surface: "home" });
  });

  it("a storage failure does not navigate", async () => {
    const { openWorkspaceWithFiles } = await import("./launch");
    __setHandoffStoreForTests(
      new HandoffStore({
        backend: {
          put: () => Promise.reject(new Error("quota")),
          get: () => Promise.resolve(undefined),
          delete: () => Promise.resolve(),
          getAll: () => Promise.reject(new Error("quota")),
          clear: () => Promise.resolve(),
        },
      }),
    );
    expect(
      await openWorkspaceWithFiles({
        files: [pdf("a.pdf")],
        origin: { kind: "drop", surface: "home" },
        router,
      }),
    ).toBe("failed");
    expect(pushed).toEqual([]);
  });
});

describe("the token travels in this tab, not in the address", () => {
  it("is carried to the page it opens, once: the claim takes it, and a second read finds nothing", async () => {
    await launch({
      toolSlug: "rotate-pdf",
      files: [pdf("a.pdf")],
      origin: { kind: "result", fromSlug: "merge-pdf" },
    });
    expect(pushed).toEqual(["/tools/rotate-pdf"]);
    // Positive control: the carried entry exists before the claim.
    expect(session.get(HANDOFF_CARRY_KEY)).toMatch(
      /"path":"\/tools\/rotate-pdf"/,
    );
    // Addressed: another page does not take it.
    expect(takeCarriedHandoff("/tools/merge-pdf")).toBeNull();
    expect(session.has(HANDOFF_CARRY_KEY)).toBe(true);
    const record = await claimedFrom(pushed[0]!);
    expect(record?.files.map((f) => f.name)).toEqual(["a.pdf"]);
    expect(session.has(HANDOFF_CARRY_KEY)).toBe(false);
    expect(takeCarriedHandoff("/tools/rotate-pdf")).toBeNull();
  });

  it("a tab whose storage refuses the carry fails, and does not navigate", async () => {
    refuseSession = true;
    expect(
      await launch({
        toolSlug: "rotate-pdf",
        files: [pdf("a.pdf")],
        origin: { kind: "workspace" },
      }),
    ).toBe("failed");
    expect(pushed).toEqual([]);
    expect(readDeparture()).toBeNull();
  });

  it("the launching entry notes where the files went, keeping the router's own state", async () => {
    expect(readDeparture()).toBeNull();
    await launch({
      toolSlug: "merge-pdf",
      files: [pdf("a.pdf"), pdf("b.pdf")],
      origin: { kind: "result", fromSlug: "split-pdf" },
    });
    expect(readDeparture()).toEqual({ slug: "merge-pdf", count: 2 });
    expect((window.history.state as { __NA?: unknown }).__NA).toBe(true);
  });

  it("CONTROL: a plain launch (nothing travels) carries nothing and notes nothing", async () => {
    await launch({
      toolSlug: "webpage-to-pdf",
      files: [docx],
      origin: { kind: "workspace" },
    });
    expect(session.size).toBe(0);
    expect(readDeparture()).toBeNull();
  });
});

describe("a hand-off's navigation and the view-transition flag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("without the layer, a plain push — one argument, exactly as before", () => {
    vi.stubEnv("PDFXYZ_VIEW_TRANSITIONS", "0");
    const push = vi.fn();
    handoffPush({ push }, "/tools/merge-pdf");
    expect(push.mock.calls).toEqual([["/tools/merge-pdf"]]);
  });

  it("with the layer, the push carries the `handoff` transition type", () => {
    vi.stubEnv("PDFXYZ_VIEW_TRANSITIONS", "1");
    const push = vi.fn();
    handoffPush({ push }, "/workspace");
    expect(push.mock.calls).toEqual([
      ["/workspace", { transitionTypes: ["handoff"] }],
    ]);
  });

  it("reads the flag as the motion module does", () => {
    // The module's reading is taken at load, in this run's environment.
    expect(VIEW_TRANSITIONS).toBe(process.env.PDFXYZ_VIEW_TRANSITIONS === "1");
    const push = vi.fn();
    handoffPush({ push }, "/x");
    expect(push.mock.calls[0]!.length === 2).toBe(VIEW_TRANSITIONS);
  });
});
