// @vitest-environment node
/**
 * The origin knock is the ONE check that the origin refuses callers who skip
 * Cloudflare — the property `cf-connecting-ip` keying rests on. Until 2026-09
 * it verified the certificate and counted every error as a refusal, so an
 * origin that answered anyone, behind a self-signed or Origin CA cert, was
 * certified locked (exit 0). These tests run the PRODUCTION request against
 * real TLS servers and read the verdict the script prints and exits with.
 *
 * No port is bound: each server is a real `https.Server` fed an in-memory pipe
 * through the knock's `createConnection` seam, which receives the same options
 * (certificate policy included) the real connect does. The one real-network
 * case is a connect to a closed port, which binds nothing.
 */
import type * as TS from "typescript";
import { X509Certificate, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REFUSAL_CODES,
  REFUSING_ALERTS,
  classifyKnockError,
  knockOnOrigin,
  knockVerdict,
  type KnockOutcome,
} from "./origin-knock";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const HOST = "pdf.xyz";
const IP = "203.0.113.7";

// ---- a self-signed certificate, built here: no fixture key in the repo ------

function der(tag: number, content: Buffer): Buffer {
  const n = content.length;
  const len =
    n < 0x80
      ? Buffer.from([n])
      : n < 0x100
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const seq = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const utcTime = (d: Date) =>
  der(
    0x17,
    Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"),
  );
/** 1.2.840.10045.4.3.2 ecdsa-with-SHA256 */
const ECDSA_SHA256 = seq(Buffer.from("06082a8648ce3d040302", "hex"));
/** CN=<name>, OID 2.5.4.3 */
const name = (cn: string) =>
  seq(
    der(
      0x31,
      seq(Buffer.from("0603550403", "hex"), der(0x0c, Buffer.from(cn))),
    ),
  );

/** A v1 self-signed P-256 certificate — the shape of Traefik's default cert. */
function selfSigned(cn: string): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const now = Date.now();
  const tbs = seq(
    der(0x02, Buffer.from([0x01, 0x23, 0x45])),
    ECDSA_SHA256,
    name(cn),
    seq(
      utcTime(new Date(now - 86_400_000)),
      utcTime(new Date(now + 86_400_000)),
    ),
    name(cn),
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certDer = seq(
    tbs,
    ECDSA_SHA256,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    // Parsing it back is the health check that the DER above is a certificate.
    cert: new X509Certificate(certDer).toString(),
  };
}

const CERT = selfSigned("TRAEFIK DEFAULT CERT");

// ---- an in-memory socket pair, so a real server needs no port -------------

function pipePair(): [Duplex, Duplex] {
  const ends: Duplex[] = [];
  const make = (peer: () => Duplex) =>
    new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        peer().push(chunk);
        cb();
      },
      final(cb) {
        peer().push(null);
        cb();
      },
      // A closed socket is an EOF at the far end, as a TCP FIN would be.
      destroy(err, cb) {
        if (!peer().readableEnded) peer().push(null);
        cb(err);
      },
    });
  ends.push(
    make(() => ends[1]!),
    make(() => ends[0]!),
  );
  return [ends[0]!, ends[1]!];
}

/** Route the knock's connection into `server` as if it had accepted it. */
function through(server: http.Server | https.Server) {
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    createConnection: (options: Record<string, unknown>) => {
      seen.push(options);
      const [client, serverEnd] = pipePair();
      server.emit("connection", serverEnd);
      return tls.connect({
        ...(options as tls.ConnectionOptions),
        socket: client,
      });
    },
  };
}

const knock = (createConnection?: (o: Record<string, unknown>) => Duplex) =>
  knockOnOrigin({
    originIp: IP,
    hostname: HOST,
    timeoutMs: 5_000,
    createConnection,
  });

describe("knockOnOrigin — an origin that answers is REACHABLE, whoever signed its cert", () => {
  it("health check: the self-signed certificate is not publicly trusted", () => {
    const x509 = new X509Certificate(CERT.cert);
    expect(x509.subject).toContain("TRAEFIK DEFAULT CERT");
    expect(x509.issuer).toBe(x509.subject);
    expect(
      tls.rootCertificates.map(
        (pem) => new X509Certificate(pem).fingerprint256,
      ),
    ).not.toContain(x509.fingerprint256);
  });

  it("a self-signed origin that serves HTTP gives exit 4", async () => {
    const server = https.createServer({ ...CERT }, (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url, host: req.headers.host }));
    });
    const pipe = through(server);
    const outcome = await knock(pipe.createConnection);
    // The seam received the production request's own options.
    expect(pipe.seen).toHaveLength(1);
    expect(pipe.seen[0]).toMatchObject({ servername: HOST });
    expect(outcome).toEqual({ kind: "answered", status: 200 });
    const verdict = knockVerdict(IP, HOST, outcome);
    expect(verdict.exitCode).toBe(4);
    expect(verdict.message).toContain("ORIGIN REACHABLE");
  });

  it("any HTTP status is an answer — a 404 from the origin is still exit 4", async () => {
    const server = https.createServer({ ...CERT }, (_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const outcome = await knock(through(server).createConnection);
    expect(knockVerdict(IP, HOST, outcome).exitCode).toBe(4);
  });
});

