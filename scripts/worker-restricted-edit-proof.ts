/**
 * `pnpm worker:restricted-edit-proof` — the in-browser restricted-PDF save
 * (`src/lib/pdf/security`) read back by REAL qpdf, inside the built worker
 * image (the one place qpdf is installed).
 *
 * For an AES-256 (R6) and an AES-128 (R4) file that qpdf itself encrypts
 * from a generated form — empty user password, a proof-only owner password,
 * "fill in the form and comment, nothing else", object streams on — it fills
 * the form the way Edit PDF does without the owner password, then asks qpdf:
 *
 *  - `--check`: the update is structurally sound (exit 0; 3 = warnings fails);
 *  - `--show-encryption`: the SAME R, P and methods as the input, and the
 *    owner password is still the owner password;
 *  - `--json` acroform: the typed values are what qpdf decrypts.
 *
 * and, as the control, the same save with the new objects written
 * UNENCRYPTED must NOT give the typed values back — so the read-back can fail.
 *
 * Exit codes: 0 = proven; 1 = a check failed; 2 = qpdf is not in this image.
 * Run by `.github/workflows/container.yml`. No secret, queue, store or user
 * document is touched; the owner password is a fixed proof value.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportEditedPdf } from "@/lib/pdf/editor-export";
import { DEFAULT_TEXT_STYLE } from "@/lib/pdf/editor/model";
import { openProtectedPdf } from "@/lib/pdf/security/protected-pdf";
import { StandardSecurityHandler } from "@/lib/pdf/security/standard-handler";
import { QPDF_EXIT_WARNINGS, qpdfWroteOutput } from "@/lib/workers/qpdf-exit";
import { makeRestrictedBase } from "@/tests/fixtures/restricted-pdf/make-base";

const OWNER = "proof-owner-password";
const FILLS = { full_name: "Ada Lovelace", agree: true, country: "Japan" };

interface Run {
  code: number;
  timedOut: boolean;
  stdout: string;
}

function qpdf(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      "qpdf",
      args,
      { timeout: 60_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error: (Error & { code?: unknown; killed?: boolean }) | null, stdout) =>
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : -1,
          timedOut: error?.killed === true,
          stdout: typeof stdout === "string" ? stdout : "",
        }),
    );
  });
}

/** The lines of `--show-encryption` that describe the lock, not the file. */
function lockLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) =>
      /^(R|P|V) = |^(stream|string|file) encryption method|^User password = $/.test(
        l,
      ),
    );
}

/** Field name → value, as qpdf's JSON decrypts them. */
function acroformValues(stdout: string): Record<string, unknown> {
  const json = JSON.parse(stdout) as {
    acroform?: { fields?: { fullname?: string; value?: unknown }[] };
  };
  const out: Record<string, unknown> = {};
  // JSON v2 writes a text string as "u:<text>" (and binary as "b:<hex>").
  const text = (v: unknown) =>
    typeof v === "string" && v.startsWith("u:") ? v.slice(2) : v;
  for (const f of json.acroform?.fields ?? [])
    if (f.fullname) out[f.fullname.replace(/^u:/, "")] = text(f.value);
  return out;
}

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures += 1;
}

async function save(input: Uint8Array): Promise<Uint8Array> {
  const opened = await openProtectedPdf(input);
  if (opened.kind !== "opened")
    throw new Error(`could not open: ${opened.kind}`);
  const edited = await exportEditedPdf(opened.pdf.plain, [], undefined, {
    fills: FILLS,
  });
  return (await opened.pdf.saveChanges(edited.bytes)).bytes;
}

const NOTE = "Proof comment: reviewed";

/** A highlight and a note, saved as comments — Edit PDF's restricted markup. */
async function saveComments(input: Uint8Array): Promise<Uint8Array> {
  const opened = await openProtectedPdf(input);
  if (opened.kind !== "opened")
    throw new Error(`could not open: ${opened.kind}`);
  const edited = await exportEditedPdf(
    opened.pdf.plain,
    [
      {
        id: "h",
        kind: "highlight",
        page: 0,
        x: 60,
        y: 60,
        width: 200,
        height: 20,
        color: "#facc15",
        opacity: 0.4,
      },
      {
        ...DEFAULT_TEXT_STYLE,
        id: "n",
        kind: "note",
        page: 0,
        x: 320,
        y: 60,
        width: 180,
        size: 11,
        text: NOTE,
        fill: "#fef08a",
      },
    ],
    undefined,
    { markups: "comments" },
  );
  return (await opened.pdf.saveChanges(edited.bytes)).bytes;
}

/** Each annotation's subtype and decrypted /Contents, from qpdf's JSON. */
function annotationsOf(
  stdout: string,
): { subtype: string; contents: string }[] {
  const json = JSON.parse(stdout) as {
    qpdf?: [unknown, Record<string, { value?: Record<string, unknown> }>];
  };
  const objects = json.qpdf?.[1] ?? {};
  const text = (v: unknown) =>
    typeof v === "string" ? v.replace(/^u:/, "") : "";
  return Object.values(objects).flatMap((o) => {
    const v = o.value;
    if (!v || v["/Type"] !== "/Annot") return [];
    return [{ subtype: String(v["/Subtype"]), contents: text(v["/Contents"]) }];
  });
}

