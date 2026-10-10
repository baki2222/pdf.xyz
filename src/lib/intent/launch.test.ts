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
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HANDOFF_MAX_TOTAL_BYTES,
  HandoffStore,
  MemoryHandoffBackend,
  readHandoffId,
  type HandoffBackend,
} from "@/lib/handoff";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { launchWithFiles, type LaunchInput } from "./launch";

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
  const id = readHandoffId(new URL(href, "https://x.test").search);
  return id ? claimHandoff(id) : null;
}

beforeEach(() => {
  pushed = [];
  events = [];
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
  configureTelemetry((event) => void events.push(event));
});
afterEach(() => {
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
    expect(pushed[0]).toMatch(/^\/tools\/merge-pdf\?handoff=h_/);
    const record = await claimedFrom(pushed[0]!);
    expect(record?.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(record?.origin).toEqual({ kind: "workspace" });
    expect(record?.trail).toEqual(["compress-pdf"]);
    expect(record?.pending).toEqual({ toolSlug: "sign-pdf", parkedId: null });
  });

  it("a single-file tool receives the first eligible file", async () => {
    await launch({
      toolSlug: "rotate-pdf",
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
  it("a tool with no in-browser runner opens plainly and stashes nothing", async () => {
    const result = await launch({
      toolSlug: "word-to-pdf",
      files: [docx],
      origin: { kind: "workspace" },
      suggestion: { source: "workspace", rank: 2 },
    });
    expect(result).toBe("plain");
    expect(pushed).toEqual(["/tools/word-to-pdf"]);
    expect(events).toEqual([
      {
        name: "suggestion_opened",
        toolSlug: "word-to-pdf",
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
    expect(pushed[0]).toMatch(/^\/workspace\?handoff=h_/);
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
