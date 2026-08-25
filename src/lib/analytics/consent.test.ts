// @vitest-environment jsdom
/**
 * The consent store is the switch the entire analytics stack obeys, so its
 * three states — granted, denied, never-answered — must be unambiguous, and
 * "never answered" must be indistinguishable from "storage refused to answer":
 * both mean load nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_STORAGE_KEY,
  readStoredConsent,
  storeConsent,
  subscribeToConsent,
} from "./consent";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readStoredConsent", () => {
  it("is null before any decision", () => {
    expect(readStoredConsent()).toBeNull();
  });

  it("round-trips both decisions", () => {
    storeConsent("granted");
    expect(readStoredConsent()).toBe("granted");
    storeConsent("denied");
    expect(readStoredConsent()).toBe("denied");
  });

  it("treats a corrupted stored value as undecided, not as consent", () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "yes-please");
    expect(readStoredConsent()).toBeNull();
  });

  it("treats refused storage as undecided — load nothing, ask again", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied by browser");
    });
    expect(readStoredConsent()).toBeNull();
  });
});

describe("subscribeToConsent", () => {
  it("wakes subscribers on a same-tab decision, and stops after unsubscribe", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToConsent(onChange);
    storeConsent("granted");
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    storeConsent("denied");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("wakes subscribers on a cross-tab storage event for our key", () => {
    const onChange = vi.fn();
    subscribeToConsent(onChange);
    window.dispatchEvent(
      new StorageEvent("storage", { key: CONSENT_STORAGE_KEY }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
