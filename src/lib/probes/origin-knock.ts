/**
 * Knock on the origin directly and say whether it answered.
 *
 * WHY THIS EXISTS
 * The rate limiter keys each client on `cf-connecting-ip`. Cloudflare writes
 * that header only for requests that came through Cloudflare, so it is only as
 * trustworthy as the claim "nobody can reach the origin except through
 * Cloudflare". `pnpm verify:rate-limit` with `ORIGIN_IP` set is the one check
 * of that claim, and this is its instrument.
 *
 * THE PROPERTY, NOT THE MECHANISM
 * The question is "does the origin serve HTTP to a caller who did not come
 * through the edge?" — not "does it present a publicly trusted certificate".
 * Until 2026-09 the knock verified the certificate and counted EVERY error as
 * a refusal. The certificates an origin behind Cloudflare Full-strict actually
 * carries — a Cloudflare Origin CA cert, or Traefik's default self-signed one —
 * are not publicly trusted, so an origin that answered anyone who asked failed
 * verification and was certified LOCKED, exit 0. So was a DNS failure, a route
 * error, a proxy error. The one check of the property the rate-limit fix rests
 * on failed silently in the convenient direction.
 *
 * Now:
 * - the certificate is NOT verified (`rejectUnauthorized: false`): whether the
 *   origin answers does not depend on who signed its cert;
 * - only an observed refusal counts as locked (see {@link classifyKnockError});
 * - anything else is INCONCLUSIVE and the caller must not report a pass.
 */
import https from "node:https";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";

export type KnockOutcome =
  /** An HTTP response came back: the origin serves direct callers. */
  | { kind: "answered"; status: number }
  /** The origin refused before any HTTP answer, in a way we observed. */
  | { kind: "refused"; reason: string }
  /** Something else happened; this run proves nothing either way. */
  | { kind: "inconclusive"; reason: string };

/**
 * Socket errors that mean the far end (or a firewall in front of it) refused
 * the connection. Each is a refusal we OBSERVED, not an absence of evidence.
 * Exported so the test discovers the set instead of retyping it.
 */
export const REFUSAL_CODES = [
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
] as const;

/**
 * Fatal TLS alerts that, RECEIVED from the peer, mean "not you": the origin
 * demanded a credential we did not present or refused who we said we were.
 * Authenticated Origin Pulls is the case that matters — a missing client
 * certificate is `certificate_required` (116) under TLS 1.3 and
 * `handshake_failure` (40) under an OpenSSL TLS 1.2 server. Alerts that mean
 * "not your TLS stack" (`protocol_version` 70, `insufficient_security` 71,
 * `internal_error` 80, …) are left out: another client might get through, so
 * they prove nothing about strangers and stay inconclusive.
 */
export const REFUSING_ALERTS: Readonly<Record<number, string>> = {
  40: "handshake_failure",
  42: "bad_certificate",
  48: "unknown_ca",
  49: "access_denied",
  112: "unrecognized_name",
  116: "certificate_required",
};

/**
 * OpenSSL appends this to every alert it RECEIVES, however the version names
 * the reason: the code for the same alert 40 was `ERR_SSL_SSLV3_ALERT_…` in
 * older releases and is `ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE` under the
 * OpenSSL 3.5 in Node 24 — a pattern over the code missed the second
 * spelling on its first run. Errors our OWN side raises (a certificate we
 * could not verify, a record we could not parse) do not carry it. The number
 * is the wire value, so it is read instead of the version-dependent code.
 */
const RECEIVED_ALERT = /SSL alert number (\d+)/;

/**
 * Classify a request error. `handshakeDone` says whether our TLS handshake
 * had completed when it happened.
 */
export function classifyKnockError(
  error: { code?: unknown; message?: unknown },
  handshakeDone: boolean,
): KnockOutcome {
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  const described = `${code || "no code"}: ${message.split("\n")[0]}`;
  const alert = RECEIVED_ALERT.exec(message);
  if (alert) {
    const number = Number(alert[1]);
    const alertName = REFUSING_ALERTS[number];
    // Under TLS 1.3 the client finishes its half of the handshake BEFORE the
    // server checks the (absent) client certificate, so an AOP refusal arrives
    // after `secureConnect`. It is still a refusal: no HTTP answer can follow.
    return alertName
      ? {
          kind: "refused",
          reason: `the origin sent TLS alert ${number} ${alertName}`,
        }
      : {
          kind: "inconclusive",
          reason: `the origin sent TLS alert ${number}, which refuses our TLS stack, not us (${described})`,
        };
  }
  if ((REFUSAL_CODES as readonly string[]).includes(code)) {
    return {
      kind: "refused",
      reason: `the connection was refused (${described})`,
    };
  }
  return {
    kind: "inconclusive",
    reason:
      `the knock failed for a reason that is not a refusal (${described})` +
      (handshakeDone ? " after a completed TLS handshake" : ""),
  };
}

