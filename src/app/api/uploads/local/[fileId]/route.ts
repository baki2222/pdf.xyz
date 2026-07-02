/**
 * PUT /api/uploads/local/[fileId] — receive bytes for a reserved local-dev
 * upload slot.
 *
 * ACTIVE ONLY when `PDFXYZ_WORKER_MODE=local-dev`; in every other environment
 * (including the production build the e2e suite exercises) it answers
 * `503 worker_not_configured`, exactly like the rest of the contract. This is
 * the developer transport that stands in for pre-signed object storage — a real
 * deployment uploads straight to an encrypted bucket, never through the app
 * server. See docs/WORKER_ARCHITECTURE.md.
 */

import {
  JOB_LIMITS,
  apiError,
  isValidFileId,
  workerNotConfigured,
} from "@/lib/jobs";
import { isLocalDevWorker } from "@/lib/workers";
import { devWorkerStore } from "@/lib/workers/store";
import { respond } from "../../../_lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOO_LARGE = `File exceeds the ${JOB_LIMITS.maxFileBytes}-byte per-file limit.`;

export async function PUT(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  if (!isLocalDevWorker()) return respond(workerNotConfigured());

  const { fileId } = await context.params;
  if (!isValidFileId(fileId)) {
    return respond(
      apiError("invalid_request", "Malformed file id.", [
        { field: "fileId", message: "Expected a file id of the form f_…" },
      ]),
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > JOB_LIMITS.maxFileBytes) {
    return respond(apiError("payload_too_large", TOO_LARGE));
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return respond(apiError("invalid_request", "Could not read the upload body."));
  }

  const put = devWorkerStore.putBytes(fileId, bytes);
  if (!put.ok) {
    switch (put.reason) {
      case "too_large":
        return respond(apiError("payload_too_large", TOO_LARGE));
      case "size_mismatch":
        return respond(
          apiError(
            "unprocessable_entity",
            "Uploaded size does not match the size declared for this slot.",
          ),
        );
      case "not_found":
      default:
        return respond(
          apiError("not_found", "No such upload slot (it may have expired)."),
        );
    }
  }

  return respond({ status: 200, body: { ok: true, fileId, bytes: bytes.byteLength } });
}
