// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import * as telemetryConfig from "@/lib/telemetry/config";
import { NotifyMe } from "./notify-me";

afterEach(() => {
  resetTelemetry();
  vi.restoreAllMocks();
});

describe("NotifyMe", () => {
  it("records which gated tool was asked for, and nothing about the person asking", () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));

    render(<NotifyMe toolName="Chat with PDF" toolSlug="chat-with-pdf" />);
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    // Exactly the tool and its capability class — no identifier, no free text.
    expect(seen).toEqual([
      {
        name: "gated_tool_interest",
        toolSlug: "chat-with-pdf",
        capability: "ai",
      },
    ]);
  });

  it("derives the capability from the slug rather than trusting the caller", () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));

    render(<NotifyMe toolName="Word to PDF" toolSlug="word-to-pdf" />);
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(seen[0]).toMatchObject({
      name: "gated_tool_interest",
      toolSlug: "word-to-pdf",
      capability: "secure-worker",
    });
  });

  it("emits nothing at all for a slug that is not in the catalog", () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));

    render(<NotifyMe toolName="Nope" toolSlug="not-a-real-tool" />);
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(seen).toEqual([]);
    // The click is still acknowledged; telemetry never changes what the user sees.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("promises nothing left the device when no telemetry destination is configured", () => {
    vi.spyOn(telemetryConfig, "isTelemetryEnabled").mockReturnValue(false);

    render(<NotifyMe toolName="Chat with PDF" toolSlug="chat-with-pdf" />);
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(screen.getByRole("status")).toHaveTextContent(
      /nothing was sent from your device/i,
    );
  });

  it("stops claiming that once a destination is configured", () => {
    vi.spyOn(telemetryConfig, "isTelemetryEnabled").mockReturnValue(true);

    render(<NotifyMe toolName="Chat with PDF" toolSlug="chat-with-pdf" />);
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    const status = screen.getByRole("status");
    expect(status).not.toHaveTextContent(/nothing was sent from your device/i);
    expect(status).toHaveTextContent(/only the tool name was counted/i);
  });
});
