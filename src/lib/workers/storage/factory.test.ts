// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REQUIRED_WORKER_ENV } from "@/lib/jobs";
import { S3_ENV } from "./s3-config";
import { createStorageProvider } from "./factory";

const validS3Env = (): Record<string, string> => ({
  [S3_ENV.provider]: "s3",
  [S3_ENV.endpoint]: "https://s3.us-east-1.amazonaws.com",
  [S3_ENV.region]: "us-east-1",
  [S3_ENV.bucket]: "pdfxyz-prod",
  [S3_ENV.accessKeyId]: "AKIAEXAMPLE0000000",
  [S3_ENV.secretAccessKey]: "s3cr3tEXAMPLEkeyValue00000000000000000000",
});

describe("createStorageProvider", () => {
  it("returns a ready S3 provider when fully configured", async () => {
    const provider = createStorageProvider(validS3Env());
    expect(provider.id).toBe("s3");
    expect(provider.probe().ok).toBe(true);
    const res = await provider.reserveUpload({
      sessionId: "sess_x0000000000",
      filename: "a.pdf",
      contentType: "application/pdf",
      declaredBytes: 10,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.target.url).toContain("X-Amz-Signature=");
  });

  it("falls back to the disabled provider (not_configured) when unset", () => {
    const provider = createStorageProvider({});
    expect(provider.id).toBe("disabled");
    const probe = provider.probe();
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error.reason).toBe("not_configured");
  });

  it("falls back to remote-unimplemented when the legacy backend vars are set", () => {
    const env = Object.fromEntries(
      REQUIRED_WORKER_ENV.map((name) => [name, "set"]),
    );
    const provider = createStorageProvider(env);
    expect(provider.id).toBe("remote-unimplemented");
    const probe = provider.probe();
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error.reason).toBe("not_implemented");
  });

  it("falls back to honest not-configured when S3 is selected but invalid", () => {
    const provider = createStorageProvider({
      ...validS3Env(),
      [S3_ENV.bucket]: undefined,
    });
    expect(provider.id).toBe("disabled");
    expect(provider.probe().ok).toBe(false);
  });
});
