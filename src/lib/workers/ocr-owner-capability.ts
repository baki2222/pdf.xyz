/**
 * The start-up proof, published on the heartbeat as `ocrOwnerPassword`, that
 * THIS image's OCR PDF runs on a restricted PDF with its owner password and
 * keeps the author's restrictions on the result (competitor-audit backlog
 * #11) — and refuses every other password.
 *
 * WHY A PROOF AND NOT A FLAG. The worker image ships separately from the web
 * tier (CLAUDE.md rule 5: merging is not shipping), and an image built before
 * the option IGNORES `ownerPassword` (its option parser is lenient to unknown
 * keys) and refuses the file as restricted. Only the running image can say
 * what it does with the key; an image built before this module publishes no
 * key, which the reader parses as `false`.
 *
 * WHAT IT RUNS. OCR PDF jobs through the executor's order
 * (`./capability-chain`: registry, soundness gate, processor, manifest
 * gate), on the registry the daemon builds, whose OCR processor holds the
 * image's OWN OCR runner (`createNativeOcrRunner`) with the image's OWN qpdf
 * runner (`createNativeQpdfRunner`, the at-file transport and exit-status
 * reading Protect and Unlock use). The input is a restricted PDF built here
 * ({@link restrictedProbePdf}: RC4 128-bit, revision 3, written with the
 * in-house MD5 and RC4, opens with no password), and the password check is
 * the real one, over its real encryption dictionary. Only two PROCESSES are
 * stand-ins, so a start-up probe launches no engine and touches no disk:
 * OCRmyPDF, which (like the real one, exit 8) refuses any input that still
 * carries /Encrypt, and qpdf, which records the at-file it was handed and
 * writes the plain copy (decrypt) or the probe file itself (encrypt: it IS
 * restricted exactly as the original, so the runner's read-back accepts it).
 *
 * PASS requires ALL of:
 *   (1) the owner password: delivered, OCRmyPDF saw NO /Encrypt, and qpdf
 *       ran twice, only as `qpdf @<at-file>` (the password on no command
 *       line), first `--password=<owner> --decrypt`, then `--encrypt` with
 *       `--owner-password=<owner> --bits=256` and the grant's switches,
 *       written out here as literals: `--print=low --modify-other=n
 *       --extract=n --annotate=y --form=y --assemble=n`;
 *   (2) a wrong password: `unprocessable_entity`, not retryable, with the
 *       wrong-owner-password refusal, and NO process started;
 *   (3) POSITIVE CONTROL, no password: the restricted refusal, with
 *       OCRmyPDF started on input that still carried /Encrypt and qpdf never
 *       started — so the stand-in refuses encryption, and (1)'s OCRmyPDF saw
 *       a decrypted file because the runner decrypted it;
 *   (4) the read-back: the same job with a qpdf whose `--encrypt` writes the
 *       PLAIN copy instead fails, NOT retryable, with the
 *       restrictions-not-kept refusal, delivering nothing: a copy not
 *       restricted like the upload never leaves, and the OCR run is not
 *       repeated to fail the same way (until 2026-11-18 it was a retryable
 *       `internal_error`);
 *   and qpdf is present on this host (presence only, nothing executed).
 *
 * WHAT A PASS DOES NOT MEAN. OCRmyPDF and qpdf are stand-ins: that the real
 * qpdf writes the grant, the owner password, no open password and AES-256,
 * and that the real OCRmyPDF reads the decrypted scan, is proven in the
 * image by `pnpm worker:ocr-owner-proof` (`./ocr-owner-proof`), which reads
 * the output's /P, encryption and owner password back in Node.
 */
import path from "node:path";
import {
  resolveWorkerArtifactManifest,
  type ArtifactManifestGate,
} from "./artifacts";
import { runThroughExecutorOrder } from "./capability-chain";
import { OCR_REFUSAL_MESSAGES } from "./ocr-engine-errors";
import { createNativeOcrRunner, type NativeOcrFs } from "./ocr-native";
import { resolveNativeOcrConfig } from "./ocr-native-config";
import { createProcessorRegistry } from "./processor";
import {
  createNativeQpdfRunner,
  probeQpdf,
  type QpdfExec,
} from "./pdf-security/native";
import { resolveNativePdfSecurityConfig } from "./pdf-security/native-config";
import { resolveWorkerSoundness, type SoundnessGate } from "./soundness";
import { md5 } from "@/lib/pdf/security/md5";
import { rc4 } from "@/lib/pdf/security/rc4";

