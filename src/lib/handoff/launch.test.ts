// @vitest-environment node
/**
 * `handoffPayload` / `stashHandoff`: the one gate every "open this tool with
 * my files" control goes through. Each case is asked of what the tool page
 * would CLAIM, not of the helper's return value alone: an id is worth nothing
 * unless claiming it gives back the right files, from the right place.
 *
 * HISTORY. These cases were written against `handoffHref`, which turned a
 * stash failure into the plain tool URL — so a launch could never report that
 * the files did not travel, and the caller navigated as if they had. It was
 * retired on 2026-10-09 for `launchWithFiles` (`src/lib/intent/launch.ts`),
 * built on this gate, which returns "failed" instead; the navigation cases
 * moved to `src/lib/intent/launch.test.ts`. What a hand-off CARRIES is still
 * this file's question.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setHandoffStoreForTests,
  claimHandoff,
  HANDOFF_MAX_TOTAL_BYTES,
  handoffEntriesToFiles,
  handoffPayload,
  HandoffStore,
  MemoryHandoffBackend,
  stashHandoff,
  type HandoffBackend,
  type HandoffFileEntry,
} from "./index";

const pdf = (name: string) =>
  new File([`%PDF ${name}`], name, { type: "application/pdf" });
const docx = new File(["docx"], "letter.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});
const FROM_WORKSPACE = { origin: { kind: "workspace" } } as const;

async function claimedNames(id: string | null): Promise<string[] | null> {
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
    const payload = handoffPayload("merge-pdf", files);
    expect(payload.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(
      await claimedNames(
        await stashHandoff("merge-pdf", payload, FROM_WORKSPACE),
      ),
    ).toEqual(["a.pdf", "b.pdf"]);
  });

  it("a single-file tool gets the first eligible file only", () => {
    expect(
      handoffPayload("rotate-pdf", [docx, pdf("a.pdf"), pdf("b.pdf")]).map(
        (f) => f.name,
      ),
    ).toEqual(["a.pdf"]);
  });

  // WAS "a tool with no runner … carries nothing", with Word to PDF as the
  // tool: before WP-10 a worker panel took no hand-off. It stages one now —
  // the file waits in the panel and uploads on Run — so it carries the one
  // file; a tool that takes no file (webpage-to-pdf) still carries nothing.
  it("a tool that takes no file, or no eligible file, carries nothing", () => {
    expect(handoffPayload("webpage-to-pdf", [docx])).toEqual([]);
    expect(handoffPayload("merge-pdf", [docx])).toEqual([]);
  });

  it("a worker panel stages exactly one eligible file", () => {
    expect(handoffPayload("word-to-pdf", [docx, docx])).toEqual([docx]);
  });

  it("over the hand-off budget, nothing is stashed", async () => {
    const huge = {
      name: "huge.pdf",
      type: "application/pdf",
      size: HANDOFF_MAX_TOTAL_BYTES + 1,
    } as File;
    expect(await stashHandoff("compress-pdf", [huge], FROM_WORKSPACE)).toBe(
      null,
    );
  });

  it("a storage failure stashes nothing and does not throw", async () => {
    const broken: HandoffBackend = {
      put: () => Promise.reject(new Error("quota")),
      get: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(),
      getAll: () => Promise.reject(new Error("quota")),
      clear: () => Promise.resolve(),
    };
    __setHandoffStoreForTests(new HandoffStore({ backend: broken }));
    expect(
      await stashHandoff("compress-pdf", [pdf("a.pdf")], FROM_WORKSPACE),
    ).toBeNull();
  });

  it("the record remembers where the files came from", async () => {
    const id = await stashHandoff("merge-pdf", [pdf("a.pdf")], {
      origin: { kind: "drop", surface: "home" },
    });
    expect((await claimHandoff(id!))?.origin).toEqual({
      kind: "drop",
      surface: "home",
    });
  });
});

/**
 * `handoffEntriesToFiles` used to give every entry with an empty type the
 * type `application/pdf` — so a `.docx` the browser did not label reached the
 * tool claiming to be a PDF (addendum WP-04 #73). The type now comes from the
 * name through the table the server validates uploads with, or stays empty.
 */
describe("a claimed file's type is its own, never an invented PDF", () => {
  const entry = (name: string, type: string): HandoffFileEntry => ({
    name,
    size: 4,
    type,
    blob: new Blob(["data"]),
  });

  it("keeps a declared type", () => {
    expect(
      handoffEntriesToFiles([entry("a.pdf", "application/pdf")])[0]!.type,
    ).toBe("application/pdf");
  });

  it("derives a missing type from the name, through the server's own table", () => {
    const [docxFile, pngFile, pdfFile] = handoffEntriesToFiles([
      entry("letter.docx", ""),
      entry("photo.png", ""),
      entry("scan.pdf", ""),
    ]);
    expect(docxFile!.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(pngFile!.type).toBe("image/png");
    expect(pdfFile!.type).toBe("application/pdf");
  });

  it("control: a name the table does not know gets no type, not a PDF's", () => {
    expect(handoffEntriesToFiles([entry("notes.weird", "")])[0]!.type).toBe("");
  });
});
