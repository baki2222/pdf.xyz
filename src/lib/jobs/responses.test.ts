import { describe, expect, it } from "vitest";
import {
  apiError,
  CONTRACT_DOCS,
  notImplemented,
  ok,
  workerNotConfigured,
  type ApiErrorCode,
} from "./responses";

describe("apiError", () => {
  it("maps each code to the correct HTTP status", () => {
    const expected: Record<ApiErrorCode, number> = {
      invalid_request: 400,
      unsupported_media_type: 415,
      unsupported_tool: 404,
      unprocessable_entity: 422,
      payload_too_large: 413,
      conflict: 409,
      worker_not_configured: 503,
      not_implemented: 501,
      not_found: 404,
      method_not_allowed: 405,
      rate_limited: 429,
      internal_error: 500,
    };
    for (const [code, status] of Object.entries(expected)) {
      const result = apiError(code as ApiErrorCode, "msg");
      expect(result.status, code).toBe(status);
      expect(result.body.error.code).toBe(code);
      expect(result.body.error.docs).toBe(CONTRACT_DOCS);
    }
  });

  it("includes field details only when provided and non-empty", () => {
    expect(apiError("invalid_request", "m").body.error.details).toBeUndefined();
    expect(apiError("invalid_request", "m", []).body.error.details).toBeUndefined();
    const withDetails = apiError("invalid_request", "m", [
      { field: "tool", message: "required" },
    ]);
    expect(withDetails.body.error.details).toEqual([
      { field: "tool", message: "required" },
    ]);
  });
});

describe("honest stub responses", () => {
  it("workerNotConfigured is a 503 that never implies success", () => {
    const result = workerNotConfigured();
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe("worker_not_configured");
    expect(result.body.error.message.toLowerCase()).toContain("not configured");
  });

  it("notImplemented is a 501", () => {
    const result = notImplemented();
    expect(result.status).toBe(501);
    expect(result.body.error.code).toBe("not_implemented");
  });

  it("ok wraps a body with a 200 by default", () => {
    expect(ok({ hello: "world" })).toEqual({
      status: 200,
      body: { hello: "world" },
    });
    expect(ok({ created: true }, 201).status).toBe(201);
  });
});
