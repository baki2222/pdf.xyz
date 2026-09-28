// @vitest-environment jsdom
/**
 * The password field while a run is busy: read-only, never disabled.
 *
 * A natively disabled input cannot hold focus, so a caret still sitting in the
 * field at t=0 (click Run in a browser that does not focus buttons on click,
 * and the caret never left) would be thrown to `<body>` for the whole run —
 * the #46 trigger defect, on an input. `readOnly` keeps the field focusable
 * and its value visible while refusing edits, and the reveal toggle keeps
 * working: showing your own password mid-run changes nothing about the job.
 *
 * These import `PasswordField` directly (exported for exactly this test), so
 * they cannot fail on pre-fix `main` — the export did not exist there. The
 * behavioural fails-on-main proof for this change lives in the ChipButton
 * cases (`runner-kit.a11y.test.tsx`) and the source guard
 * (`run-trigger-focus.test.ts`), both of which ran red on the unmodified tree.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { tools } from "@/lib/tools/catalog";
import { buildWorkerStatus } from "@/lib/workers/status";
import {
  runProtect,
  runUnlock,
  type QpdfRunner,
} from "@/lib/workers/pdf-security/engine";
import {
  PasswordField,
  PdfSecurityWorkerPanel,
  isPasswordMissing,
} from "./pdf-security-worker-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderField(busy: boolean, onChange = vi.fn()) {
  render(
    <PasswordField
      id="pw"
      label="Current password"
      value="hunter2"
      onChange={onChange}
      busy={busy}
      autoComplete="new-password"
    />,
  );
  return { input: screen.getByLabelText("Current password"), onChange };
}

describe("PasswordField while the run is busy", () => {
  it("keeps focus and the value while refusing edits (readOnly, never disabled)", () => {
    // The edit refusal itself is the browser's contract for `readonly` — jsdom
    // cannot model it (fireEvent.change force-sets the value straight past the
    // attribute), so the honest jsdom claims are the attribute and the focus.
    const { input } = renderField(true);
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue("hunter2");
    input.focus();
    expect(input).toHaveFocus();
  });

  it("keeps the reveal toggle functional mid-run", () => {
    const { input } = renderField(true);
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toBeInTheDocument();
  });

  it("edits normally when idle", () => {
    const { input, onChange } = renderField(false);
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "changed" } });
    expect(onChange).toHaveBeenCalledWith("changed");
  });
});

/**
 * What the Unlock form tells the user to type, read from the rendered panel,
 * against the passwords the engine's refusals ask for.
 *
 * History: the hint said "Enter the password that currently opens this PDF."
 * A PDF with only an owner (permissions) password opens for anyone and has no
 * such password, so its owner had nothing true to type, and whatever they
 * tried came back as "The password is incorrect". Both refusals that send a
 * user to Unlock with an owner password now name it, and so must the form.
 */
describe("Unlock form names every password the engine accepts", () => {
  const unlockTool = tools.find((t) => t.slug === "unlock-pdf")!;

  async function renderUnlockForm() {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        // The payload the status route builds for a local-dev worker with qpdf.
        JSON.stringify(
          buildWorkerStatus("local-dev", undefined, undefined, {}, true),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    render(<PdfSecurityWorkerPanel tool={unlockTool} />);
    return waitFor(() => {
      const hint = document.getElementById("pdf-security-password-hint");
      if (!hint) throw new Error("the unlock form has not rendered");
      return hint.textContent ?? "";
    });
  }

  /** The owner-password name each refusal uses, from the message a user reads. */
  async function refusalsNamingTheOwnerPassword(): Promise<string[]> {
    const opensFreely: QpdfRunner = {
      isEncrypted: async () => true,
      requiresPassword: async () => "opens-freely",
      protect: async () => new Uint8Array(),
      unlock: async () => ({ ok: false, reason: "wrong-password" }),
    };
    const pdf = new TextEncoder().encode(
      `%PDF-1.7\n${"0".repeat(32)}\n%%EOF\n`,
    );
    const runs = [
      await runUnlock(pdf, { password: "x" }, { qpdf: opensFreely }),
      await runProtect(
        pdf,
        { password: "x", ownerPassword: "x", keyLength: 256 },
        { qpdf: opensFreely },
      ),
    ];
    return runs.map((run) => {
      if (run.ok) throw new Error("expected a refusal");
      return run.message;
    });
  }

  it("positive control: both refusals exist and name the owner password", async () => {
    const messages = await refusalsNamingTheOwnerPassword();
    expect(messages).toHaveLength(2);
    for (const message of messages) expect(message).toMatch(/owner/);
  });

  it("the rendered hint admits the owner (permissions) password the refusals ask for", async () => {
    const hint = await renderUnlockForm();
    // Health check: this is the unlock hint, not protect's or an empty node.
    expect(hint).toMatch(/opens this PDF/);
    for (const message of await refusalsNamingTheOwnerPassword()) {
      const named = /owner(?: \(permissions\))? password/.exec(message)?.[0];
      expect(named, message).toBeTruthy();
      expect(hint).toContain("owner (permissions) password");
    }
    expect(hint).not.toMatch(
      /^Enter the password that currently opens this PDF\.$/,
    );
  });
});

describe("isPasswordMissing — neither mode runs with a blank password", () => {
  /**
   * INVERTED 2026-09-28 at the merge of wave1/l06-copy-other, history kept.
   * That lane wrote "unlock runs with a blank password; protect does not": a
   * blank unlock lifted an owner-only file's printing/copying/editing locks
   * without the owner password. The integrated product keeps the other lane's
   * rule (a50c54c) — the suite above requires the form to ask for the owner
   * (permissions) password instead — and the job parser refuses "" anyway, so
   * a form that started a blank unlock would only earn a refusal.
   */
  it("unlock and protect both wait for a password", () => {
    expect(isPasswordMissing("unlock", "")).toBe(true);
    expect(isPasswordMissing("protect", "")).toBe(true);
    // Control: a typed password is never "missing" in either mode.
    expect(isPasswordMissing("protect", "p")).toBe(false);
    expect(isPasswordMissing("unlock", "p")).toBe(false);
  });
});
