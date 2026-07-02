/**
 * The **Node socket transport** for the ClamAV scanner: the one place a real TCP
 * or Unix-socket connection to `clamd` is opened.
 *
 * It implements the node-free {@link ClamavTransport} seam using `node:net`, so the
 * scanner logic in `./clamav` stays testable with a fake transport while a deployed
 * worker uses this to actually reach the daemon. It is Node-only and is imported
 * ONLY by the Node worker runtime (`./node`) — never by the node-free scanner
 * barrel — so importing the scanner types never pulls a socket into a client bundle
 * or a unit test.
 *
 * One round-trip per connection (clamd's INSTREAM/PING model): connect, write the
 * pre-framed request, read until the NUL that terminates a `z`-command reply (or the
 * connection ends), then close. A hard overall deadline guarantees a scan can never
 * hang past `timeoutMs`. Every failure surfaces as a content-free
 * {@link ClamavTransportError} — the underlying error (which can embed an address)
 * is swallowed, and the endpoint host/port/path is never read into an error or log.
 */

import net from "node:net";
import { ClamavTransportError, type ClamavTransport } from "./clamav";

/** Where clamd listens: a TCP host/port, or a Unix domain socket path. */
export type ClamavEndpoint =
  | { readonly host: string; readonly port: number }
  | { readonly socketPath: string };

/**
 * Build a {@link ClamavTransport} that opens a fresh `node:net` connection per
 * round-trip. The endpoint is captured here and never exposed: failures reject with
 * a typed, content-free {@link ClamavTransportError} and never carry the address.
 */
export function createSocketClamavTransport(
  endpoint: ClamavEndpoint,
): ClamavTransport {
  return {
    roundtrip(request, opts) {
      return new Promise<Uint8Array>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let settled = false;

        const socket =
          "socketPath" in endpoint
            ? net.connect({ path: endpoint.socketPath })
            : net.connect({ host: endpoint.host, port: endpoint.port });

        // Single-settle guard: the first of reply/end/error/timeout wins; the
        // socket is then torn down. The retained error listener swallows any error
        // emitted by that teardown (settled → no-op), so destroy() never throws.
        const settle = (run: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          run();
        };

        const timer = setTimeout(
          () => settle(() => reject(new ClamavTransportError("timeout"))),
          opts.timeoutMs,
        );

        socket.on("connect", () => {
          // The request is fully pre-framed (command + length-prefixed chunks +
          // terminator); write it verbatim. No shell, no interpolation.
          socket.write(request);
        });
        socket.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          // A `z`-command reply is NUL-terminated; that NUL means the reply is complete.
          if (chunk.includes(0)) {
            settle(() => resolve(Buffer.concat(chunks)));
          }
        });
        socket.on("end", () => {
          settle(() =>
            chunks.length > 0
              ? resolve(Buffer.concat(chunks))
              : reject(new ClamavTransportError("closed")),
          );
        });
        socket.on("close", (hadError: boolean) => {
          settle(() =>
            chunks.length > 0
              ? resolve(Buffer.concat(chunks))
              : reject(
                  new ClamavTransportError(hadError ? "unreachable" : "closed"),
                ),
          );
        });
        socket.on("error", () => {
          settle(() => reject(new ClamavTransportError("unreachable")));
        });
      });
    },
  };
}
