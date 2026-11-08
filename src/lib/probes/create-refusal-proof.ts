/**
 * The deployment proof's verdict for an option the WEB TIER must refuse at
 * job creation (review 2026-11-08: Excel to PDF's layout, PDF to PDF/A's
 * level, Webpage to PDF's capture options), before the upload is spent and
 * the queue waited on.
 *
 * What the deployed route must answer is not typed here. It is DERIVED from
 * `parseCreateJobRequest`, the function the route runs, asked about the same
 * request body: its status, error code and field name are the expected
 * answer. So a parser change on this branch moves the proof with it, and a
 * bag the parser accepts is reported as a spec that proves nothing (health),
 * never as a pass.
 *
 * A web tier older than these checks accepts the request and creates a job
 * (2xx): the defect, and a FAIL here. A refusal with the right status for
 * another reason (a different field) fails too, because a 422 is not
 * evidence about the option it does not name.
 *
 * Pure (the shared parser only, no network), so the unit tests and
 * `scripts/worker-prove-tools.ts` ask the same question.
 */
import { parseCreateJobRequest } from "@/lib/jobs/validation";

export interface ExpectedCreateRefusal {
  status: number;
  code: string;
  field: string | undefined;
}

/** What the route answers for `body`, or null when its parser accepts it. */
export function expectedCreateRefusal(
  body: unknown,
): ExpectedCreateRefusal | null {
  const parsed = parseCreateJobRequest(body);
  if (parsed.ok) return null;
  return {
    status: parsed.error.status,
    code: parsed.error.body.error.code,
    field: parsed.error.body.error.details?.[0]?.field,
  };
}

interface ServedBody {
  jobId?: string;
  id?: string;
  error?: {
    code?: string;
    message?: string;
    details?: { field?: string }[];
  };
}

export function createRefusalVerdict(
  expected: ExpectedCreateRefusal | null,
  got: { status: number; body: ServedBody },
): { ok: boolean; detail: string } {
  const fail = (detail: string) => ({ ok: false, detail });
  if (!expected)
    return fail(
      "the job API's own parser accepts this request, so a refusal cannot be expected of the deployment: fix the spec",
    );
  const want = `${expected.status} ${expected.code} on ${expected.field ?? "(no field)"}`;
  if (got.status >= 200 && got.status < 300)
    return fail(
      `accepted with HTTP ${got.status}${got.body.jobId || got.body.id ? " and a job id" : ""}: this web tier does not refuse the option at creation (wanted ${want})`,
    );
  const field = got.body.error?.details?.[0]?.field;
  const served = `${got.status} ${got.body.error?.code ?? "(no code)"} on ${field ?? "(no field)"}`;
  if (
    got.status !== expected.status ||
    got.body.error?.code !== expected.code ||
    field !== expected.field
  )
    return fail(`refused as ${served}, wanted ${want}`);
  return {
    ok: true,
    detail:
      `refused at creation as ${served}: ${got.body.error?.message ?? ""}`.slice(
        0,
        240,
      ),
  };
}
