/**
 * Job-option fields that must never reach the queue broker readable.
 *
 * WHY. Protect and Unlock carry the user's PDF password in `options`, and the
 * Redis queue wrote `options` verbatim into `…:spec:{id}` — plaintext, in a
 * third-party managed store, until the job finished or (with no worker running)
 * for the whole queue TTL: 24 h by default, up to 7 days. Meanwhile the panel
 * told users it was "never stored".
 *
 * WHAT THIS DOES. Sealed boxes: the web tier holds only a PUBLIC key and
 * encrypts each secret field to it (ephemeral X25519 → HKDF-SHA256 →
 * AES-256-GCM, the field name bound as AAD); only the worker's PRIVATE key
 * opens them. A leaked broker token alone therefore reveals nothing, and the
 * web tier — which saw the plaintext in the request anyway — cannot read a
 * stored one back. The lifetime is unchanged: the spec (and the box) is kept
 * until FINALIZE deletes it, because a REDELIVERED or requeued attempt reads
 * the same spec again and must still find the password.
 *
 * WHAT IT DOES NOT DO. It does not make "never stored" true — ciphertext is
 * stored — and it is inert until an operator configures the keys (see
 * {@link SEAL_ENV}). Order matters and is the operator's: the worker gets the
 * private key and is redeployed FIRST (it opens sealed and plaintext options
 * alike), then the web tier gets the public key. The other order fails every
 * Protect/Unlock job closed, loudly, rather than storing the password.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

export const SEAL_ENV = {
  /** Web tier. base64url of the raw 32-byte X25519 public key (JWK `x`). */
  publicKey: "PDFXYZ_JOB_SEAL_PUBLIC_KEY",
  /** Worker. base64url of the raw 32-byte X25519 private key (JWK `d`). */
  privateKey: "PDFXYZ_JOB_SEAL_PRIVATE_KEY",
} as const;

/**
 * Option fields sealed wherever they appear in a job's options — every field
 * the job validator reads with `parsePassword`. The chain test DISCOVERS that
 * set from the parser's source and fails if this list and it ever differ.
 */
export const SEALED_OPTION_FIELDS = ["password", "ownerPassword"] as const;

const SEALED_MARK = "$sealed";
const VERSION = "v1";
const INFO = "pdf.xyz job option seal v1";
// DER wrappers for a raw X25519 key (RFC 8410): fixed prefixes + 32 bytes.
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export interface OptionSealing {
  /** Present on the tier that SEALS (web). */
  publicKey?: KeyObject;
  /** Present on the tier that OPENS (worker). */
  privateKey?: KeyObject;
  /** A configured key that did not parse; secret-bearing jobs fail closed. */
  misconfigured?: string;
}

function raw32(value: string): Buffer | null {
  const bytes = Buffer.from(value.trim(), "base64url");
  return bytes.byteLength === 32 ? bytes : null;
}

/** Read the seal keys from the environment. Names only in errors, never values. */
export function optionSealingFromEnv(
  env: Record<string, string | undefined>,
): OptionSealing {
  const out: OptionSealing = {};
  const pub = env[SEAL_ENV.publicKey]?.trim();
  const priv = env[SEAL_ENV.privateKey]?.trim();
  if (pub) {
    const bytes = raw32(pub);
    if (!bytes) out.misconfigured = `${SEAL_ENV.publicKey} is not 32 bytes`;
    else
      out.publicKey = createPublicKey({
        key: Buffer.concat([SPKI_PREFIX, bytes]),
        format: "der",
        type: "spki",
      });
  }
  if (priv) {
    const bytes = raw32(priv);
    if (!bytes) out.misconfigured = `${SEAL_ENV.privateKey} is not 32 bytes`;
    else
      out.privateKey = createPrivateKey({
        key: Buffer.concat([PKCS8_PREFIX, bytes]),
        format: "der",
        type: "pkcs8",
      });
  }
  return out;
}

/** A fresh key pair, as the two env values. For operators and tests. */
export function generateSealKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const pair = generateKeyPairSync("x25519");
  return {
    publicKey: pair.publicKey.export({ format: "jwk" }).x as string,
    privateKey: pair.privateKey.export({ format: "jwk" }).d as string,
  };
}

function deriveKey(shared: Buffer, epk: Buffer, field: string): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, epk, `${INFO}:${field}`, 32));
}

function sealValue(
  value: unknown,
  field: string,
  recipient: KeyObject,
): string {
  const eph = generateKeyPairSync("x25519");
  const epk = Buffer.from(
    eph.publicKey.export({ format: "jwk" }).x as string,
    "base64url",
  );
  const key = deriveKey(
    diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }),
    epk,
    field,
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(field));
  const ct = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, epk, iv, ct, tag]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

function openValue(box: string, field: string, privateKey: KeyObject): unknown {
  const [version, epkB, ivB, ctB, tagB] = box.split(".");
  if (version !== VERSION || !epkB || !ivB || !ctB || !tagB)
    throw new Error("unrecognised seal");
  const epk = Buffer.from(epkB, "base64url");
  const senderKey = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, epk]),
    format: "der",
    type: "spki",
  });
  const key = deriveKey(
    diffieHellman({ privateKey, publicKey: senderKey }),
    epk,
    field,
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB, "base64url"),
  );
  decipher.setAAD(Buffer.from(field));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain);
}

const isSealed = (value: unknown): value is { [SEALED_MARK]: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>)[SEALED_MARK] === "string";

/** Does this job carry a field that must be sealed? */
export function hasSecretOptions(options: Record<string, unknown>): boolean {
  return SEALED_OPTION_FIELDS.some((f) => options[f] !== undefined);
}

/**
 * Seal every secret field for the queue. Without a public key the options pass
 * through unchanged — the pre-rollout state, stated rather than hidden.
 */
export function sealOptions(
  options: Record<string, unknown>,
  publicKey: KeyObject,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...options };
  for (const field of SEALED_OPTION_FIELDS) {
    if (out[field] === undefined || isSealed(out[field])) continue;
    out[field] = { [SEALED_MARK]: sealValue(out[field], field, publicKey) };
  }
  return out;
}

export type OpenResult =
  | { ok: true; options: Record<string, unknown> }
  | { ok: false; reason: "no_key" | "undecryptable" };

/** Open every sealed field. Plaintext fields (pre-rollout jobs) pass through. */
export function openOptions(
  options: Record<string, unknown>,
  privateKey: KeyObject | undefined,
): OpenResult {
  const sealed = SEALED_OPTION_FIELDS.filter((f) => isSealed(options[f]));
  if (sealed.length === 0) return { ok: true, options };
  if (!privateKey) return { ok: false, reason: "no_key" };
  const out: Record<string, unknown> = { ...options };
  try {
    for (const field of sealed)
      out[field] = openValue(
        (options[field] as { [SEALED_MARK]: string })[SEALED_MARK],
        field,
        privateKey,
      );
  } catch {
    return { ok: false, reason: "undecryptable" };
  }
  return { ok: true, options: out };
}
