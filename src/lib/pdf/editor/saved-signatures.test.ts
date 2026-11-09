// @vitest-environment node
/**
 * Audit #50 (sign-pdf#7, 2026-11-06): "Save for next time" failed silently.
 * A storage that refused the write (full, or site data blocked) still had
 * the new signature returned and shown as saved, though it was gone on the
 * next visit; a picture over the size cap was dropped with no word. What the
 * panel shows must be what is stored, and a save that did not happen must
 * say so.
 */
import { describe, expect, it } from "vitest";
import { readSavedSignatures, saveSignature } from "./saved-signatures";

function memoryStorage(opts: { refuseWrites?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => {
      if (opts.refuseWrites)
        throw new DOMException("quota exceeded", "QuotaExceededError");
      map.set(k, v);
    },
  };
}

const typed = {
  kind: "typed",
  text: "Ada Lovelace",
  style: "signature",
} as const;

describe("saveSignature reports what it kept", () => {
  it("control: a working storage keeps the signature, and the list is what is stored", () => {
    const storage = memoryStorage();
    const result = saveSignature(typed, storage);
    expect(result.kept).toBe(true);
    expect(result.list).toHaveLength(1);
    expect(result.list).toEqual(readSavedSignatures(storage));
  });

  it("a storage that refuses the write is reported, and nothing unsaved is listed", () => {
    const storage = memoryStorage({ refuseWrites: true });
    const result = saveSignature(typed, storage);
    expect(readSavedSignatures(storage)).toEqual([]);
    expect(result.list).toEqual(readSavedSignatures(storage));
    expect(result).toMatchObject({ kept: false, reason: "storage" });
  });

  it("no storage at all (a private window that throws on access) is reported", () => {
    const result = saveSignature(typed, undefined);
    expect(result).toMatchObject({ kept: false, reason: "storage", list: [] });
  });

  it("a picture over the size cap is reported as too large", () => {
    const storage = memoryStorage();
    const bytes = new Uint8Array(500_000).fill(0x41);
    const result = saveSignature(
      { kind: "image", sig: { kind: "image", format: "png", bytes } },
      storage,
    );
    expect(result).toMatchObject({
      kept: false,
      reason: "too_large",
      list: [],
    });
    expect(readSavedSignatures(storage)).toEqual([]);
  });
});

/*
 * Audit sign-pdf#1 (2026-11-09): the reader of a stored entry checked its
 * style against "signature" or "print", typed out. A signature saved in a
 * handwriting style would have been dropped as unreadable on the next visit.
 * Every offered style must survive the round trip — discovered from the
 * model, not listed here — and a style the product never offered must not.
 */
describe("every offered style survives a save and a reload", () => {
  it("each style round-trips; an unknown one is dropped", async () => {
    const { SIGNATURE_STYLES } = await import("@/lib/pdf/offered-kinds");
    expect(SIGNATURE_STYLES.length).toBeGreaterThanOrEqual(5);
    for (const style of SIGNATURE_STYLES) {
      const storage = memoryStorage();
      saveSignature({ ...typed, style }, storage);
      expect(readSavedSignatures(storage), style).toMatchObject([
        { kind: "typed", style },
      ]);
    }
    const storage = memoryStorage();
    saveSignature(typed, storage);
    const raw = storage.getItem(storage.key(0)!)!;
    storage.setItem(storage.key(0)!, raw.replace('"signature"', '"comic"'));
    expect(readSavedSignatures(storage)).toEqual([]);
  });
});
