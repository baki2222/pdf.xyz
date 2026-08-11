// @vitest-environment node
/**
 * The path rule, EXECUTED against real captured output — never reviewed by
 * reading it.
 *
 * Two consecutive rules shipped here and both deleted real diagnostics. Both
 * were caught by running the function against the binaries' actual output, and
 * neither was caught by reading the regex — including by the person who wrote
 * it. So this file runs every line of `native-diagnostics.corpus.ts` through
 * the real `sanitizeNativeDiagnostics` and reports a verdict per line.
 *
 * The failure message names the line, what happened to it, and what should
 * have: a rule that starts deleting diagnostics again must say WHICH ones.
 */
import { describe, expect, it } from "vitest";
import { sanitizeNativeDiagnostics } from "./native-diagnostics";
import {
  DIAGNOSTIC_CORPUS,
  PATH_BEARING,
  QPDF_STRUCTURAL,
  type CorpusLine,
} from "./native-diagnostics.corpus";

/** Run one captured line through the real sanitizer; did it survive? */
function survives(line: CorpusLine): boolean {
  const out = sanitizeNativeDiagnostics(line.text, []);
  return out.includes(line.text.trim());
}

describe("the whole captured corpus, line by line", () => {
  it("sorts every real line correctly, and names any it does not", () => {
    const wrong = DIAGNOSTIC_CORPUS.filter(
      (line) => survives(line) !== (line.verdict === "show"),
    );

    expect(
      wrong.map(
        (l) =>
          `${l.verdict.toUpperCase()} expected — got the opposite: ${l.text}`,
      ),
      "The path rule mis-sorted real captured output. Every line below is from a " +
        "binary this product runs; a `show` line that was dropped is a diagnostic " +
        "the user needed and did not get, and a `drop` line that survived is a " +
        "filesystem path shown to a stranger.",
    ).toEqual([]);
  });

  it("covers both verdicts, so a rule that always says one cannot pass", () => {
    // A corpus of only-show or only-drop would be satisfied by a constant.
    expect(
      DIAGNOSTIC_CORPUS.filter((l) => l.verdict === "show").length,
    ).toBeGreaterThan(5);
    expect(
      DIAGNOSTIC_CORPUS.filter((l) => l.verdict === "drop").length,
    ).toBeGreaterThan(2);
  });
});

describe("the nine structural qpdf diagnostics", () => {
  // These are the entire domain of repair-pdf: what was wrong with the document
  // and what was reconstructed. Every one begins with, or contains, a PDF name
  // object — and `363f6ab` deleted all nine.
  it.each(QPDF_STRUCTURAL.map((l) => l.text))("shows: %s", (text) => {
    expect(sanitizeNativeDiagnostics(text, [])).toEqual([text]);
  });

  it("shows a message with TWO PDF names in separate tokens", () => {
    // `/Fields key of /AcroForm` — two slashes, two tokens. The separator count
    // is PER TOKEN, which is why this is prose and not a path.
    const text =
      "/Fields key of /AcroForm dictionary is not an array; ignoring";
    expect(sanitizeNativeDiagnostics(text, [])).toEqual([text]);
  });
});

describe("path-bearing lines still fail closed", () => {
  it.each(PATH_BEARING.map((l, i) => [i, l.text] as const))(
    "drops and counts path line %i",
    (_i, text) => {
      expect(sanitizeNativeDiagnostics(text, [])).toEqual([
        "1 further message(s) not shown.",
      ]);
    },
  );

  it("accepts the single-segment absolute path, which is the RULED cost", () => {
    // `/tmp` alone has one separator and survives. Deliberate: our own temp
    // paths are multi-segment and are removed by exact match before this net,
    // so this is a second line of defence, not the only one.
    expect(sanitizeNativeDiagnostics("writing to /tmp now", [])).toEqual([
      "writing to /tmp now",
    ]);
  });
});

describe("the whole chain, worker through persistence", () => {
  it("delivers all nine structural diagnostics to the job record", async () => {
    // THE ASSERTION THAT WAS MISSING, and its absence hid a live defect: the
    // path rule was corrected in the worker and NOT in the persistence
    // boundary, which held a second copy described as deliberate duplication.
    // Measured through the real chain at that point: fed in 9, survived the
    // worker 9, survived persistence 0 — the user saw only
    // "9 further message(s) not shown."
    //
    // Testing each boundary alone could never have caught it. Both passed.
    const { sanitizeJobResults } = await import("@/lib/jobs/results");
    const texts = QPDF_STRUCTURAL.map((l) => l.text);

    const fromWorker = sanitizeNativeDiagnostics(texts.join("\n"), []);
    const persisted =
      sanitizeJobResults({
        repair: { recoveredWithWarnings: true, warnings: fromWorker },
      })?.repair?.warnings ?? [];

    for (const text of texts) {
      expect(
        persisted,
        `"${text}" reached the worker's output but not the job record. The path ` +
          "rule exists in ONE place for exactly this reason — check that " +
          "jobs/tool-notes and workers/native-diagnostics still share it.",
      ).toContain(text);
    }
    expect(persisted.join(" ")).not.toMatch(/further message/);
  });
});

describe("the path rule has exactly one implementation", () => {
  it("is defined in jobs/tool-notes and imported by the worker", async () => {
    // A comment saying duplication is deliberate does not stop it drifting; it
    // drifted within one commit of being written. Defence in depth is kept by
    // both boundaries CALLING this, not by both defining it.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel: string) =>
      fs.readFileSync(path.join(process.cwd(), rel), "utf8");

    const worker = read("src/lib/workers/native-diagnostics.ts");
    expect(
      worker,
      "workers/native-diagnostics.ts must IMPORT looksLikePath, not define it.",
    ).toContain('from "@/lib/jobs/tool-notes"');
    expect(
      worker.includes("function looksLikePath"),
      "workers/native-diagnostics.ts defines a second looksLikePath. The last " +
        "time two copies existed, one was corrected and the other was not, and " +
        "the fix was inert for a commit.",
    ).toBe(false);

    expect(read("src/lib/jobs/tool-notes.ts")).toContain(
      "export function looksLikePath",
    );
  });
});
