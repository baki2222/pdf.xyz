/**
 * Persistence for the local workspace. Only a *safe, versioned subset* of state
 * is written — tool preferences and a tool-oriented activity log. No file names,
 * sizes, ids, or bytes ever reach storage (staged files are memory-only), so the
 * persisted blob can't leak document contents even if read by another script.
 *
 * All storage access is guarded: absent storage (SSR / private mode), quota
 * errors, and corrupt JSON degrade to a clean default instead of throwing.
 * `migrate` upgrades older shapes forward via a stepwise chain, so bumping the
 * schema in future is a one-line addition to {@link MIGRATIONS}.
 */

import type { WorkspaceAction, WorkspaceState } from "./types";

export const WORKSPACE_STORAGE_KEY = "pdfxyz.workspace.v1";
export const WORKSPACE_SCHEMA_VERSION = 1;
/** Cap on persisted activity entries (also bounds the stored blob size). */
export const MAX_PERSISTED_ACTIONS = 8;

/**
 * The safe, versioned envelope written to storage. Note the absence of any file
 * field — this is the structural guarantee that we never persist file metadata.
 */
export interface PersistedWorkspace {
  version: number;
  selectedToolSlug: string | null;
  batchToolSlug: string | null;
  recentActions: WorkspaceAction[];
}

/** The subset of the Web Storage API we use — injectable for tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Project the in-memory state down to the safe, persistable envelope. */
export function toPersisted(state: WorkspaceState): PersistedWorkspace {
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    selectedToolSlug: state.selectedToolSlug,
    batchToolSlug: state.batch.toolSlug,
    // Actions are already typed (name-free by construction); just bound the count.
    recentActions: state.recentActions.slice(0, MAX_PERSISTED_ACTIONS),
  };
}

// ── Validation + migration ──────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ACTION_KINDS = new Set(["opened-tool", "queued-batch", "cleared-files"]);

/** Validate + narrow an untrusted value to a {@link WorkspaceAction}, or null. */
function coerceAction(input: unknown): WorkspaceAction | null {
  if (!isObject(input)) return null;
  const { id, kind, label, at } = input;
  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof at !== "number" ||
    !Number.isFinite(at) ||
    typeof kind !== "string" ||
    !ACTION_KINDS.has(kind)
  ) {
    return null;
  }
  const action: WorkspaceAction = {
    id,
    kind: kind as WorkspaceAction["kind"],
    label,
    at,
  };
  if (typeof input.toolSlug === "string") action.toolSlug = input.toolSlug;
  if (typeof input.fileCount === "number" && Number.isFinite(input.fileCount)) {
    action.fileCount = input.fileCount;
  }
  return action;
}

type Migration = (input: Raw) => Raw;

/**
 * Stepwise migrations keyed by the version they upgrade *from*. Add the next
 * entry when the schema changes; {@link migrate} chains them until it reaches
 * {@link WORKSPACE_SCHEMA_VERSION}.
 *
 * `0` covers any pre-versioning blob (e.g. an early `{ lastTool }` shape).
 */
const MIGRATIONS: Record<number, Migration> = {
  0: (old) => ({
    version: 1,
    selectedToolSlug:
      typeof old.selectedToolSlug === "string"
        ? old.selectedToolSlug
        : typeof old.lastTool === "string"
          ? old.lastTool
          : null,
    batchToolSlug:
      typeof old.batchToolSlug === "string" ? old.batchToolSlug : null,
    recentActions: Array.isArray(old.recentActions) ? old.recentActions : [],
  }),
};

function sourceVersion(raw: Raw): number {
  return typeof raw.version === "number" && Number.isFinite(raw.version)
    ? raw.version
    : 0;
}

/** Final shape check + field narrowing once migrations have run. */
function validate(raw: Raw): PersistedWorkspace | null {
  if (sourceVersion(raw) !== WORKSPACE_SCHEMA_VERSION) return null;
  const recentActions = Array.isArray(raw.recentActions)
    ? raw.recentActions
        .map(coerceAction)
        .filter((a): a is WorkspaceAction => a !== null)
        .slice(0, MAX_PERSISTED_ACTIONS)
    : [];
  return {
    version: WORKSPACE_SCHEMA_VERSION,
    selectedToolSlug:
      typeof raw.selectedToolSlug === "string" ? raw.selectedToolSlug : null,
    batchToolSlug:
      typeof raw.batchToolSlug === "string" ? raw.batchToolSlug : null,
    recentActions,
  };
}

/**
 * Migrate an untrusted persisted value to the current schema, or return null if
 * it can't be understood. Never throws.
 */
export function migrate(raw: unknown): PersistedWorkspace | null {
  if (!isObject(raw)) return null;
  let current: Raw = raw;
  let version = sourceVersion(current);
  while (version < WORKSPACE_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null; // unknown gap in the chain
    current = step(current);
    const next = sourceVersion(current);
    if (next <= version) break; // a migration that failed to advance — bail safely
    version = next;
  }
  return validate(current);
}

// ── Guarded storage IO ────────────────────────────────────────────────────

function resolveStorage(explicit?: StorageLike): StorageLike | null {
  if (explicit) return explicit;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Accessing localStorage can throw in sandboxed / cookie-blocked contexts.
  }
  return null;
}

/** Read + migrate the persisted workspace, or null if absent/unreadable. */
export function loadPersisted(storage?: StorageLike): PersistedWorkspace | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return migrate(parsed);
}

/** Persist the safe subset. Returns false (never throws) when it can't write. */
export function savePersisted(
  state: WorkspaceState,
  storage?: StorageLike,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(toPersisted(state)));
    return true;
  } catch {
    // Quota exceeded or storage disabled — degrade gracefully, don't crash.
    return false;
  }
}

/** Remove any persisted workspace. Never throws. */
export function clearPersisted(storage?: StorageLike): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
