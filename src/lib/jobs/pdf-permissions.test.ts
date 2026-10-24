import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS_ALLOWED } from "./pdf-permissions";
import { parseProtectPdfOptions } from "./pdf-security";

const field = (r: ReturnType<typeof parseProtectPdfOptions>) =>
  r.ok ? null : (r.error.body.error.details?.[0]?.field ?? null);

describe("parseProtectPdfOptions — permissions", () => {
  it("defaults to every permission allowed (today's behaviour)", () => {
    const r = parseProtectPdfOptions({ password: "open" });
    expect(r.ok && r.value.permissions).toEqual(ALL_PERMISSIONS_ALLOWED);
    expect(r.ok && r.value.ownerPassword).toBe("open");
  });

  it("accepts restrictions with a distinct owner password, filling the rest as allowed", () => {
    const r = parseProtectPdfOptions({
      password: "open",
      ownerPassword: "owner",
      permissions: { print: false, copy: false },
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.permissions).toEqual({
        ...ALL_PERMISSIONS_ALLOWED,
        print: false,
        copy: false,
      });
  });

  it("refuses a restriction with no owner password: the open password would lift it", () => {
    const r = parseProtectPdfOptions({
      password: "open",
      permissions: { print: false },
    });
    expect(field(r)).toBe("options.ownerPassword");
  });

  it("refuses a restriction whose owner password equals the open password", () => {
    const r = parseProtectPdfOptions({
      password: "same",
      ownerPassword: "same",
      permissions: { modify: false },
    });
    expect(field(r)).toBe("options.ownerPassword");
    // The message describes the rule, never the value.
    if (!r.ok) expect(r.error.body.error.message).not.toContain("same");
  });

  it("refuses switching off accessibility, which AES encryption cannot apply", () => {
    const r = parseProtectPdfOptions({
      password: "open",
      ownerPassword: "owner",
      permissions: { accessibility: false },
    });
    expect(field(r)).toBe("options.permissions.accessibility");
  });

  it("refuses forms off while comments are on — the format's annotate bit grants form filling", () => {
    const r = parseProtectPdfOptions({
      password: "open",
      ownerPassword: "owner",
      permissions: { fillForms: false },
    });
    expect(field(r)).toBe("options.permissions.fillForms");
    // Control: with comments off too, it is a real restriction.
    expect(
      parseProtectPdfOptions({
        password: "open",
        ownerPassword: "owner",
        permissions: { fillForms: false, annotate: false },
      }).ok,
    ).toBe(true);
  });

  it("refuses unknown keys, non-boolean values, and a non-object", () => {
    const base = { password: "open", ownerPassword: "owner" };
    expect(
      field(parseProtectPdfOptions({ ...base, permissions: { fax: false } })),
    ).toBe("options.permissions");
    expect(
      field(parseProtectPdfOptions({ ...base, permissions: { print: "no" } })),
    ).toBe("options.permissions.print");
    expect(field(parseProtectPdfOptions({ ...base, permissions: [] }))).toBe(
      "options.permissions",
    );
  });

  it("an all-allowed permissions object is the default, and needs no owner password", () => {
    const r = parseProtectPdfOptions({
      password: "open",
      permissions: { ...ALL_PERMISSIONS_ALLOWED },
    });
    expect(r.ok && r.value.permissions).toEqual(ALL_PERMISSIONS_ALLOWED);
  });
});
