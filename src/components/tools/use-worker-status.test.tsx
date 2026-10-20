// @vitest-environment jsdom
/**
 * ONE status check per page, shared by every panel on it (spec C.2, E.10).
 *
 * Before WP-10 every panel ran its own copy of the effect — and Compress
 * PDF's deep panel a fourteenth — so a page with two worker surfaces asked
 * twice, a remount asked again, and one dropped request left the page on
 * "unavailable" until a reload. These pin the shared hook's contract: one
 * in-flight request however many mount, a 30s cache, two backed-off retries
 * on a network or 5xx failure, and a 429's `Retry-After` honoured (capped at
 * 30s) rather than retried into.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { READY_WORKER_STATUS } from "@/tests/ready-worker-status";
import {
  STATUS_CACHE_MS,
  resetWorkerStatusForTests,
  useWorkerStatus,
} from "./use-worker-status";

function Probe({ id }: { id: string }) {
  const { phase, limited } = useWorkerStatus();
  return (
    <p data-testid={id}>
      {phase}
      {limited ? " limited" : ""}
    </p>
  );
}

const ok = () =>
  new Response(JSON.stringify(READY_WORKER_STATUS), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(
  replies: Array<() => Response | Promise<Response>>,
  clock = { now: 0 },
) {
  const sleeps: number[] = [];
  resetWorkerStatusForTests({
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  let i = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("/api/worker/status");
    const reply = replies[Math.min(i++, replies.length - 1)]!;
    return reply();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, sleeps, clock };
}

describe("useWorkerStatus", () => {
  it("asks once however many panels mount", async () => {
    const { fetchMock } = setup([ok]);
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("c")).toHaveTextContent("ready"),
    );
    expect(screen.getByTestId("a")).toHaveTextContent("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a remount from the cache for 30s, then asks again", async () => {
    const clock = { now: 0 };
    const { fetchMock } = setup([ok], clock);
    const first = render(<Probe id="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("ready"),
    );
    first.unmount();
    clock.now = STATUS_CACHE_MS - 1;
    const second = render(<Probe id="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("ready"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    second.unmount();
    clock.now = STATUS_CACHE_MS + 1;
    render(<Probe id="a" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(STATUS_CACHE_MS).toBe(30_000);
  });

  it("retries a network or 5xx failure twice, backing off, then answers", async () => {
    const { fetchMock, sleeps } = setup([
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => new Response("", { status: 503 }),
      ok,
    ]);
    render(<Probe id="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("ready"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps.length).toBe(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });

  it("gives up after the two retries, and retry() asks again", async () => {
    const { fetchMock } = setup([
      () => new Response("", { status: 502 }),
      () => new Response("", { status: 502 }),
      () => new Response("", { status: 502 }),
      ok,
    ]);
    let retry = () => {};
    function Retrying() {
      const s = useWorkerStatus();
      retry = s.retry;
      return <p data-testid="r">{s.phase}</p>;
    }
    render(<Retrying />);
    await waitFor(() =>
      expect(screen.getByTestId("r")).toHaveTextContent("error"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    act(() => retry());
    await waitFor(() =>
      expect(screen.getByTestId("r")).toHaveTextContent("ready"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("a 429 waits Retry-After (capped at 30s) and is not retried into", async () => {
    const { fetchMock, sleeps } = setup([
      () => new Response("", { status: 429, headers: { "retry-after": "7" } }),
    ]);
    render(<Probe id="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("error limited"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([7000]);

    const capped = setup([
      () =>
        new Response("", { status: 429, headers: { "retry-after": "600" } }),
    ]);
    render(<Probe id="b" />);
    await waitFor(() =>
      expect(screen.getByTestId("b")).toHaveTextContent("error limited"),
    );
    expect(capped.sleeps).toEqual([30_000]);
  });

  it("a 4xx other than 429 is answered at once, not retried", async () => {
    const { fetchMock } = setup([() => new Response("", { status: 404 })]);
    render(<Probe id="a" />);
    await waitFor(() =>
      expect(screen.getByTestId("a")).toHaveTextContent("error"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
