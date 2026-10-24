import { describe, expect, it } from "vitest";
import { PDF_PERMISSIONS } from "./pdf-permission-labels";
import { PDF_PERMISSION_KEYS } from "./pdf-permissions";
import { parseProtectPdfOptions } from "./pdf-security";

describe("the permission words and the permission data are one list", () => {
  it("every key has exactly one label, in the data's order", () => {
    expect(PDF_PERMISSIONS.map((p) => p.key)).toEqual([...PDF_PERMISSION_KEYS]);
    expect(new Set(PDF_PERMISSIONS.map((p) => p.label)).size).toBe(
      PDF_PERMISSIONS.length,
    );
  });

  it("a switch the page calls always allowed is one the validator refuses to turn off — and only those", () => {
    for (const info of PDF_PERMISSIONS) {
      const off = parseProtectPdfOptions({
        password: "open",
        ownerPassword: "owner",
        // Forms is tied to comments, so ask about it with comments off.
        permissions:
          info.key === "fillForms"
            ? { fillForms: false, annotate: false }
            : { [info.key]: false },
      });
      expect(off.ok, info.key).toBe(!info.alwaysAllowed);
    }
  });
});