/** How the probe builds its registry: the daemon's own, unless a test swaps it. */
export type OwnerProbeRegistryBuilder = typeof createProcessorRegistry;

/** The probe file's owner password: a test value, never a person's. */
export const PROBE_OWNER_PASSWORD = "pdfxyz-probe-owner";

/**
 * The probe file's /P: print (bit 3), comments (6), forms (9) and
 * accessibility (10) granted, with the reserved bits 7, 8 and 13-32 set;
 * change (4), copy (5), assembly (11) and high-quality print (12)
 * withheld.
 */
export const PROBE_P = -3100;

/** The switches qpdf must be handed for {@link PROBE_P}, as literals. */
export const PROBE_GRANT_SWITCHES = [
  "--print=low",
  "--modify-other=n",
  "--extract=n",
  "--annotate=y",
  "--form=y",
  "--assemble=n",
] as const;

const latin1 = (text: string): Uint8Array =>
  Uint8Array.from([...text], (c) => c.charCodeAt(0));

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** ISO 32000-1 §7.6.3.3, Algorithm 2 step (a). */
const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padded(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const n = Math.min(32, password.length);
  out.set(password.subarray(0, n));
  out.set(PAD.subarray(0, 32 - n), n);
  return out;
}

/** RC4 over `data`, then 19 more rounds with the key XOR the round (R3). */
function rc4Rounds(key: Uint8Array, data: Uint8Array): Uint8Array {
  let out = rc4(key, data);
  for (let i = 1; i <= 19; i += 1)
    out = rc4(
      key.map((b) => b ^ i),
      out,
    );
  return out;
}

/** MD5, then 50 more MD5s of its first 16 bytes (R3, 128-bit). */
function md5Rounds(input: Uint8Array): Uint8Array {
  let h = md5(input);
  for (let i = 0; i < 50; i += 1) h = md5(h.subarray(0, 16));
  return h.subarray(0, 16);
}

const int32le = (n: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n, true);
  return out;
};

/**
 * A one-page PDF its author restricted ({@link PROBE_P}): RC4 128-bit,
 * revision 3, an EMPTY user password (it opens in every viewer) and
 * {@link PROBE_OWNER_PASSWORD} as its owner password — Algorithms 2, 3 and
 * 5 of ISO 32000-1 §7.6.3, with the page's content stream encrypted under
 * its object key. Built in code, so the probe carries no fixture file and
 * shares no bytes with the tests' qpdf- and pypdf-made fixtures. `p` is for
 * tests that need another grant (a /P with bit 10 clear, which neither qpdf
 * nor the fixtures write at AES-256); the probe always uses the default.
 */
