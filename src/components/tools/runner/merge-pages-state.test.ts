import { describe, expect, it } from "vitest";
import { mergeAlternating } from "@/lib/pdf/merge-alternate";
import { parsePageList } from "@/lib/pdf/ranges";
import type { Rotation } from "@/lib/pdf/types";
import {
  applyRanges,
  arrangementBeyondFiles,
  canLeaveOut,
  fileOrderOf,
  fileSeedOf,
  filesInterleave,
  keptPages,
  mergePayload,
  moveKeyTo,
  rangeTextOf,
  regroup,
  resumePages,
  rotateKey,
  samePages,
  seedPages,
  setFileKept,
  setKeptKey,
  syncFiles,
  type MergePage,
  type PageFile,
} from "./merge-pages-state";

/**
 * Arrange pages' one page list. The typed Pages box and the grid are both
 * functions of it; these hold the round trip (G3), the hand-over to and from
 * file mode, and the payload the engine gets.
 */

const file = (
  id: string,
  count: number,
  turned: Rotation[] = [],
): PageFile => ({
  id,
  rotations: Array.from({ length: count }, (_, i) => turned[i] ?? 0),
});

const keys = (pages: readonly MergePage[]) => pages.map((p) => p.key);
const keptKeys = (pages: readonly MergePage[]) => keys(keptPages(pages));

