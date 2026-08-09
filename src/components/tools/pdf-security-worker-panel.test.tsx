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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasswordField } from "./pdf-security-worker-panel";

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
