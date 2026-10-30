/**
 * Everything this site keeps in a visitor's browser: the key, where it
 * lives, what it holds and how long — the registry `/privacy` §5 renders.
 *
 * Each key is IMPORTED from the module that writes it, never retyped, and
 * `browser-storage.test.ts` discovers every storage call in the code and
 * holds this list to it both ways: a store the code uses and this does not
 * name fails, and so does a name here that no code uses.
 *
 * Google Analytics' own cookies are not here: they belong to Google, are set
 * only after consent, and §5 describes them in their own paragraph.
 *
 * Copy lives here, so this file is in the copy guards' walk (`copyFiles()`
 * lists it by name). Every figure is derived from the constant that enforces
 * it.
 */
import { CONSENT_STORAGE_KEY } from "@/lib/analytics/consent-key";
import { HANDOFF_CARRY_KEY } from "@/lib/handoff/carry-key";
import { HANDOFF_DB_NAME } from "@/lib/handoff/db-name";
import { HANDOFF_LIFETIME } from "@/lib/handoff/lifetime";
import { OPTIONS_STORAGE_KEY } from "@/lib/intent/options-key";
import { RECENTS_STORAGE_KEY } from "@/lib/intent/recents-key";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_JOB_STORAGE_PREFIX } from "@/lib/workers/job-resume-key";
import { WORKSPACE_STORAGE_KEY } from "@/lib/workspace/storage";
import { SAVED_SIGNATURES_KEY } from "@/lib/pdf/editor/saved-signatures";

export type StorageArea = "localStorage" | "sessionStorage" | "IndexedDB";

export interface BrowserStore {
  /** The key, or for a per-tool store the prefix the tool's slug follows. */
  readonly key: string;
  /** One key per tool: `key` is a prefix. */
  readonly perTool: boolean;
  readonly area: StorageArea;
  /** What it holds, in a sentence a privacy page can show. */
  readonly holds: string;
  /** How long it lasts. */
  readonly lasts: string;
}

export { HANDOFF_LIFETIME };

export const BROWSER_STORAGE: readonly BrowserStore[] = [
  {
    key: CONSENT_STORAGE_KEY,
    perTool: false,
    area: "localStorage",
    holds:
      "Your analytics choice — allowed or declined — so the banner asks only once.",
    lasts: "Until you change it here or clear this site's data.",
  },
  {
    key: WORKSPACE_STORAGE_KEY,
    perTool: false,
    area: "localStorage",
    holds:
      "The tools you chose in the workspace and a short log of what you opened there. Never a file, a file name or a file size.",
    lasts:
      "Until you press Clear session in the workspace or clear this site's data.",
  },
  {
    key: RECENTS_STORAGE_KEY,
    perTool: false,
    area: "localStorage",
    holds:
      "Which tools recently finished a job in this browser, and when, so the home page can offer them again. Never a file, a file name or anything a file holds.",
    lasts:
      "Until you clear this site's data. Only the most recent few are kept.",
  },
  {
    key: OPTIONS_STORAGE_KEY,
    perTool: false,
    area: "localStorage",
    holds:
      "The settings you last chose for where page numbers or a header go, a watermark's opacity and angle, and an image resolution — so the next file opens set the same way. Only choices from fixed lists and numbers: never a file, a file name, or any words you typed, such as a watermark's text.",
    lasts: "Until you clear this site's data.",
  },
  {
    key: SAVED_SIGNATURES_KEY,
    perTool: false,
    area: "localStorage",
    holds:
      "Signatures you chose to keep with “Save for next time” in Sign PDF, Edit PDF or Annotate PDF: a typed name and its style, or a picture of a signature you drew or picked. It is written only when you tick that box, and it is never uploaded.",
    lasts:
      "Until you delete it in the signature panel or clear this site's data. Only the most recent few are kept.",
  },
  {
    key: HANDOFF_DB_NAME,
    perTool: false,
    area: "IndexedDB",
    holds:
      "Files you pass from one page to a tool — from the workspace or the home page's drop zone — while they travel, with where they came from.",
    lasts: HANDOFF_LIFETIME,
  },
  {
    key: HANDOFF_CARRY_KEY,
    perTool: false,
    area: "sessionStorage",
    holds:
      "The random key to files on their way to the next page, and which page that is — so the key never has to be in a web address. Never a file, its name or its size.",
    lasts: "Until that page opens and reads it, or until this tab closes.",
  },
  {
    key: WORKER_JOB_STORAGE_PREFIX,
    perTool: true,
    area: "sessionStorage",
    holds:
      "The id of a secure-server job that may still be running, so a reload can keep waiting for it. Never the file, its name, your options or a password.",
    lasts: `Until the job's result expires, after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, or until this tab closes.`,
  },
];
