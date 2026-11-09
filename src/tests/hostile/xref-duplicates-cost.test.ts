/**
 * The duplicate-object guard (src/lib/pdf/xref-duplicates.ts) must cost no
 * more than a constant factor of pdf-lib's own load, on any file. Each case
 * runs in a child process (./bounded.ts): pdf-lib parses synchronously, so an
 * in-process blow-up would block vitest and no timeout could fire.
 *
 * The bound is RELATIVE: the child times pdf-lib's own `PDFDocument.load` of
 * the same bytes (work every engine pays anyway) and then `loadPdf` (that load
 * plus the guard). A relative bound survives a slow or loaded runner; the wall
 * clock kill only turns a true hang into a red result.
 *
 * Found by review on 2026-11-08, each red on the first version of the guard:
 *  - objstm-twins: every object-stream member with a top-level "twin" header
 *    decoded the whole stream again (members x stream size). Measured before
 *    the fix: N=8000 took 8.8 s against pdf-lib's own 1.2 s.
 *  - w000: the guard read the xref of any file carrying the bytes `/ObjStm`,
 *    and an xref stream with /W [0 0 0] made the reader loop over its whole
 *    /Index count. Measured before: 3.2 s and +1.5 GB for a 1 KB file that
 *    pdf-lib loads in 2 ms.
 *  - xref-bomb: the same reader inflates a whole xref stream, whatever its
 *    rows need; pdf-lib never decodes a stream without /Type /XRef, so a
 *    256 KB deflate of zeros cost the guard alone 256 MiB.
 *  - nested: first headers inside one another's strings, the xref naming them,
 *    so every re-parse ran to the end of the nest (objects x file size).
 *  - hidden-objstms (residual review, 2026-11-09): `openObjStm` reads only /N
 *    and /First, so a stream WITHOUT /Type /ObjStm, which pdf-lib's load never
 *    decodes, was inflated whole by the guard. Each one fed ParseBudget more
 *    allowance than it cost, so K of them at 256 MiB each cost K x 256 MiB of
 *    inflate on the main thread, uncharged.
 */
import { describe, expect, it } from "vitest";
import { runBounded } from "./bounded";

const CHILD = "src/tests/hostile/xref-duplicates-cost.child.ts";

interface Cost {
  outcome: string;
  kb: number;
  baseMs: number;
  ms: number;
  rssMb: number;
}

async function cost(args: string[]): Promise<Cost> {
  const r = await runBounded(CHILD, args, 60_000);
  expect(r.kind, JSON.stringify(r)).toBe("settled");
  return (r as { value: Cost }).value;
}

/**
 * The guard's own budget: 3x pdf-lib's load, plus 500 ms of fixed slack
 * (module loading, the xref read on a small file, a busy runner). Before the
 * fixes these cases ran at 7x (objstm-twins 8000), 1600x (w000) and 6x
 * (nested 1500); after, all three sit at or under pdf-lib's own load time.
 */
const within = (c: Cost) => c.ms <= 3 * c.baseMs + 500;

describe("the duplicate-object guard costs a constant factor of pdf-lib's load", () => {
  it("hidden-objstms: object streams pdf-lib never decoded are inflated to one load's total, then refused", async () => {
    // 12 x 64 MiB = 768 MiB of member data behind type-2 entries, 3x the
    // 256 MiB pdf-lib allows one load for every object stream it decodes.
    const c = await cost(["hidden-objstms", "12", "64"]);
    expect(c.outcome).toMatch(/^error:PdfEngineError:/);
    expect(c.rssMb).toBeLessThan(400);
  }, 120_000);

  it("hidden-objstms control: two such streams of 16 MiB are opened and the file loads", async () => {
    const c = await cost(["hidden-objstms", "2", "16"]);
    expect(c.outcome).toBe("pages:1");
  }, 120_000);

  it("objstm-twins: members with top-level twins decode their stream once", async () => {
    const c = await cost(["objstm-twins", "8000"]);
    expect(c.outcome).toBe("pages:1");
    expect({ ...c, within: within(c) }).toMatchObject({ within: true });
  }, 90_000);

  it("w000: an xref stream with zero-width rows is not walked over its /Index", async () => {
    const c = await cost(["w000"]);
    expect(c.outcome).toBe("pages:1");
    expect({ ...c, within: within(c) }).toMatchObject({ within: true });
    // A second, independent bound: memory. Before the fix, +1.5 GB.
    expect(c.rssMb).toBeLessThan(200);
  }, 90_000);

  it("xref-bomb: an xref stream is decoded no further than its rows need", async () => {
    const c = await cost(["xref-bomb"]);
    expect(c.outcome).toBe("pages:1");
    expect({ ...c, within: within(c) }).toMatchObject({ within: true });
    // 256 MiB would be inflated without the cap.
    expect(c.rssMb).toBeLessThan(200);
  }, 90_000);

  it("nested: bodies that overlap are refused, not re-parsed to the end each time", async () => {
    const c = await cost(["nested", "3000"]);
    // Overlapping bodies cannot come from a real writer (the bodies of
    // distinct objects never share bytes), and following that xref would
    // re-parse the file once per object: the file is refused, in the loader's
    // words for a file it cannot read.
    expect(c.outcome).toMatch(
      /^error:PdfEngineError:This file couldn't be read/,
    );
    expect({ ...c, within: within(c) }).toMatchObject({ within: true });
  }, 90_000);
});
