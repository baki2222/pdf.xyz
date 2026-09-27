import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { MUST_ALLOW, MUST_BLOCK } from "@/lib/net/public-address.corpus";
import {
  createRenderNetwork,
  defaultPinnedFetch,
  type PausedRequest,
  type PinnedFetch,
  type Resolve,
} from "./network";

const get = (
  url: string,
  headers: Record<string, string> = {},
): PausedRequest => ({
  url,
  method: "GET",
  headers,
});

const ok: PinnedFetch = async () => ({
  status: 200,
  rawHeaders: ["Content-Type", "text/plain"],
  body: new TextEncoder().encode("hello"),
});

const asUrl = (addr: string) =>
  addr.includes(":") ? `http://[${addr}]/` : `http://${addr}/`;

describe("renderer network policy", () => {
  it("refuses every non-http(s) scheme without resolving anything", async () => {
    const resolve = vi.fn<Resolve>();
    const fetch = vi.fn<PinnedFetch>(ok);
    const net = createRenderNetwork({ resolve, fetch });
    for (const url of [
      "file:///etc/passwd",
      "file:///proc/1/environ",
      "ftp://example.com/x",
      "chrome://version",
      "ws://example.com/",
      "gopher://127.0.0.1:6379/_INFO",
    ]) {
      const d = await net.handle(get(url));
      expect(d.action, url).toBe("fail");
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(MUST_BLOCK.map(asUrl))(
    "refuses the literal %s without fetching",
    async (url) => {
      const fetch = vi.fn<PinnedFetch>(ok);
      const d = await createRenderNetwork({ fetch }).handle(get(url));
      expect(d).toMatchObject({ action: "fail", reason: "BlockedByClient" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(MUST_ALLOW.map(asUrl))(
    "fetches the public literal %s (positive control)",
    async (url) => {
      const fetch = vi.fn<PinnedFetch>(ok);
      const d = await createRenderNetwork({ fetch }).handle(get(url));
      expect(d.action).toBe("fulfill");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("judges a NAME by every address it resolves to, and dials the one it checked", async () => {
    const answers: Record<string, { address: string; family: 4 | 6 }[]> = {
      "public.example": [{ address: "93.184.215.14", family: 4 }],
      // nip.io-style: a public-looking name for loopback. The edge cannot see
      // this; only a resolver can.
      "127.0.0.1.nip.io": [{ address: "127.0.0.1", family: 4 }],
      "mixed.example": [
        { address: "93.184.215.14", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ],
      "v6.example": [{ address: "fd00::1", family: 6 }],
    };
    const resolve: Resolve = async (h) => answers[h] ?? [];
    const fetch = vi.fn<PinnedFetch>(ok);
    const net = createRenderNetwork({ resolve, fetch });

    for (const host of ["127.0.0.1.nip.io", "mixed.example", "v6.example"])
      expect((await net.handle(get(`https://${host}/`))).action, host).toBe(
        "fail",
      );
    expect(fetch).not.toHaveBeenCalled();

    expect((await net.handle(get("https://public.example/a"))).action).toBe(
      "fulfill",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toEqual({
      address: "93.184.215.14",
      family: 4,
    });
  });

  it("refuses internal names before asking DNS", async () => {
    const resolve = vi.fn<Resolve>(async () => [
      { address: "93.184.215.14", family: 4 },
    ]);
    const net = createRenderNetwork({ resolve, fetch: ok });
    for (const host of [
      "localhost.",
      "metadata",
      "metadata.google.internal",
      "document.invalid",
    ])
      expect((await net.handle(get(`http://${host}/`))).action, host).toBe(
        "fail",
      );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("hands a redirect back to Chromium as a redirect (its target is re-checked on arrival)", async () => {
    const net = createRenderNetwork({
      resolve: async () => [{ address: "93.184.215.14", family: 4 }],
      fetch: async () => ({
        status: 302,
        rawHeaders: ["Location", "http://169.254.169.254/latest/"],
        body: new Uint8Array(),
      }),
    });
    const d = await net.handle(get("https://public.example/r"));
    expect(d).toMatchObject({ action: "fulfill", status: 302 });
    expect(
      (await net.handle(get("http://169.254.169.254/latest/"))).action,
    ).toBe("fail");
  });

  it("decodes the body, drops wire headers, and never forwards hop-by-hop ones", async () => {
    const fetch = vi.fn<PinnedFetch>(async () => ({
      status: 200,
      rawHeaders: [
        "Content-Type",
        "text/html",
        "Content-Encoding",
        "gzip",
        "Content-Length",
        "40",
        "Set-Cookie",
        "a=1",
      ],
      body: new Uint8Array(gzipSync(Buffer.from("<p>zipped</p>"))),
    }));
    const net = createRenderNetwork({
      resolve: async () => [{ address: "93.184.215.14", family: 4 }],
      fetch,
    });
    const d = await net.handle(
      get("https://public.example/", {
        Host: "evil.internal",
        "Proxy-Authorization": "x",
        "User-Agent": "HeadlessChrome",
      }),
    );
    if (d.action !== "fulfill") throw new Error("expected fulfill");
    expect(Buffer.from(d.body).toString()).toBe("<p>zipped</p>");
    expect(d.headers.map((h) => h.name.toLowerCase())).toEqual([
      "content-type",
      "set-cookie",
    ]);
    const sentHeaders = fetch.mock.calls[0]![2].headers;
    expect(Object.keys(sentHeaders)).toEqual(["User-Agent"]);
  });

  it("caps requests per render", async () => {
    const net = createRenderNetwork(
      { resolve: async () => [{ address: "1.1.1.1", family: 4 }], fetch: ok },
      {
        maxRequests: 2,
        maxResponseBytes: 100,
        maxTotalBytes: 1000,
        requestTimeoutMs: 1000,
      },
    );
    expect((await net.handle(get("https://a.example/"))).action).toBe(
      "fulfill",
    );
    expect((await net.handle(get("https://a.example/"))).action).toBe(
      "fulfill",
    );
    expect((await net.handle(get("https://a.example/"))).action).toBe("fail");
  });

  /*
   * The pin is what defeats DNS rebinding, so it is tested on the REAL
   * fetcher, not the seam. `rebind.invalid` cannot resolve; if the socket
   * asked DNS we would see ENOTFOUND. Seeing a refused connection to exactly
   * the pinned address proves the lookup never left this process. Port 1 on
   * loopback is closed, so no listener is needed and none is opened.
   */
  it("the real fetcher connects to the pinned address and nowhere else", async () => {
    const error = await defaultPinnedFetch(
      new URL("http://rebind.invalid:1/"),
      { address: "127.0.0.1", family: 4 },
      { method: "GET", headers: {}, maxBytes: 10, timeoutMs: 5000 },
    ).then(
      () => null,
      (e: NodeJS.ErrnoException) => e,
    );
    expect(error?.code).toBe("ECONNREFUSED");
    expect(String(error?.message)).toContain("127.0.0.1:1");
  });

  /*
   * The edge guard's docblock names this module as THE enforcement layer. A
   * comment is not a guard: pin that the file it names exists and is the one
   * the renderer actually drives.
   */
  it("the enforcement layer the edge guard names is the one the renderer uses", () => {
    const root = process.cwd();
    const validation = readFileSync(
      path.join(root, "src/lib/jobs/validation.ts"),
      "utf8",
    );
    const named = validation.match(/`(src\/lib\/workers\/[^`]+\.ts)`/)?.[1];
    expect(named).toBe("src/lib/workers/html-render/network.ts");
    expect(existsSync(path.join(root, named!))).toBe(true);
    const native = readFileSync(
      path.join(root, "src/lib/workers/html-render/native.ts"),
      "utf8",
    );
    expect(native).toMatch(/from "\.\/network"/);
    expect(native).toMatch(/createRenderNetwork\(/);
  });
});
