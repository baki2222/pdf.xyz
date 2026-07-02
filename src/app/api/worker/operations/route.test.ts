// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

async function json(res: Response): Promise<unknown> {
  return res.json();
}

describe("GET /api/worker/operations", () => {
  it("returns a content-free web-vantage operations snapshot in no-config mode", async () => {
    const body = await json(await GET());
    expect(body).toMatchObject({
      version: 1,
      vantage: "web",
      daemonObserved: false,
      drainable: false,
      recommendedAction: "configure-providers",
    });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/\/tmp|s3:\/\/|https?:\/\/|SECRET|object-key|invoice\.pdf|OCRPROOF/i);
  });

  it("does not imply an out-of-band daemon is deployed even when providers are configured", async () => {
    const old = { ...process.env };
    try {
      process.env.PDFXYZ_STORAGE_PROVIDER = "s3";
      process.env.PDFXYZ_S3_ENDPOINT = "https://s3.example.com";
      process.env.PDFXYZ_S3_REGION = "auto";
      process.env.PDFXYZ_S3_BUCKET = "private-bucket";
      process.env.PDFXYZ_S3_ACCESS_KEY_ID = "AKIAEXAMPLE123";
      process.env.PDFXYZ_S3_SECRET_ACCESS_KEY = "secret-value";
      process.env.PDFXYZ_QUEUE_PROVIDER = "redis";
      process.env.PDFXYZ_REDIS_REST_URL = "https://redis.example.com";
      process.env.PDFXYZ_REDIS_REST_TOKEN = "redis-secret";

      const body = await json(await GET());
      expect(body).toMatchObject({
        vantage: "web",
        daemonObserved: false,
        drainable: true,
        recommendedAction: "declare-lifecycle",
      });
      expect(JSON.stringify(body)).not.toMatch(/private-bucket|redis\.example|secret-value|redis-secret/);
    } finally {
      process.env = old;
    }
  });
});
