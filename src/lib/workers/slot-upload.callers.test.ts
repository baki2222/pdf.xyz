// @vitest-environment node
/**
 * Every browser PUT to a presigned slot goes through `uploadToWorkerSlot`.
 *
 * There were THREE copies of the upload (compression, OCR, and the security /
 * Office runner), each a bare `fetchImpl(slot.url, …)` with no timeout, no
 * retry and a fallback message that hid the status. Fixing one copy would
 * have left two. So this guard does not name the clients: it DISCOVERS them.
 *
 *  - A "slot PUT" is any call whose first argument is `<something>.url` where
 *    `<something>` is named like a slot (`slot`, `renewed.slot`, `slots[0]`).
 *  - A "slot reservation" is any call whose first argument is the literal
 *    `"/api/uploads"` (the endpoint that mints slots).
 *
 * Both must occur in exactly one product file, `slot-upload.ts`. The set of
 * modules that CALL `uploadToWorkerSlot` is printed and bounded below, so a
 * walker gone blind cannot pass on an empty set (`[] ⊆ X`). The detector is
 * run against the pre-fix shape as a positive control.
 */
import type * as TS from "typescript";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const ROOT = resolve(__dirname, "..", "..", "..");
const SHARED = "src/lib/workers/slot-upload.ts";

function productFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => !/\.(test|spec)\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".d.ts"))
    .filter((f) => !f.startsWith("src/tests/"));
}

function parse(file: string, source: string): TS.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The text of the expression a `.url` is read from, e.g. `slot`, `session.slots[0]`. */
function isSlotUrl(node: TS.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "url" &&
    /slot/i.test(node.expression.getText())
  );
}

interface Findings {
  slotPuts: number;
  reservations: number;
  callsShared: boolean;
}

function scan(file: string, source: string): Findings {
  const sf = parse(file, source);
  const out: Findings = { slotPuts: 0, reservations: 0, callsShared: false };
  const walk = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      if (first && isSlotUrl(first)) out.slotPuts += 1;
      if (
        first &&
        ts.isStringLiteralLike(first) &&
        first.text === "/api/uploads"
      )
        out.reservations += 1;
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "uploadToWorkerSlot"
      )
        out.callsShared = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

const FILES = productFiles();
const SCANNED = FILES.map((file) => ({
  file,
  ...scan(file, readFileSync(resolve(ROOT, file), "utf8")),
}));

describe("the instruments", () => {
  it("the corpus is plausibly sized", () => {
    expect(
      FILES.length,
      "git ls-files found implausibly few files",
    ).toBeGreaterThan(300);
    expect(FILES).toContain(SHARED);
  });

  it("positive control: the detector sees the pre-fix copy", () => {
    const before = [
      `async function run() {`,
      `  const sessionRes = await fetchImpl("/api/uploads", { method: "POST" });`,
      `  const slot = session.slots[0];`,
      `  const uploadRes = await fetchImpl(slot.url, { method: slot.method });`,
      `  await fetch(session.slots[0].url, {});`,
      `  await fetchImpl(artifact.url);`,
      `}`,
    ].join("\n");
    expect(scan("fixture.ts", before)).toEqual({
      slotPuts: 2,
      reservations: 1,
      callsShared: false,
    });
  });
});

describe("one upload path", () => {
  it("only slot-upload.ts PUTs to a slot URL", () => {
    const putters = SCANNED.filter((s) => s.slotPuts > 0).map((s) => s.file);
    expect(putters).toEqual([SHARED]);
  });

  it("only slot-upload.ts reserves a slot (so a renewal cannot be bypassed)", () => {
    const reservers = SCANNED.filter((s) => s.reservations > 0).map(
      (s) => s.file,
    );
    expect(reservers).toEqual([SHARED]);
  });

  it("the worker job clients call it — printed, and not implausibly few", () => {
    const callers = SCANNED.filter((s) => s.callsShared && s.file !== SHARED)
      .map((s) => s.file)
      .sort();
    // Three clients carried their own copy before this guard: compression,
    // OCR, and the security/Office runner. A walker that finds fewer is
    // blind, not finished.
    expect(callers.length, callers.join("\n")).toBeGreaterThanOrEqual(3);
    expect(callers).toEqual(
      expect.arrayContaining([
        "src/lib/workers/client.ts",
        "src/lib/workers/ocr-client.ts",
        "src/lib/workers/pdf-security-client.ts",
      ]),
    );
  });
});
