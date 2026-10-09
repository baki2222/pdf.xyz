/**
 * Every browser job client, driven through a job that outlives the wait.
 *
 * When a client stopped polling it returned `{ ok: false, message: "Stopped
 * waiting for the worker — the job may still finish. (job job_…)" }`: the id
 * folded into prose, no field a panel could act on, and no way to pick the
 * job up again. The worker finished it, charged the AI allowance for it, and
 * deleted it an hour later. A failure path with the minimal type (house rule
 * 3): the success shape carried the job, the failure shape dropped it.
 *
 * THE SUBJECTS ARE DISCOVERED: every `runWorker*` export of every
 * `*-client.ts` module beside this file. Each is run with the real client
 * code against a stubbed network whose job never finishes, and must:
 *   - hand back the job id and `stillRunning` as DATA (and keep the raw id out
 *     of the sentence a user reads),
 *   - report the id as soon as the job exists (a panel needs it to cancel),
 *   - poll exactly the budget `jobPollFor(tool)` names for its tool,
 *   - then, once the job completes, be RESUMABLE by id to the real output.
 * The AI tools it reaches must be exactly the catalog's AI tools, so the AI
 * budget cannot silently miss one.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jobPollFor, AI_JOB_POLL } from "@/lib/jobs/client-wait";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { tools as TOOLS } from "@/lib/tools";
import { resumeSecurityJob, type FetchLike } from "./pdf-security-client";

const DIR = path.resolve("src/lib/workers");
const JOB_ID = "job_resume42";
const OUTPUT = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

type RunFn = (input: unknown, options: unknown) => Promise<unknown>;
type ResumeFn = (jobId: string, options: unknown) => Promise<unknown>;

interface Subject {
  name: string;
  file: string;
  run: RunFn;
  resume: ResumeFn;
}

/** A permissive input: every field any client reads, none it validates. */
const INPUT = {
  filename: "in.pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  contentType: "application/pdf",
  tool: "word-to-pdf",
  options: { languages: ["eng"], outputMode: "pdf", redoOcr: false },
  password: "pw",
  length: "brief",
  format: "paragraph",
  targetLanguage: "es",
  sourceLanguage: "auto",
  declaredCharacters: 100,
  declaredTextPages: 1,
  question: "what?",
  mode: "prompt",
  prompt: "fields",
  signers: [],
  fields: [],
};

async function discover(): Promise<Subject[]> {
  const subjects: Subject[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith("-client.ts"))) {
    const source = readFileSync(path.join(DIR, file), "utf8");
    const mod = (await import(
      /* @vite-ignore */ `${DIR.replace(/\\/g, "/")}/${file}`
    )) as Record<string, unknown>;
    const ownResume = Object.entries(mod).find(
      ([name, value]) =>
        name.startsWith("resume") && typeof value === "function",
    )?.[1] as ResumeFn | undefined;
    for (const [name, value] of Object.entries(mod)) {
      if (!name.startsWith("runWorker") || typeof value !== "function")
        continue;
      // A module without its own resume must be one that runs through the
      // shared security driver — otherwise nothing can resume its jobs.
      if (!ownResume && !/\brunSecurityJob\b/.test(source))
        throw new Error(`${file} runs jobs it has no way to resume`);
      subjects.push({
        name,
        file,
        run: value as RunFn,
        resume: ownResume ?? (resumeSecurityJob as ResumeFn),
      });
    }
  }
  return subjects;
}

const SUBJECTS = await discover();

