"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  claimHandoff,
  eligibleFilesFor,
  handoffEntriesToFiles,
  looksLikeHandoffId,
  purgeExpiredHandoffs,
} from "@/lib/handoff";

/**
 * Client hook that lets a tool runner receive files handed off from `/workspace`.
 * On mount it reads a `?handoff=<id>` token from the URL, claims the matching
 * record from the browser-local handoff store (single-use, so it's consumed),
 * and narrows the files to the ones this tool can actually open.
 *
 * Everything stays in the browser — the token references origin-private storage,
 * never a server. The `?handoff` param is stripped immediately so a reload can't
 * retry a consumed/expired claim and the URL stays clean and shareable-free.
 */

export type HandoffStatus =
  | "idle" // no handoff in the URL → behave as a normal picker
  | "loading" // claiming from local storage
  | "ready" // files claimed and ready to preload
  | "expired" // the handoff was missing/expired/unreadable
  | "incompatible"; // claimed, but none of the files work with this tool

export interface ToolHandoff {
  status: HandoffStatus;
  /** Eligible files to preload; non-empty only when `status === "ready"`. */
  files: File[];
  /** Files dropped because they aren't compatible with this tool. */
  skipped: number;
  /** Total files the handoff carried (eligible + skipped). */
  claimed: number;
  /** Dismiss an expired/incompatible notice and fall back to the picker. */
  dismiss: () => void;
}

const PARAM = "handoff";

const IDLE: Omit<ToolHandoff, "dismiss"> = {
  status: "idle",
  files: [],
  skipped: 0,
  claimed: 0,
};

/** Read a validated handoff id from the current URL, or null. */
function readHandoffId(): string | null {
  try {
    const id = new URLSearchParams(window.location.search).get(PARAM);
    return id && looksLikeHandoffId(id) ? id : null;
  } catch {
    return null;
  }
}

/** Drop the `?handoff=` param from the address bar without navigating. */
function stripHandoffParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // history/URL can be unavailable in exotic embeddings — safe to ignore.
  }
}

/**
 * @param slug the tool this runner implements, or `undefined` to disable the
 *   hook (used when a parent already claimed the handoff and passes it down).
 */
export function useToolHandoff(slug: string | undefined): ToolHandoff {
  const [state, setState] = useState<Omit<ToolHandoff, "dismiss">>(IDLE);
  // Claims exactly once, even under React StrictMode's double-invoked effects.
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!slug || startedRef.current) return;
    startedRef.current = true;

    const id = readHandoffId();
    stripHandoffParam();
    if (!id) return; // no token → stay idle (normal file picker), no storage touch

    // We're already opening the store to claim; sweep any expired records too.
    void purgeExpiredHandoffs();
    queueMicrotask(() => {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, status: "loading" }));
      }
    });
    claimHandoff(id)
      .then((record) => {
        if (!mountedRef.current) return;
        if (!record || record.toolSlug !== slug) {
          setState({ status: "expired", files: [], skipped: 0, claimed: 0 });
          return;
        }
        const claimed = record.files.length;
        const files = handoffEntriesToFiles(eligibleFilesFor(slug, record.files));
        const skipped = claimed - files.length;
        setState(
          files.length === 0
            ? { status: "incompatible", files: [], skipped, claimed }
            : { status: "ready", files, skipped, claimed },
        );
      })
      .catch(() => {
        if (mountedRef.current) {
          setState({ status: "expired", files: [], skipped: 0, claimed: 0 });
        }
      });
  }, [slug]);

  const dismiss = useCallback(() => setState(IDLE), []);

  return { ...state, dismiss };
}