async function main(): Promise<number> {
  const version = await qpdf(["--version"]);
  // Any answer at all, warnings included (qpdf-exit's 0-or-3).
  if (!qpdfWroteOutput(version)) {
    console.log("qpdf is not available in this image");
    return 2;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "pdfxyz-restricted-proof-"));
  try {
    const base = path.join(dir, "base.pdf");
    await writeFile(base, await makeRestrictedBase());
    for (const [label, bits] of [
      ["R6 AES-256", ["256"]],
      ["R4 AES-128", ["128", "--use-aes=y"]],
    ] as const) {
      const input = path.join(dir, `in-${bits[0]}.pdf`);
      const output = path.join(dir, `out-${bits[0]}.pdf`);
      const enc = await qpdf([
        "--object-streams=generate",
        base,
        input,
        "--encrypt",
        "",
        OWNER,
        bits[0],
        ...bits.slice(1),
        "--print=full",
        "--extract=n",
        "--assemble=n",
        "--annotate=y",
        "--form=y",
        "--modify-other=n",
        "--accessibility=y",
        "--",
      ]);
      check(qpdfWroteOutput(enc), `${label}: qpdf encrypted the form`);
      const inBytes = new Uint8Array(await readFile(input));
      const before = await qpdf(["--show-encryption", input]);
      check(
        lockLines(before.stdout).includes("P = -1052"),
        `${label}: input grants fill + comment only (P = -1052)`,
      );

      await writeFile(output, await save(inBytes));
      const checked = await qpdf(["--check", output]);
      // Clean, not merely written: warnings (qpdf-exit's 3) fail this one.
      const clean =
        qpdfWroteOutput(checked) && checked.code !== QPDF_EXIT_WARNINGS;
      check(clean, `${label}: qpdf --check is clean (exit ${checked.code})`);
      const after = await qpdf(["--show-encryption", output]);
      check(
        JSON.stringify(lockLines(after.stdout)) ===
          JSON.stringify(lockLines(before.stdout)) &&
          lockLines(after.stdout).length >= 3,
        `${label}: same encryption and permissions as the input`,
      );
      const owner = await qpdf([
        `--password=${OWNER}`,
        "--show-encryption",
        output,
      ]);
      check(
        /Supplied password is owner password/.test(owner.stdout),
        `${label}: the owner password is still the owner password`,
      );
      const json = await qpdf(["--json", "--json-key=acroform", output]);
      const values = acroformValues(json.stdout);
      check(
        values.full_name === FILLS.full_name &&
          values.country === FILLS.country,
        `${label}: qpdf decrypts the typed values`,
      );

      // Comments: a highlight and a note, the page's /Annots rewritten and
      // nothing else of the page (the grant includes --annotate=y).
      const annotated = path.join(dir, `comments-${bits[0]}.pdf`);
      await writeFile(annotated, await saveComments(inBytes));
      const aChecked = await qpdf(["--check", annotated]);
      check(
        qpdfWroteOutput(aChecked) && aChecked.code !== QPDF_EXIT_WARNINGS,
        `${label}: comments — qpdf --check is clean (exit ${aChecked.code})`,
      );
      const aLock = await qpdf(["--show-encryption", annotated]);
      check(
        JSON.stringify(lockLines(aLock.stdout)) ===
          JSON.stringify(lockLines(before.stdout)),
        `${label}: comments — same encryption and permissions as the input`,
      );
      const aJson = await qpdf(["--json", "--json-key=qpdf", annotated]);
      const annots = qpdfWroteOutput(aJson) ? annotationsOf(aJson.stdout) : [];
      check(
        annots.some((a) => a.subtype === "/Highlight") &&
          annots.some((a) => a.subtype === "/FreeText" && a.contents === NOTE),
        `${label}: comments — qpdf decrypts a /Highlight and the note's /FreeText`,
      );

      // CONTROL: the new objects unencrypted must not read back.
      const real = StandardSecurityHandler.prototype.encrypt;
      StandardSecurityHandler.prototype.encrypt = async (_k, _n, _g, data) =>
        data;
      try {
        const control = path.join(dir, `control-${bits[0]}.pdf`);
        await writeFile(control, await save(inBytes));
        const cj = await qpdf(["--json", "--json-key=acroform", control]);
        const cv = qpdfWroteOutput(cj) ? acroformValues(cj.stdout) : {};
        check(
          cv.full_name !== FILLS.full_name,
          `${label}: CONTROL — unencrypted objects do not read back`,
        );
        const ca = path.join(dir, `control-comments-${bits[0]}.pdf`);
        await writeFile(ca, await saveComments(inBytes));
        const caJson = await qpdf(["--json", "--json-key=qpdf", ca]);
        const caNotes = qpdfWroteOutput(caJson)
          ? annotationsOf(caJson.stdout)
          : [];
        check(
          !caNotes.some((a) => a.contents === NOTE),
          `${label}: CONTROL — an unencrypted note does not read back`,
        );
      } finally {
        StandardSecurityHandler.prototype.encrypt = real;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