/** A small deterministic shuffle, so the interleaved list is the same each run. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
  const out = list.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("Arrange pages: the Pages box and the grid are one list (G3)", () => {
  it("every non-empty page set of a 7-page file round-trips through the box, without moving or turning anything", () => {
    const files = [file("a", 7), file("b", 4), file("c", 3)];
    const base = shuffled(seedPages(files, "append"), 7).map((p, i) =>
      i % 3 === 0 ? { ...p, rotation: 90 as Rotation } : p,
    );
    // Health: the list really interleaves, so order is not trivially kept.
    expect(filesInterleave(base)).toBe(true);
    let ran = 0;
    for (let mask = 1; mask < 1 << 7; mask += 1) {
      const set = [0, 1, 2, 3, 4, 5, 6].filter((i) => mask & (1 << i));
      const next = setFileKept(base, "a", set);
      const text = rangeTextOf(next, "a");
      const back = text === "" ? [0, 1, 2, 3, 4, 5, 6] : parsePageList(text, 7);
      expect(back, `mask ${mask}: "${text}"`).toEqual(set);
      expect(text === "", `mask ${mask}`).toBe(set.length === 7);
      expect(keys(next)).toEqual(keys(base));
      expect(next.map((p) => p.rotation)).toEqual(base.map((p) => p.rotation));
      // Other files are untouched.
      expect(next.filter((p) => p.fileId !== "a")).toEqual(
        base.filter((p) => p.fileId !== "a"),
      );
      ran += 1;
    }
    expect(ran).toBe(127);
  });

  it("an empty box means every page; a set that keeps none is refused", () => {
    const base = setFileKept(seedPages([file("a", 3)], "append"), "a", [1]);
    expect(keptKeys(setFileKept(base, "a", undefined))).toEqual([
      "a:0",
      "a:1",
      "a:2",
    ]);
    expect(setFileKept(base, "a", [])).toEqual(base);
  });

  it("a file keeps at least one page; with two kept it CAN drop one (control)", () => {
    const one = setFileKept(seedPages([file("a", 2)], "append"), "a", [0]);
    expect(canLeaveOut(one, "a:0")).toBe(false);
    expect(setKeptKey(one, "a:0", false)).toEqual(one);
    const two = seedPages([file("a", 2)], "append");
    expect(canLeaveOut(two, "a:0")).toBe(true);
    expect(keptKeys(setKeptKey(two, "a:0", false))).toEqual(["a:1"]);
  });
});

describe("Arrange pages: the seed is what the mode it came from merges", () => {
  it("from One after another: file after file, the selection kept, the rest in place", () => {
    const pages = seedPages([file("a", 3), file("b", 2)], "append", [[0, 2]]);
    expect(keys(pages)).toEqual(["a:0", "a:1", "a:2", "b:0", "b:1"]);
    expect(keptKeys(pages)).toEqual(["a:0", "a:2", "b:0", "b:1"]);
    expect(arrangementBeyondFiles(pages)).toBe(false);
  });

  it("from Alternate pages: mergeAlternating's own order, through its own bytes", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const make = async (widths: number[]) => {
      const d = await PDFDocument.create();
      for (const w of widths) d.addPage([w, 100]);
      return d.save();
    };
    const a = await make([11, 12, 13, 14]);
    const b = await make([21, 22]);
    const pages = seedPages(
      [file("a", 4), file("b", 2)],
      "alternate",
      [[0, 1, 3], undefined],
      [false, true],
    );
    const width = (p: MergePage) => (p.fileId === "a" ? 11 : 21) + p.pageIndex;
    const out = await PDFDocument.load(
      await mergeAlternating([a, b], {
        pages: [[0, 1, 3], undefined],
        reverse: [false, true],
      }),
    );
    expect(keptPages(pages).map(width)).toEqual(
      out.getPages().map((p) => p.getSize().width),
    );
    // The left-out page follows, and the files read in list order.
    expect(pages.at(-1)!.key).toBe("a:2");
    expect(fileOrderOf(pages)).toEqual(["a", "b"]);
  });
});

describe("Arrange pages: handing over to file mode and back", () => {
  const files = [file("a", 3), file("b", 2)];
  const arranged = rotateKey(
    setKeptKey(moveKeyTo(seedPages(files, "append"), "b:0", 0), "a:1", false),
    "a:2",
    90,
  );

  it("nothing changed in file mode: coming back is the identity", () => {
    const back = applyRanges(syncFiles(arranged, files), files, [
      parsePageList(rangeTextOf(arranged, "a") || "1-3", 3),
      undefined,
    ]);
    expect(samePages(back, arranged)).toBe(true);
  });

  it("a removed file's pages go; a new file is appended, kept, upright", () => {
    const next = syncFiles(arranged, [files[0]!, file("c", 2, [180, 0])]);
    expect(keys(next)).toEqual(["a:0", "a:1", "a:2", "c:0", "c:1"]);
    expect(next.slice(-2).map((p) => [p.kept, p.rotation, p.source])).toEqual([
      [true, 180, 180],
      [true, 0, 0],
    ]);
    expect(next.find((p) => p.key === "a:2")!.rotation).toBe(90);
  });

  it("a range changed in file mode is applied in place", () => {
    const next = applyRanges(arranged, files, [undefined, [1]]);
    expect(keys(next)).toEqual(keys(arranged));
    expect(keptKeys(next)).toEqual(["a:0", "a:1", "a:2", "b:1"]);
  });

  it("arrangementBeyondFiles: true for a turn, a mix or a file out of page order; false for a plain seed", () => {
    expect(arrangementBeyondFiles(seedPages(files, "append"))).toBe(false);
    expect(
      arrangementBeyondFiles(rotateKey(seedPages(files, "append"), "a:0", 90)),
    ).toBe(true);
    expect(
      arrangementBeyondFiles(moveKeyTo(seedPages(files, "append"), "b:0", 0)),
    ).toBe(true);
    expect(
      arrangementBeyondFiles(moveKeyTo(seedPages(files, "append"), "a:2", 0)),
    ).toBe(true);
    // A left-out page between another file's pages changes nothing merged.
    const parked = setKeptKey(
      moveKeyTo(seedPages(files, "append"), "a:2", 4),
      "a:2",
      false,
    );
    expect(arrangementBeyondFiles(parked)).toBe(false);
  });
});

describe("Arrange pages: what the engine is given", () => {
  it("files in first-appearance order, and a rotation only where a page was turned", () => {
    const files = [file("a", 2, [0, 270]), file("b", 1)];
    const pages = rotateKey(
      moveKeyTo(seedPages(files, "append"), "b:0", 0),
      "a:1",
      90,
    );
    expect(mergePayload(pages)).toEqual({
      fileIds: ["b", "a"],
      order: [
        { file: 0, page: 0 },
        { file: 1, page: 0 },
        { file: 1, page: 1, rotation: 0 },
      ],
    });
  });

  it("regroup puts each file's pages together, keeping their order, turns and flags", () => {
    const files = [file("a", 2), file("b", 2)];
    const mixed = setKeptKey(
      rotateKey(moveKeyTo(seedPages(files, "append"), "b:1", 0), "b:1", 90),
      "a:0",
      false,
    );
    const grouped = regroup(mixed, ["b", "a"]);
    expect(keys(grouped)).toEqual(["b:1", "b:0", "a:0", "a:1"]);
    expect(filesInterleave(grouped)).toBe(false);
    expect(grouped[0]!.rotation).toBe(90);
    expect(grouped[2]!.kept).toBe(false);
  });
});

describe("resumePages: Arrange pages chosen again", () => {
  const a = file("a", 3);
  const b = file("b", 2);
  const keys = (list: MergePage[]) => list.map((p) => p.key);

  it("a stash file mode could say in full is reseeded from the mode left", () => {
    const stash = seedPages([a, b], "append");
    expect(arrangementBeyondFiles(stash)).toBe(false);
    // The files were reordered in between: b leads.
    expect(keys(resumePages(stash, [b, a], "append", [], []))).toEqual([
      "b:0",
      "b:1",
      "a:0",
      "a:1",
      "a:2",
    ]);
    // Alternate pages was the mode left: its seed, not the stash.
    expect(keys(resumePages(stash, [a, b], "alternate", [], []))).toEqual(
      keys(seedPages([a, b], "alternate")),
    );
  });

  it("a stash with a turn is kept, in the file order chosen meanwhile", () => {
    const stash = rotateKey(seedPages([a, b], "append"), "a:1", 90);
    const back = resumePages(stash, [b, a], "append", [], []);
    expect(keys(back)).toEqual(["b:0", "b:1", "a:0", "a:1", "a:2"]);
    expect(back.find((p) => p.key === "a:1")?.rotation).toBe(90);
  });

  it("a stash that mixes files is kept as it is", () => {
    const stash = moveKeyTo(seedPages([a, b], "append"), "b:0", 0);
    expect(keys(resumePages(stash, [a, b], "append", [], []))).toEqual(
      keys(stash),
    );
  });
});

describe("fileSeedOf: Reset to file order", () => {
  it("orders files by their first kept pages and keeps each file's chosen pages", () => {
    const a = file("a", 3);
    const b = file("b", 2);
    const list = setKeptKey(
      moveKeyTo(seedPages([a, b], "append"), "b:1", 0),
      "a:2",
      false,
    );
    const seed = fileSeedOf(list, [a, b]);
    expect(seed.map((p) => `${p.key}${p.kept ? "" : "-"}`)).toEqual([
      "b:0",
      "b:1",
      "a:0",
      "a:1",
      "a:2-",
    ]);
  });
});