export function restrictedProbePdf(p: number = PROBE_P): Uint8Array {
  const id = md5(latin1("pdf.xyz OCR owner-password probe"));
  const user = padded(new Uint8Array(0));
  // Algorithm 3: /O from the owner password.
  const ownerKey = md5Rounds(padded(latin1(PROBE_OWNER_PASSWORD)));
  const o = rc4Rounds(ownerKey, user);
  // Algorithm 2: the file key.
  const fileKey = md5Rounds(concat(user, o, int32le(p), id));
  // Algorithm 5: /U for revision 3.
  const u = concat(
    rc4Rounds(fileKey, md5(concat(PAD, id))),
    new Uint8Array(16),
  );
  // The page's content, encrypted with object 4's key.
  const objectKey = md5(
    concat(fileKey, Uint8Array.from([4, 0, 0, 0, 0])),
  ).subarray(0, 16);
  const content = rc4(objectKey, latin1("0 0 m 200 200 l S\n"));

  const head = latin1("%PDF-1.4\n");
  const objects: Uint8Array[] = [
    latin1("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    latin1("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    latin1(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
    ),
    concat(
      latin1(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`),
      content,
      latin1("\nendstream\nendobj\n"),
    ),
    latin1(
      `5 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${p} /O <${hex(o)}> /U <${hex(u)}> >>\nendobj\n`,
    ),
  ];
  const offsets: number[] = [];
  let at = head.length;
  for (const object of objects) {
    offsets.push(at);
    at += object.length;
  }
  const xref = latin1(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join(
        "",
      )}trailer\n<< /Size 6 /Root 1 0 R /Encrypt 5 0 R /ID [<${hex(id)}> <${hex(id)}>] >>\nstartxref\n${at}\n%%EOF\n`,
  );
  return concat(head, ...objects, xref);
}

/** A plain one-page PDF: the stand-ins' decrypted copy and OCR output. */
const PLAIN = latin1(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

const hasEncrypt = (bytes: Uint8Array | undefined): boolean =>
  bytes !== undefined &&
  new TextDecoder("latin1").decode(bytes).includes("/Encrypt");

/** What the two stand-in processes were handed. */
export interface OwnerProbeRecorder {
  /** Each OCRmyPDF start: whether its input still carried /Encrypt. */
  readonly ocrInputsEncrypted: boolean[];
  /** Each qpdf start: its command-line arguments and its at-file's lines. */
  readonly qpdf: { args: string[]; lines: string[] }[];
  readonly fs: NativeOcrFs;
  readonly ocrExec: (
    command: string,
    args: readonly string[],
  ) => Promise<unknown>;
  readonly qpdfExec: QpdfExec;
}

/**
 * The two stand-ins over one in-memory disk. `lie`: qpdf's `--encrypt`
 * writes the PLAIN copy, for check (4).
 */
export function ownerProbeRecorder(
  restricted: Uint8Array,
  lie = false,
): OwnerProbeRecorder {
  const files = new Map<string, Uint8Array>();
  const ocrInputsEncrypted: boolean[] = [];
  const qpdf: { args: string[]; lines: string[] }[] = [];
  let n = 0;
  const fs: NativeOcrFs = {
    mkdtemp: async (prefix) => `${prefix}probe-${(n += 1)}`,
    writeFile: async (file, data) => {
      files.set(file, Uint8Array.from(data));
    },
    readFile: async (file) => {
      const bytes = files.get(file);
      if (!bytes) throw new Error("no such file");
      return bytes;
    },
    rm: async (dir) => {
      for (const key of [...files.keys()])
        if (key.startsWith(dir)) files.delete(key);
    },
  };
  return {
    ocrInputsEncrypted,
    qpdf,
    fs,
    ocrExec: async (_command, args) => {
      const input = args.find((a) => path.basename(a).startsWith("input."));
      const output = args.find((a) => path.basename(a) === "output.pdf");
      const encrypted = hasEncrypt(input ? files.get(input) : undefined);
      ocrInputsEncrypted.push(encrypted);
      if (encrypted)
        throw Object.assign(new Error("Command failed: ocrmypdf"), {
          code: 8,
          killed: false,
          signal: null,
          stderr: "",
        });
      if (output) files.set(output, PLAIN);
      return { stdout: "", stderr: "" };
    },
    qpdfExec: async (_command, args) => {
      const atFile = args.length === 1 && args[0]!.startsWith("@");
      const lines = atFile
        ? new TextDecoder().decode(files.get(args[0]!.slice(1))).split("\n")
        : [];
      qpdf.push({ args: [...args], lines });
      const output = lines.at(-1);
      if (output && lines.includes("--decrypt")) files.set(output, PLAIN);
      else if (output && lines.includes("--encrypt"))
        files.set(output, lie ? PLAIN : restricted);
      return { code: 0, timedOut: false };
    },
  };
}

/**
 * True when this image's OCR PDF verifies a restricted PDF's owner
 * password, decrypts only then, restricts the result again (read back), and
 * refuses every other password.
 */
export async function provesOcrOwnerPassword(
  env: Record<string, string | undefined> = process.env,
  build: OwnerProbeRegistryBuilder = createProcessorRegistry,
  /** The executor's file-soundness gate, resolved as the daemon's runtime resolves it. */
  soundness: SoundnessGate = resolveWorkerSoundness(env),
  /** The executor's artifact-manifest gate, resolved as the daemon's runtime resolves it. */
  manifest: ArtifactManifestGate = resolveWorkerArtifactManifest(env),
  /** Is qpdf on this host? Presence only; the daemon's own probe by default. */
  qpdfPresent: () => boolean = () => probeQpdf(env),
): Promise<boolean> {
  try {
    if (!qpdfPresent()) return false;
    const restricted = restrictedProbePdf();
    const run = async (
      recorder: OwnerProbeRecorder,
      options: Record<string, unknown>,
    ) => {
      const ocrConfig = { ...resolveNativeOcrConfig(env), enabled: true };
      const qpdf = createNativeQpdfRunner(resolveNativePdfSecurityConfig(env), {
        exec: recorder.qpdfExec,
        fs: recorder.fs,
        resolveOnPath: () => true,
        fileExists: () => true,
      });
      const runner = createNativeOcrRunner(ocrConfig, {
        exec: recorder.ocrExec,
        fs: recorder.fs,
        resolveOnPath: () => true,
        fileExists: () => true,
        countPages: async () => 1,
        ownerCrypt: qpdf,
      });
      const registry = build({
        ocr: { engines: { ocrmypdf: true, tesseract: false }, runner },
      });
      return runThroughExecutorOrder({
        tool: "ocr-pdf",
        input: {
          bytes: restricted,
          filename: "probe.pdf",
          contentType: "application/pdf",
        },
        options: {
          languages: ["eng"],
          outputMode: "searchable-pdf",
          ...options,
        },
        registry,
        soundness,
        manifest,
      });
    };
    const viaAtFile = (r: OwnerProbeRecorder) =>
      r.qpdf.every(
        (call) =>
          call.args.length === 1 &&
          !call.args.some((a) => a.includes(PROBE_OWNER_PASSWORD)),
      );

    // (1) The owner password.
    const good = ownerProbeRecorder(restricted);
    const owned = await run(good, { ownerPassword: PROBE_OWNER_PASSWORD });
    if (owned.stage !== "delivered") return false;
    if (good.ocrInputsEncrypted.join() !== "false") return false;
    if (good.qpdf.length !== 2 || !viaAtFile(good)) return false;
    const [decrypt, encrypt] = good.qpdf.map((c) => c.lines);
    if (
      decrypt?.[0] !== `--password=${PROBE_OWNER_PASSWORD}` ||
      decrypt[1] !== "--decrypt"
    )
      return false;
    const expected = [
      "--encrypt",
      `--owner-password=${PROBE_OWNER_PASSWORD}`,
      "--bits=256",
      ...PROBE_GRANT_SWITCHES,
      "--",
    ];
    if (encrypt?.slice(0, expected.length).join("\n") !== expected.join("\n"))
      return false;
    if (encrypt.some((line) => line.startsWith("--user-password")))
      return false;

    // (2) A wrong password: refused, nothing started.
    const wrong = ownerProbeRecorder(restricted);
    const refused = await run(wrong, {
      ownerPassword: `${PROBE_OWNER_PASSWORD}-not-it`,
    });
    if (refused.stage !== "failed") return false;
    if (refused.result.error.code !== "unprocessable_entity") return false;
    if (refused.result.error.retryable) return false;
    if (
      refused.result.error.message !==
      OCR_REFUSAL_MESSAGES["wrong-owner-password"]
    )
      return false;
    if (wrong.ocrInputsEncrypted.length + wrong.qpdf.length !== 0) return false;

    // (3) Positive control: no password, the encrypted input reaches OCRmyPDF.
    const none = ownerProbeRecorder(restricted);
    const plain = await run(none, {});
    if (plain.stage !== "failed") return false;
    if (plain.result.error.message !== OCR_REFUSAL_MESSAGES.restricted)
      return false;
    if (none.ocrInputsEncrypted.join() !== "true" || none.qpdf.length !== 0)
      return false;

    // (4) The read-back: an unrestricted copy is never delivered.
    const liar = ownerProbeRecorder(restricted, true);
    const lied = await run(liar, { ownerPassword: PROBE_OWNER_PASSWORD });
    if (lied.stage !== "failed") return false;
    if (lied.result.error.code !== "unprocessable_entity") return false;
    if (lied.result.error.retryable) return false;
    if (
      lied.result.error.message !==
      OCR_REFUSAL_MESSAGES["restrictions-not-kept"]
    )
      return false;
    return liar.qpdf.length === 2;
  } catch {
    return false;
  }
}