export interface KnockOptions {
  /** The address to connect to, whatever DNS says about `hostname`. */
  originIp: string;
  /** The production hostname, sent as SNI and `Host`. */
  hostname: string;
  port?: number;
  timeoutMs?: number;
  /**
   * TEST SEAM ONLY: replaces the TCP connect so a test can run a real HTTPS
   * server over an in-memory pipe without binding a port. It receives the SAME
   * options the real connect would (certificate policy included), so a test
   * through it exercises the production request, not a copy of it.
   */
  createConnection?: (options: Record<string, unknown>) => Duplex;
}

const PATH = "/api/worker/status";

export function knockOnOrigin(options: KnockOptions): Promise<KnockOutcome> {
  const { originIp, hostname, port = 443, timeoutMs = 10_000 } = options;
  const family = isIP(originIp);
  if (family === 0) {
    return Promise.resolve({
      kind: "inconclusive",
      reason: `ORIGIN_IP ${JSON.stringify(originIp)} is not an IP address`,
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let handshakeDone = false;
    const settle = (outcome: KnockOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const req = https.request(
      {
        host: hostname,
        servername: hostname,
        port,
        path: PATH,
        method: "GET",
        timeout: timeoutMs,
        // Whether the origin ANSWERS is the question; who signed its cert is not.
        rejectUnauthorized: false,
        // Connect to the origin address, whatever DNS says about the name.
        lookup: ((
          _host: string,
          lookupOptions: { all?: boolean },
          cb: (...args: unknown[]) => void,
        ) =>
          lookupOptions?.all
            ? cb(null, [{ address: originIp, family }])
            : cb(null, originIp, family)) as never,
        ...(options.createConnection
          ? { createConnection: options.createConnection as never }
          : {}),
      },
      (res) => {
        res.resume();
        settle({ kind: "answered", status: res.statusCode ?? 0 });
      },
    );
    req.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        handshakeDone = true;
      });
    });
    req.on("timeout", () => {
      // Silence before a handshake is a firewall dropping us: a refusal.
      // Silence AFTER one means the origin speaks TLS to strangers and we could
      // not tell whether it serves them — that is not a pass.
      settle(
        handshakeDone
          ? {
              kind: "inconclusive",
              reason: `the origin completed a TLS handshake, then sent nothing for ${timeoutMs} ms`,
            }
          : { kind: "refused", reason: `no connection within ${timeoutMs} ms` },
      );
      req.destroy();
    });
    req.on("error", (error: NodeJS.ErrnoException) =>
      settle(classifyKnockError(error, handshakeDone)),
    );
    req.end();
  });
}

export interface KnockVerdict {
  /** 0 = locked, 4 = answered directly, 2 = inconclusive. */
  exitCode: 0 | 2 | 4;
  message: string;
}

/** What `verify:rate-limit` prints and exits with for one knock. */
export function knockVerdict(
  originIp: string,
  hostname: string,
  outcome: KnockOutcome,
): KnockVerdict {
  switch (outcome.kind) {
    case "answered":
      return {
        exitCode: 4,
        message:
          `\nORIGIN REACHABLE — ${originIp} answered HTTP ${outcome.status} for ${hostname}\n` +
          `directly, so a caller can bypass the edge and write the client-IP header.`,
      };
    case "refused":
      return {
        exitCode: 0,
        message: `The origin ${originIp} refused a direct connection: ${outcome.reason}.`,
      };
    case "inconclusive":
      return {
        exitCode: 2,
        message:
          `\nORIGIN UNKNOWN — knocking on ${originIp} for ${hostname}: ${outcome.reason}.\n` +
          `That is neither an answer nor a refusal, so nothing is proven. Re-run from\n` +
          `a machine with ordinary internet access, and check ORIGIN_IP.`,
      };
  }
}