describe("knockOnOrigin — only an OBSERVED refusal counts as locked", () => {
  it("a closed port is refused with ECONNREFUSED, not by timing out", async () => {
    // Port 1 (tcpmux) on loopback: connecting binds nothing.
    const outcome = await knockOnOrigin({
      originIp: "127.0.0.1",
      hostname: HOST,
      port: 1,
      timeoutMs: 8_000,
    });
    expect(outcome.kind, JSON.stringify(outcome)).toBe("refused");
    expect(outcome.kind === "refused" && outcome.reason).toContain(
      "ECONNREFUSED",
    );
    expect(knockVerdict("127.0.0.1", HOST, outcome).exitCode).toBe(0);
  }, 15_000);

  it("a Node origin demanding a client certificate (AOP) drops us: refused, ECONNRESET", async () => {
    // Node's TLS server fails the handshake without flushing the alert (seen:
    // the server logs ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE and destroys).
    const server = https.createServer(
      { ...CERT, requestCert: true, rejectUnauthorized: true },
      (_req, res) => res.end("should never be reached"),
    );
    const outcome = await knock(through(server).createConnection);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("refused");
    expect(outcome.kind === "refused" && outcome.reason).toContain(
      "ECONNRESET",
    );
    expect(knockVerdict(IP, HOST, outcome).exitCode).toBe(0);
  });

  it("a fatal alert RECEIVED on the wire is read by its number, whatever OpenSSL calls it", async () => {
    // The one Node server that writes its alert before closing: no shared
    // cipher gives alert 40 handshake_failure — the alert an OpenSSL TLS 1.2
    // origin sends a client with no certificate. Its CODE differs by OpenSSL
    // version (`…SSLV3_ALERT…` vs `…SSL/TLS_ALERT…`); its message does not.
    const server = https.createServer(
      {
        ...CERT,
        maxVersion: "TLSv1.2",
        ciphers: "ECDHE-ECDSA-CHACHA20-POLY1305",
        sigalgs: "ed25519",
      },
      (_req, res) => res.end("should never be reached"),
    );
    const outcome = await knock(through(server).createConnection);
    expect(outcome).toEqual({
      kind: "refused",
      reason: `the origin sent TLS alert 40 ${REFUSING_ALERTS[40]}`,
    });
    expect(knockVerdict(IP, HOST, outcome).exitCode).toBe(0);
  });

  it("an origin that drops the connection after TLS is refused (ECONNRESET)", async () => {
    const server = https.createServer({ ...CERT }, () => {});
    server.on("secureConnection", (socket: tls.TLSSocket) => socket.destroy());
    const outcome = await knock(through(server).createConnection);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("refused");
    expect(outcome.kind === "refused" && outcome.reason).toContain(
      "ECONNRESET",
    );
  });

  it("an error that is NOT a refusal is inconclusive — exit 2, never a pass", async () => {
    // A plain-HTTP server on the TLS port: the client cannot parse its reply.
    const server = http.createServer((_req, res) => res.end("plain"));
    const outcome = await knock(through(server).createConnection);
    expect(outcome.kind, JSON.stringify(outcome)).toBe("inconclusive");
    const verdict = knockVerdict(IP, HOST, outcome);
    expect(verdict.exitCode).toBe(2);
    expect(verdict.message).toContain("ORIGIN UNKNOWN");
  });

  it("an ORIGIN_IP that is not an address is inconclusive, not refused", async () => {
    const outcome = await knockOnOrigin({
      originIp: "origin.example",
      hostname: HOST,
    });
    expect(outcome.kind).toBe("inconclusive");
    expect(knockVerdict("origin.example", HOST, outcome).exitCode).toBe(2);
  });
});

