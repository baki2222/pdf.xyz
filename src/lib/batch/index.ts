/**
 * Barrel for the in-browser batch runner model. Import from `@/lib/batch`.
 */

export type {
  BatchItem,
  BatchItemStatus,
  BatchPhase,
  BatchProgress,
  BatchSeed,
  BatchState,
} from "./types";

export {
  batchProgress,
  batchReducer,
  initBatch,
  isBatchSettled,
  type BatchEvent,
} from "./machine";