/** A network whose job runs until `complete()` is called. */
function network() {
  let done = false;
  let tool = "";
  let polls = 0;
  const sleeps: number[] = [];
  const json = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const running = () => ({ jobId: JOB_ID, tool, status: "processing" });
  const completed = () => ({
    jobId: JOB_ID,
    tool,
    status: "completed",
    artifacts: [
      {
        artifactId: "a1",
        filename: "out.pdf",
        contentType: "application/pdf",
        bytes: OUTPUT.byteLength,
        url: "/download/a1",
        expiresAt: "2026-09-27T01:00:00.000Z",
      },
    ],
  });
  const fetchImpl: FetchLike = async (url, init) => {
    const body =
      init?.body && (url === "/api/uploads" || url === "/api/jobs")
        ? (JSON.parse(new TextDecoder().decode(init.body)) as {
            tool?: string;
          })
        : undefined;
    if (url === "/api/uploads") {
      tool = body?.tool ?? tool;
      return json({
        slots: [
          { fileId: "f1", url: "/upload/f1", method: "PUT", headers: {} },
        ],
      });
    }
    if (url === "/upload/f1") return json({});
    if (url === "/api/jobs") {
      tool = body?.tool ?? tool;
      return json(running());
    }
    if (url === `/api/jobs/${JOB_ID}`) {
      polls += 1;
      return json(done ? completed() : running());
    }
    if (url === "/download/a1")
      return {
        ...json({}),
        arrayBuffer: async () => OUTPUT.slice().buffer,
      };
    throw new Error(`unexpected fetch ${url}`);
  };
  return {
    fetchImpl,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    complete: () => {
      done = true;
    },
    get tool() {
      return tool;
    },
    get polls() {
      return polls;
    },
    sleeps,
  };
}

describe("the corpus — every job client beside this file", () => {
  it("is the size the directory implies", () => {
    // 13 panels' worth of clients: today 16 run functions in 13 modules.
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(SUBJECTS.map((s) => s.file)).size).toBeGreaterThanOrEqual(
      13,
    );
  });
});

describe.each(SUBJECTS.map((s) => [s.name, s] as const))(
  "%s",
  (_n, subject) => {
    it("hands back the job it stopped waiting for, as data, and resumes it to the file", async () => {
      const net = network();
      const created: string[] = [];
      const result = (await subject.run(INPUT, {
        fetchImpl: net.fetchImpl,
        sleep: net.sleep,
        onJobCreated: (id: string) => created.push(id),
      })) as {
        ok: boolean;
        message?: string;
        jobId?: string;
        stillRunning?: boolean;
      };

      expect(result).toMatchObject({
        ok: false,
        jobId: JOB_ID,
        stillRunning: true,
      });
      // The sentence a user reads carries no raw id.
      expect(result.message ?? "").not.toContain(JOB_ID);
      expect(created).toEqual([JOB_ID]);

      // Waited exactly the budget named for this tool, at its cadence.
      const budget = jobPollFor(net.tool);
      expect(net.polls).toBe(budget.maxAttempts);
      expect(new Set(net.sleeps)).toEqual(new Set([budget.intervalMs]));

      net.complete();
      const resumed = (await subject.resume(JOB_ID, {
        fetchImpl: net.fetchImpl,
        sleep: net.sleep,
      })) as {
        ok: boolean;
        output?: Uint8Array;
        artifacts?: { bytes: Uint8Array }[];
      };
      expect(resumed.ok).toBe(true);
      const bytes = resumed.output ?? resumed.artifacts?.[0]?.bytes;
      expect(bytes && [...bytes]).toEqual([...OUTPUT]);
    });
  },
);

describe("the AI budget reaches every AI tool, and only those", () => {
  it("the AI tools the clients reach are exactly the catalog's AI tools", async () => {
    const reached = new Set<string>();
    for (const subject of SUBJECTS) {
      const net = network();
      await subject.run(INPUT, { fetchImpl: net.fetchImpl, sleep: net.sleep });
      if (jobPollFor(net.tool) === AI_JOB_POLL) reached.add(net.tool);
    }
    const catalogAi = TOOLS.filter(
      (t) => capabilityForMode(t.processing) === "ai",
    ).map((t) => t.slug);
    // Only the catalog's AI tools that have a worker client: the rest are
    // previews and create no jobs.
    const withClient = catalogAi.filter((slug) =>
      SUBJECTS.some((s) =>
        readFileSync(path.join(DIR, s.file), "utf8").includes(`"${slug}"`),
      ),
    );
    expect(withClient.length).toBeGreaterThanOrEqual(4);
    expect([...reached].sort()).toEqual([...withClient].sort());
  });
});
