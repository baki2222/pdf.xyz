"use client";

import type { RunnerKind } from "@/lib/pdf/registry";
import { MergeRunner } from "./merge-runner";
import { SplitRunner } from "./split-runner";
import { RotateRunner } from "./rotate-runner";
import { OrganizeRunner } from "./organize-runner";
import { PageSelectRunner } from "./page-select-runner";

/**
 * Client-side dispatcher: renders the interactive runner for a supported tool.
 * The dynamic tool page decides whether a tool is supported (via the registry)
 * and, if so, mounts this component in place of the placeholder upload panel.
 */
export function ToolRunner({ kind }: { kind: RunnerKind }) {
  switch (kind) {
    case "merge":
      return <MergeRunner />;
    case "split":
      return <SplitRunner />;
    case "rotate":
      return <RotateRunner />;
    case "extract-pages":
      return <PageSelectRunner mode="extract" />;
    case "delete-pages":
      return <PageSelectRunner mode="delete" />;
    case "organize":
      return <OrganizeRunner />;
    default:
      return null;
  }
}
