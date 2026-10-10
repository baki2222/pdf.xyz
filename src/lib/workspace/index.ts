/**
 * Barrel for the anonymous local workspace model. Import from `@/lib/workspace`
 * rather than reaching into individual files.
 */

export type {
  BatchQueue,
  FileFamily,
  WorkspaceAction,
  WorkspaceActionKind,
  WorkspaceFile,
  WorkspaceState,
} from "./types";
export { FILE_FAMILIES } from "./types";

export {
  createWorkspaceFile,
  extensionOf,
  fileFamily,
  fileKind,
  type FileMetaInput,
} from "./classify";

export {
  emptyWorkspace,
  MAX_RECENT_ACTIONS,
  planBatch,
  workspaceReducer,
  type BatchPlan,
  type BatchStatus,
  type BatchToolInfo,
  type WorkspaceEvent,
} from "./state";

export {
  clearPersisted,
  loadPersisted,
  MAX_PERSISTED_ACTIONS,
  migrate,
  savePersisted,
  toPersisted,
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_STORAGE_KEY,
  type PersistedWorkspace,
  type StorageLike,
} from "./storage";
