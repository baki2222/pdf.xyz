// @vitest-environment node
/**
 * A PASSWORD-LOCKED OPENDOCUMENT FILE IS NAMED AS ONE, BEFORE LIBREOFFICE RUNS.
 *
 * Until 2026-11-04 a locked .odt/.ods/.odp passed the content check (it is
 * still a ZIP with its own `mimetype` first), soffice exited 0 with no PDF,
 * and the job ended `unreadable` with advice about Word and ".docx". The
 * fixtures are files LibreOffice itself locked, in the worker image
 * (`src/tests/odf-locked-fixtures/PROVENANCE.txt`).
 *
 * The property is read twice: by `isEncryptedOdf`'s own ZIP walk, and — as
 * the health check that the fixtures are what they claim — by JSZip, an
 * independent reader. A detector and its fixture that agree only with each
 * other prove nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { isEncryptedOdf, isEncryptedOoxml } from "./errors";
import { OFFICE_INPUT_FIXTURES } from "@/tests/office-input-fixtures";

const DIR = "src/tests/odf-locked-fixtures";
const read = (name: string) => new Uint8Array(readFileSync(`${DIR}/${name}`));
const LOCKED = ["locked.odt", "locked.ods", "locked.odp"] as const;

/** The sha256 lines PROVENANCE.txt records, as name → hash. */
function recordedHashes(): Map<string, string> {
  const text = readFileSync(`${DIR}/PROVENANCE.txt`, "utf8");
  return new Map(
    [...text.matchAll(/^\s+([0-9a-f]{64})\s+(\S+)$/gm)].map((m) => [
      m[2]!,
      m[1]!,
    ]),
  );
}

async function manifestByJsZip(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("META-INF/manifest.xml")!.async("string");
}

/** A minimal ODF-shaped ZIP whose manifest is `manifest`, stored or deflated. */
async function odfZip(
  manifest: string | Uint8Array,
  compression: "STORE" | "DEFLATE",
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", {
    compression: "STORE",
  });
  zip.file("content.xml", "<office:document-content/>");
  zip.file("META-INF/manifest.xml", manifest, { compression });
  return zip.generateAsync({ type: "uint8array" });
}

const ENCRYPTED_MANIFEST =
  '<manifest:manifest><manifest:file-entry manifest:full-path="content.xml"><manifest:encryption-data manifest:checksum-type="SHA256"/></manifest:file-entry></manifest:manifest>';

describe("isEncryptedOdf", () => {
  it("health: the fixtures are the files PROVENANCE records, and a second reader sees the lock", async () => {
    const hashes = recordedHashes();
    expect([...hashes.keys()].sort()).toEqual([...LOCKED, "open.odt"].sort());
    for (const [name, hash] of hashes)
      expect(createHash("sha256").update(read(name)).digest("hex"), name).toBe(
        hash,
      );
    // As counted in the image on 2026-11-04 (PROVENANCE.txt): Impress
    // encrypts two parts fewer than Writer and Calc.
    const counts: Record<string, number> = {};
    for (const name of [...LOCKED, "open.odt"])
      counts[name] =
        (await manifestByJsZip(read(name))).match(/encryption-data/g)?.length ??
        0;
    expect(counts).toEqual({
      "locked.odt": 10,
      "locked.ods": 10,
      "locked.odp": 8,
      "open.odt": 0,
    });
  });

  it("is true for each file LibreOffice locked, and false for its unlocked twin", () => {
    expect(LOCKED.filter((n) => !isEncryptedOdf(read(n)))).toEqual([]);
    expect(isEncryptedOdf(read("open.odt"))).toBe(false);
  });

  it("is false for every unlocked Office fixture the in-image proof converts", async () => {
    const built = await Promise.all(
      OFFICE_INPUT_FIXTURES.map(async (f) => ({
        name: f.name,
        bytes: await f.build(),
      })),
    );
    expect(built.length).toBeGreaterThanOrEqual(4);
    expect(
      built.filter((f) => isEncryptedOdf(f.bytes)).map((f) => f.name),
    ).toEqual([]);
  });

  it("reads a stored manifest as well as a deflated one", async () => {
    expect(isEncryptedOdf(await odfZip(ENCRYPTED_MANIFEST, "STORE"))).toBe(
      true,
    );
    expect(isEncryptedOdf(await odfZip(ENCRYPTED_MANIFEST, "DEFLATE"))).toBe(
      true,
    );
    expect(
      isEncryptedOdf(await odfZip("<manifest:manifest/>", "DEFLATE")),
    ).toBe(false);
  });

  it("says 'cannot tell' (false) rather than throwing on what is not a readable ODF", async () => {
    const locked = read("locked.odt");
    // No end-of-central-directory record: the tail cut off.
    expect(isEncryptedOdf(locked.subarray(0, locked.length - 200))).toBe(false);
    // A central directory that points past the file.
    const bad = locked.slice();
    const eocd = bad.length - 22;
    bad[eocd + 16] = 0xff;
    bad[eocd + 17] = 0xff;
    bad[eocd + 18] = 0xff;
    expect(isEncryptedOdf(bad)).toBe(false);
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array(21),
      new TextEncoder().encode("{\\rtf1 hello}"),
    ])
      expect(isEncryptedOdf(bytes)).toBe(false);
  });

  it("does not inflate a manifest past its ceiling", async () => {
    // 4 MB of a repeated entry: tiny deflated, four times the ceiling inflated.
    const huge = new TextEncoder().encode(
      ENCRYPTED_MANIFEST.repeat(
        Math.ceil((4 << 20) / ENCRYPTED_MANIFEST.length),
      ),
    );
    expect(deflateRawSync(huge).length).toBeLessThan(64 * 1024);
    const zip = await odfZip(huge, "DEFLATE");
    const started = Date.now();
    expect(isEncryptedOdf(zip)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not claim an encrypted OOXML package, and the OOXML check does not claim a locked ODF", () => {
    // Each detector reads its own container: a CFB for OOXML, a ZIP for ODF.
    for (const name of LOCKED) expect(isEncryptedOoxml(read(name))).toBe(false);
  });
});
