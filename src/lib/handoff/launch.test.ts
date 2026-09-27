// @vitest-environment node
/**
 * `handoffPayload` / `handoffHref`: the one gate every "open this tool with my
 * files" button goes through (the workspace's launch button and the homepage
 * drop zone). Each case is asked of what the tool page would CLAIM, not of the
 * helper's return value alone: a URL with a `?handoff=` id is worth nothing
 * unless claiming that id gives back the right files.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HANDOFF_MAX_TOTAL_BYTES,
  handoffHref,
  handoffPayload,
  HandoffStore,
  MemoryHandoffBackend,
  readHandoffId,
  type HandoffBackend,
} from "./index";

const pdf = (name: string) =>
  new File([`%PDF ${name}`], name, { type: "application/pdf" });
const docx = new File(["docx"], "letter.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

async function claimedNames(href: string): Promise<string[] | null> {
  const id = readHandoffId(new URL(href, "https://x.test").search);
  if (!id) return null;
  const record = await claimHandoff(id);
  return record?.files.map((f) => f.name) ?? [];
}

beforeEach(() => {
  __setHandoffStoreForTests(
    new HandoffStore({ backend: new MemoryHandoffBackend() }),
  );
});
afterEach(() => __setHandoffStoreForTests(null));

describe("what a hand-off carries", () => {
  it("a collect tool gets every file its runner opens, in order, and nothing else", async () => {
    const files = [pdf("a.pdf"), docx, pdf("b.pdf")];
    expect(handoffPayload("merge-pdf", files).map((f) => f.name)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
    const href = await handoffHref("merge-pdf", files);
    expect(href).toMatch(/^\/tools\/merge-pdf\?handoff=/);
    expect(await claimedNames(href)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("a single-file tool gets the first eligible file only", async () => {
    const href = await handoffHref("rotate-pdf", [
      docx,
      pdf("a.pdf"),
      pdf("b.pdf"),
    ]);
    expect(await claimedNames(href)).toEqual(["a.pdf"]);
  });

  it("a tool with no runner opens plainly, and nothing is stashed", async () => {
    expect(handoffPayload("word-to-pdf", [docx])).toEqual([]);
    expect(await handoffHref("word-to-pdf", [docx])).toBe("/tools/word-to-pdf");
  });

  it("no eligible file opens plainly", async () => {
    expect(await handoffHref("merge-pdf", [docx])).toBe("/tools/merge-pdf");
  });

  it("over the hand-off budget opens plainly", async () => {
    const huge = {
      name: "huge.pdf",
      type: "application/pdf",
      size: HANDOFF_MAX_TOTAL_BYTES + 1,
    } as File;
    expect(await handoffHref("compress-pdf", [huge])).toBe(
      "/tools/compress-pdf",
    );
  });

  it("a storage failure opens plainly and does not throw", async () => {
    const broken: HandoffBackend = {
      put: () => Promise.reject(new Error("quota")),
      get: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(),
      getAll: () => Promise.reject(new Error("quota")),
      clear: () => Promise.resolve(),
    };
    __setHandoffStoreForTests(new HandoffStore({ backend: broken }));
    expect(await handoffHref("compress-pdf", [pdf("a.pdf")])).toBe(
      "/tools/compress-pdf",
    );
  });
});
