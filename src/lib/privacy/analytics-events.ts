/**
 * What Google Analytics receives from a visitor who allowed it — every event
 * and every field, the list /privacy §4 renders.
 *
 * Until 2026-10-10 §4 said Google receives "the pages you view, the names of
 * tools you use". The event schema sent eight events and sixteen fields
 * besides: a size band of an in-browser result, how long a run took, why it
 * failed, where a suggestion was shown, whether a hand-off carried files.
 *
 * TYPED BY THE SCHEMA, so it cannot drift silently: the keys are
 * `EventName`, and each event's `fields` must name exactly the fields its
 * `ProductEvent` variant carries — a field added to the event without a word
 * here is a compile error, and so is a word for a field that does not exist.
 * `privacy-truth.test.tsx` reads the same union by AST and the rendered page
 * by text, so the page must SHOW what this holds.
 *
 * Copy: walked by `copyFiles()` (`src/lib/privacy`). Example band labels are
 * computed by the bucketing functions themselves, never typed.
 */
import type { EventName, ProductEvent } from "@/lib/telemetry/events";
import {
  countBucket,
  durationBucket,
  sizeBucket,
} from "@/lib/telemetry/buckets";

type FieldsOf<E extends EventName> = Exclude<
  keyof Extract<ProductEvent, { name: E }>,
  "name"
>;

export type AnalyticsEventCopy = {
  readonly [E in EventName]: {
    /** When it is sent, finishing "Sent when …". */
    readonly when: string;
    /** Each field, in a reader's words. */
    readonly fields: { readonly [K in FieldsOf<E>]-?: string };
  };
};

const MB = 1024 * 1024;
const TOOL = "which tool";
const KIND =
  "whether the tool runs in your browser, on our processing server, or with AI";

export const ANALYTICS_EVENTS: AnalyticsEventCopy = {
  tool_viewed: {
    when: "a tool page opens",
    fields: { toolSlug: TOOL, capability: KIND },
  },
  tool_completed: {
    when: "a tool finishes its work",
    fields: {
      toolSlug: TOOL,
      capability: KIND,
      inputCount: `how many files went in, as a band such as “${countBucket(3)}”`,
      outputSize: `how large the result was, as a band such as “${sizeBucket(5 * MB)}” — never the exact size`,
      duration: `how long it took, as a band such as “${durationBucket(2_000)}”`,
    },
  },
  tool_failed: {
    when: "a tool cannot finish",
    fields: {
      toolSlug: TOOL,
      capability: KIND,
      reason:
        "why, as one of a fixed list of reasons — never the error message",
    },
  },
  workspace_handoff_created: {
    when: "you pass files from the workspace to a tool",
    fields: {
      toolSlug: TOOL,
      mode: "whether one file, a batch or a collection was passed",
      fileCount: `how many files, as a band such as “${countBucket(3)}”`,
    },
  },
  suggestion_opened: {
    when: "you open a suggested tool",
    fields: {
      toolSlug: TOOL,
      source: "where the suggestion was shown",
      rank: "its place in the list: 1, 2, 3 or lower",
      carried: "whether your files went with it",
    },
  },
  worker_status_checked: {
    when: "a page asks whether our processing server is available",
    fields: {
      mode: "how the site is set up to process files",
      enabled: "whether processing is available",
    },
  },
  worker_operations_checked: {
    when: "the status page reads the processing server's health",
    fields: {
      mode: "how the site is set up to process files",
      health: "the overall health, such as “ok” or “warn”",
      recommendedAction: "the one action the status page recommends",
      drainable: "whether queued jobs can be processed",
      daemonObserved: "whether a processing server was seen running",
    },
  },
  gated_tool_interest: {
    when: "you press “Notify me” on a tool that is not built yet",
    fields: { toolSlug: TOOL, capability: KIND },
  },
  palette_opened: {
    when: "you open the search box that finds tools and guides",
    fields: {
      trigger:
        "whether you opened it with the keyboard shortcut or the button — never what you typed",
    },
  },
  upload_attempt_failed: {
    when: "sending a file to our processing server does not work on one try",
    fields: {
      toolSlug: TOOL,
      status:
        "the error number our storage service answered, such as 503, or that there was no answer — never the upload's address",
      attempt: "which try it was: 1, 2 or 3",
      retrying: "whether another try followed",
      size: `how large the file was, as a band such as “${sizeBucket(5 * MB)}” — never the exact size`,
      duration: `how long the try took, as a band such as “${durationBucket(2_000)}”`,
    },
  },
};

/** What every page view carries (`sendGa4PageView`). */
export const PAGE_VIEW_DESCRIPTION =
  "the page's address without its query string, the page's title, and the address of the previous page, also without its query string";
