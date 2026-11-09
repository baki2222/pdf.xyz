import { useContext, type ReactNode } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ToolRunProvider } from "@/components/tools/runner/tool-context";
import type { ContinuePlan } from "@/lib/intent/next-steps";
import { toolRunInfoFor } from "@/lib/tools/tool-run-info";
import type { Tool } from "@/lib/tools/types";
import { withAppRouter } from "./app-router";

/**
 * A panel or runner mounted as its tool page mounts it: inside the page's
 * job, built from the row the server computes (`toolRunInfoFor`), and inside
 * the App Router (a result card in a job draws "Continue with", which reads
 * the router) — the test's own router when it gave one, spies otherwise.
 *
 * Since 2026-11-09 (perf/per-tool-first-load) a worker panel's pick check
 * reads its ceiling and converters from that row (`ToolRun.pick`) instead of
 * computing them in the browser, and throws without it — so a test that
 * picks a file renders the panel here. The plan is empty unless given: a
 * test that rendered the panel alone saw no "Continue with", and still
 * does.
 */
export function InToolPage({
  tool,
  plan = { targets: [] },
  children,
}: {
  tool: Tool;
  plan?: ContinuePlan;
  children?: ReactNode;
}) {
  const router = useContext(AppRouterContext);
  const job = (
    <ToolRunProvider tool={toolRunInfoFor(tool)} plan={plan}>
      {children}
    </ToolRunProvider>
  );
  return router ? job : withAppRouter(job);
}
