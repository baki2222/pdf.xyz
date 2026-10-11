// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  configureTelemetry,
  resetTelemetry,
  type RedactedEvent,
} from "@/lib/telemetry/track";
import { NotifyMe } from "./notify-me";

afterEach(() => {
  resetTelemetry();
  vi.restoreAllMocks();
});

describe("NotifyMe", () => {
  it("records which gated tool was asked for, and nothing about the person asking", () => {
    const seen: RedactedEvent[] = [];
    configureTelemetry((e) => seen.push(e));

    render(
      <NotifyMe
        toolName="Chat with PDF"
        toolSlug="chat-with-pdf"
        checking={false}
      />,
    );
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

    render(
      <NotifyMe
        toolName="Word to PDF"
        toolSlug="word-to-pdf"
        checking={false}
      />,
    );
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

    render(
      <NotifyMe toolName="Nope" toolSlug="not-a-real-tool" checking={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(seen).toEqual([]);
    // The click is still acknowledged; telemetry never changes what the user sees.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("the click sends the interest beacon — the tool's slug and nothing else", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(
      <NotifyMe
        toolName="Chat with PDF"
        toolSlug="chat-with-pdf"
        checking={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/interest");
    expect(init.method).toBe("POST");
    // Fire-and-forget: the beacon must survive the page unloading under it.
    expect(init.keepalive).toBe(true);
    // The body is exactly the slug — no identifier, no capability, no free text.
    expect(JSON.parse(String(init.body))).toEqual({ slug: "chat-with-pdf" });
  });

  it("sends no beacon for a slug that is not in the catalog", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(
      <NotifyMe toolName="Nope" toolSlug="not-a-real-tool" checking={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a failing beacon never changes what the user sees", () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    render(
      <NotifyMe
        toolName="Chat with PDF"
        toolSlug="chat-with-pdf"
        checking={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("tells the user what pressing the button sends, before they press it", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }),
    );

    render(
      <NotifyMe
        toolName="Chat with PDF"
        toolSlug="chat-with-pdf"
        checking={false}
      />,
    );
    // Visible plain text, not a hover or a link (the ruling's condition).
    // AMENDED 2026-10-10 (review): it read "Pressing it sends us the tool's
    // name — nothing about you", which /privacy §4 contradicts — the request
    // reaches our ordinary logs, IP address and user-agent included. The
    // line now says what is true: the COUNT holds only the name.
    expect(
      screen.getByText(/the count holds only the tool's name/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ordinary server logs/i)).toBeInTheDocument();
  });

  it("the acknowledgement says exactly what was sent — the tool's name only", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }),
    );

    render(
      <NotifyMe
        toolName="Chat with PDF"
        toolSlug="chat-with-pdf"
        checking={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    const status = screen.getByRole("status");
    // INVERTED 2026-10-10. This required "Only the tool's name was sent", and
    // so pinned a claim that was false for every visitor who allowed
    // analytics: the same press sends `gated_tool_interest` to Google
    // Analytics. What WE receive is still the name alone, so the sentence
    // now says who received it; the line under the button names Google's half.
    //
    // INVERTED AGAIN 2026-10-10 (review): "We received only the tool's name —
    // nothing about you or your files" was false of what we receive — the
    // request carries the visitor's IP address and user-agent into our
    // ordinary logs, as /privacy §4 says. What holds only the name is the
    // count, and the sentence now says so.
    expect(status).toHaveTextContent(/we counted only the tool's name/i);
    expect(status).toHaveTextContent(/the count holds nothing about you/i);
    expect(status).not.toHaveTextContent(/we received only/i);
    expect(status).not.toHaveTextContent(/only the tool's name was sent/i);
    expect(status).not.toHaveTextContent(/nothing was sent from your device/i);
    // No promised waitlist, no promised notification — only what happened.
    expect(status).not.toHaveTextContent(/waitlist/i);
  });

  it("does not claim a send it never made (non-catalogue slug)", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(
      <NotifyMe toolName="Nope" toolSlug="not-a-real-tool" checking={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /nothing was sent from your device/i,
    );
  });
});
