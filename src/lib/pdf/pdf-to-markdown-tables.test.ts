import { describe, expect, it } from "vitest";
import { isMarkerList } from "./pdf-to-markdown-tables";

const table = (...rows: string[][]) => ({ rows });

describe("isMarkerList: a list the detector read as two columns", () => {
  it("is a list when the first column holds only markers (and hanging-line blanks)", () => {
    // The shape PR #287's CI caught on the e2e proof's notes.pdf.
    expect(
      isMarkerList(
        table(
          ["•", "First bullet item"],
          ["•", "Second bullet item wraps onto a"],
          ["", "hanging line."],
        ),
      ),
    ).toBe(true);
    for (const markers of [
      ["1.", "2.", "3."],
      ["1)", "2)"],
      ["(a)", "(b)"],
      ["a.", "b."],
      ["i.", "ii.", "iv."],
      ["–", "–"],
      ["-", "*", "+"],
      ["◦", "▪"],
    ]) {
      expect(
        isMarkerList(table(...markers.map((m) => [m, "text"]))),
        markers.join(" "),
      ).toBe(true);
    }
  });

  it("keeps a real table: a first column of words, plain numbers, or mixed cells", () => {
    expect(
      isMarkerList(table(["Ref", "Payee"], ["A-1", "Acme"], ["A-2", "Beta"])),
    ).toBe(false);
    // Rank numbers without a dot or bracket are data, not list markers.
    expect(isMarkerList(table(["1", "Dhaka"], ["2", "Chattogram"]))).toBe(
      false,
    );
    // One marker-looking cell among data does not make a list.
    expect(isMarkerList(table(["•", "x"], ["Total", "9"]))).toBe(false);
    // An empty first column is not a list either (nothing marks an item).
    expect(isMarkerList(table(["", "a"], ["", "b"]))).toBe(false);
  });
});