describe("classifyKnockError — the refusal set, both directions", () => {
  const verdictOf = (
    code: string,
    message = "m",
    handshakeDone = false,
  ): KnockOutcome["kind"] =>
    classifyKnockError({ code, message }, handshakeDone).kind;
  const alertMessage = (n: number) =>
    `C0:error:0A000000:SSL routines:ssl3_read_bytes:x:rec_layer_s3.c:918:SSL alert number ${n}\n`;

  it("every exported refusal code classifies as refused (and the set is not empty)", () => {
    expect(REFUSAL_CODES.length).toBeGreaterThanOrEqual(3);
    for (const code of REFUSAL_CODES)
      expect(verdictOf(code), code).toBe("refused");
  });

  it("every refusing alert is a refusal, even after our half of a TLS 1.3 handshake", () => {
    const numbers = Object.keys(REFUSING_ALERTS).map(Number);
    expect(numbers).toEqual(expect.arrayContaining([40, 116]));
    for (const n of numbers) {
      expect(
        verdictOf("ERR_SSL_WHATEVER", alertMessage(n), true),
        String(n),
      ).toBe("refused");
    }
  });

  it("an alert that refuses our TLS stack rather than us is inconclusive", () => {
    for (const n of [47, 50, 70, 71, 80]) {
      expect(REFUSING_ALERTS[n], String(n)).toBeUndefined();
      expect(verdictOf("ERR_SSL_WHATEVER", alertMessage(n)), String(n)).toBe(
        "inconclusive",
      );
    }
  });

  it("the REAL error the old knock counted as a pass — a self-signed cert, verified — is inconclusive", async () => {
    const server = https.createServer({ ...CERT }, (_req, res) =>
      res.end("answered"),
    );
    const pipe = through(server);
    // The old knock's request: identical but for certificate verification.
    const error = await new Promise<NodeJS.ErrnoException>(
      (resolve, reject) => {
        const req = https.request(
          {
            host: HOST,
            servername: HOST,
            path: "/",
            createConnection: pipe.createConnection as never,
          },
          () =>
            reject(
              new Error("verification should have failed before any answer"),
            ),
        );
        req.on("error", resolve);
        req.end();
      },
    );
    expect(error.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(classifyKnockError(error, false).kind).toBe("inconclusive");
  });

  it("the other errors the old knock counted as a pass are inconclusive now", () => {
    for (const code of [
      // certificate verification — what an Origin CA or self-signed cert raised
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      // our side of the network, not the origin's answer
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EADDRNOTAVAIL",
      // our TLS stack failing to parse, not the peer refusing
      "ERR_SSL_WRONG_VERSION_NUMBER",
      "EPROTO",
      "",
    ]) {
      expect(verdictOf(code), code).toBe("inconclusive");
    }
  });
});

describe("the probe operators run is wired to THIS knock", () => {
  // Derived, not named: the file `pnpm verify:rate-limit` actually runs.
  const pkg = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
  };
  const command = pkg.scripts["verify:rate-limit"] ?? "";
  const scriptRel = /\S+\.ts\b/.exec(command)?.[0] ?? "";
  const scriptAbs = path.resolve(process.cwd(), scriptRel);

  function imports(): Array<{ from: string; names: string[] }> {
    const source = ts.createSourceFile(
      scriptAbs,
      readFileSync(scriptAbs, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: Array<{ from: string; names: string[] }> = [];
    for (const stmt of source.statements) {
      if (
        !ts.isImportDeclaration(stmt) ||
        !ts.isStringLiteral(stmt.moduleSpecifier)
      )
        continue;
      const bindings = stmt.importClause?.namedBindings;
      found.push({
        from: stmt.moduleSpecifier.text,
        names:
          bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map((e) => (e.propertyName ?? e.name).text)
            : [],
      });
    }
    return found;
  }

  it("health check: package.json names a script that exists", () => {
    expect(command).toMatch(/^tsx /);
    expect(readFileSync(scriptAbs, "utf8").length).toBeGreaterThan(1000);
  });

  it("imports knockOnOrigin and knockVerdict from this module, and opens no socket of its own", () => {
    const all = imports();
    const here = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "origin-knock",
    );
    const ours = all.filter(
      (i) =>
        i.from.startsWith(".") &&
        path.resolve(path.dirname(scriptAbs), i.from) === here,
    );
    expect(ours.flatMap((i) => i.names)).toEqual(
      expect.arrayContaining(["knockOnOrigin", "knockVerdict"]),
    );
    // A second, private knock would be untested; the pre-fix one was exactly that.
    const sockets = all
      .map((i) => i.from.replace(/^node:/, ""))
      .filter((m) => ["http", "https", "tls", "net", "http2"].includes(m));
    expect(sockets).toEqual([]);
  });
});
