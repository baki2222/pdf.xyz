"use client";

import { Gauge, Loader2, RefreshCw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { RecoverableError } from "./status-ui";
import { OperationsSnapshotView } from "./operations-ui";
import { useWorkerOperations } from "./use-worker-operations";

/**
 * The **worker operations dashboard** — the operator-facing half of `/status`.
 *
 * It reads the honest, content-free `/api/worker/operations` snapshot live and
 * renders the one thing an operator (or a pager) needs: the overall SLO health, the
 * single recommended next action, a per-subsystem breakdown, the lifecycle
 * verification rung, the engine proof tri-states, and — always, from this web
 * vantage — the caveat that this app cannot observe a running worker process.
 *
 * This is the data-fetching shell; every honesty guarantee lives one layer down in
 * {@link OperationsSnapshotView}, which renders exclusively from bounded enums mapped
 * to client-authored copy. A fetch failure is recoverable (with a retry), never a
 * dead end — and the user-facing capability summary above it is unaffected.
 */
export function WorkerOperationsDashboard() {
  const { phase, snapshot, retry } = useWorkerOperations();

  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="worker-operations-heading"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="worker-operations-heading"
          className="text-faint kicker inline-flex items-center gap-2"
        >
          <Gauge className="text-faint size-4" aria-hidden />
          Worker operations
        </h2>
        <p className="text-muted max-w-2xl text-sm leading-relaxed">
          The operator&apos;s view of the secure-worker stack — is it healthy,
          and what is the one next action? Read live from the content-free
          operations snapshot. It reports on capabilities and configuration
          only, never on your files.
        </p>
      </div>

      {phase === "loading" && (
        <div
          className="bg-panel border-line text-muted rounded-panel flex items-center gap-2 border p-5 text-sm"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Reading the worker operations snapshot…
        </div>
      )}

      {phase === "error" && (
        <RecoverableError
          title="Couldn't reach the operations endpoint"
          message="We couldn't read the worker operations snapshot just now. This doesn't mean a worker is down — only that this dashboard couldn't reach the endpoint. The capability summary above is unaffected."
          onRetry={retry}
          retryLabel="Retry"
        />
      )}

      {phase === "ready" && snapshot && (
        <OperationsSnapshotView
          snapshot={snapshot}
          header={
            <div className="flex justify-end">
              <button
                type="button"
                onClick={retry}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Refresh
              </button>
            </div>
          }
        />
      )}
    </section>
  );
}
