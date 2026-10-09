// @vitest-environment node
/**
 * A dropped file's facts: what its name says at once, then what its bytes and
 * — for a PDF — the probe say, one file at a time.
 *
 * The rule the ranking depends on: the NAME (then the declared type) decides
 * which tools take a file, because that is what the hand-off gate and every
 * tool's picker go by; the bytes only ever take a file AWAY (a "report.pdf"
 * that is really a PNG opens nowhere under that name). Measuring is bounded:
 * at most `maxProbes` PDFs are probed, none above the in-browser ceiling,
 * sequentially, and it stops when asked to.
 */
import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { imageOnlyPdf, PNG_1PX, textPdf } from "@/tests/pdf-text-fixtures";
import { measureFacts, quickFacts, type FileFacts } from "./facts";

const meta = (name: string, size: number, type = "") => ({ name, size, type });

async function measured(
  files: { name: string; type?: string; bytes: Uint8Array; size?: number }[],
  options?: Parameters<typeof measureFacts>[3],
) {
  const blobs = new Map<string, Blob>();
  const facts = files.map((f, i) => {
    const id = `f${i}`;
    blobs.set(id, new Blob([f.bytes]));
    return quickFacts(meta(f.name, f.size ?? f.bytes.byteLength, f.type), id);
  });
  const updates: FileFacts[] = [];
  const final = await measureFacts(
    facts,
    (id) => blobs.get(id),
    (next) => void updates.push(next),
    options,
  );
  return { facts, final, updates };
}

describe("quickFacts: what the name says, before a byte is read", () => {
  it("reads the format by extension, then by declared type", () => {
    expect(quickFacts(meta("a.pdf", 10), "1")).toMatchObject({
      format: "PDF",
      bytes: undefined,
      contradicted: false,
      pdf: { state: "pending" },
    });
    expect(quickFacts(meta("scan", 10, "application/pdf"), "2").format).toBe(
      "PDF",
    );
    expect(quickFacts(meta("photo.heic", 10), "3")).toMatchObject({
      format: "HEIC",
      pdf: null,
    });
    expect(quickFacts(meta("notes.weird", 10), "4").format).toBeNull();
  });
});

describe("measureFacts: the bytes, then the probe", () => {
  it("confirms a PDF and probes it", async () => {
    const { final } = await measured([
      { name: "a.pdf", bytes: await textPdf([100]) },
    ]);
    expect(final[0]).toMatchObject({
      format: "PDF",
      bytes: "PDF",
      contradicted: false,
    });
    expect(final[0]!.pdf).toMatchObject({
      state: "checked",
      probe: { read: "ok", pages: 1, sample: ["text"] },
    });
  });

  it("a PDF whose bytes are a PNG is contradicted, and never probed", async () => {
    const { final } = await measured([{ name: "report.pdf", bytes: PNG_1PX }]);
    expect(final[0]).toMatchObject({
      format: "PDF",
      bytes: "PNG",
      contradicted: true,
      pdf: null,
    });
  });

  it("probes at most maxProbes PDFs; the rest say they were not checked", async () => {
    const pdf = await imageOnlyPdf(1);
    const { final } = await measured(
      [
        { name: "a.pdf", bytes: pdf },
        { name: "b.pdf", bytes: pdf },
        { name: "c.pdf", bytes: pdf },
      ],
      { maxProbes: 2 },
    );
    expect(final.map((f) => f.pdf?.state)).toEqual([
      "checked",
      "checked",
      "not-checked",
    ]);
    expect(final[2]!.pdf).toEqual({ state: "not-checked", reason: "limit" });
  });

  it("never parses a PDF above the in-browser ceiling", async () => {
    const { final } = await measured([
      { name: "huge.pdf", bytes: await textPdf([10]), size: MAX_PDF_BYTES + 1 },
    ]);
    expect(final[0]!.pdf).toEqual({
      state: "not-checked",
      reason: "too-large",
    });
  });

  it("measures one file after another, in the order given", async () => {
    const { updates } = await measured([
      { name: "a.pdf", bytes: await textPdf([10]) },
      { name: "b.png", bytes: PNG_1PX },
      { name: "c.pdf", bytes: await textPdf([10]) },
    ]);
    const firstSeen = [...new Set(updates.map((u) => u.id))];
    expect(firstSeen).toEqual(["f0", "f1", "f2"]);
    // The last word on each file is its final facts.
    const lastFor = (id: string) => updates.filter((u) => u.id === id).at(-1);
    expect(lastFor("f0")!.pdf?.state).toBe("checked");
    expect(lastFor("f1")!.bytes).toBe("PNG");
  });

  it("stops when asked to", async () => {
    const controller = new AbortController();
    const blobs = new Map<string, Blob>();
    const facts = ["a.pdf", "b.pdf"].map((name, i) => {
      blobs.set(`f${i}`, new Blob([PNG_1PX]));
      return quickFacts(meta(name, PNG_1PX.byteLength), `f${i}`);
    });
    const seen: string[] = [];
    await measureFacts(
      facts,
      (id) => blobs.get(id),
      (next) => {
        seen.push(next.id);
        controller.abort();
      },
      { signal: controller.signal },
    );
    expect(new Set(seen)).toEqual(new Set(["f0"]));
  });
});
