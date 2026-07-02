import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssuranceNote, RecoverableError, StatusBadge } from "./status-ui";

describe("StatusBadge", () => {
  it("renders its label", () => {
    render(<StatusBadge tone="ok" label="Available" />);
    expect(screen.getByText("Available")).toBeInTheDocument();
  });
});

describe("RecoverableError", () => {
  it("shows the title, message, and detail as an alert", () => {
    render(
      <RecoverableError
        title="Something failed"
        message="Here's what happened."
        detail="reason: processing-error"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something failed");
    expect(alert).toHaveTextContent("Here's what happened.");
    expect(alert).toHaveTextContent("reason: processing-error");
  });

  it("offers a recovery action that calls back", () => {
    const onRetry = vi.fn();
    render(
      <RecoverableError title="Oops" message="Try again." onRetry={onRetry} retryLabel="Retry" />,
    );
    screen.getByRole("button", { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no action buttons when none are provided", () => {
    render(<RecoverableError title="Oops" message="No recovery here." />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("AssuranceNote", () => {
  it("renders its reassurance text", () => {
    render(<AssuranceNote>Nothing is uploaded.</AssuranceNote>);
    expect(screen.getByText("Nothing is uploaded.")).toBeInTheDocument();
  });
});
