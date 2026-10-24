// @vitest-environment jsdom
/**
 * Protect PDF's permission switches, driven as a person drives them, through
 * the REAL local-dev adapter (job-option parser, processor, engine with its
 * /P read-back). The one stand-in is the qpdf binary: it records what it was
 * asked and writes an /Encrypt dictionary whose /P the test chooses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { tools } from "@/lib/tools/catalog";
import { buildWorkerStatus } from "@/lib/workers/status";
import { createLocalDevAdapter } from "@/lib/workers/local-dev";
import { DevWorkerStore } from "@/lib/workers/store";
import { disabledSoundnessGate } from "@/lib/workers/soundness/gate";
import { disabledArtifactManifestGate } from "@/lib/workers/artifacts/gate";
import type {
  QpdfProtectInput,
  QpdfRunner,
} from "@/lib/workers/pdf-security/engine";
import {
  ALL_PERMISSIONS_ALLOWED,
  PDF_PERMISSION_BITS,
  PDF_PERMISSION_KEYS,
  type PdfPermissions,
} from "@/lib/jobs/pdf-permissions";
import { dropSheetsLive } from "@/tests/drop-sheets-live";
import { PDF_PERMISSIONS } from "@/lib/jobs/pdf-permission-labels";
import { PdfSecurityWorkerPanel } from "./pdf-security-worker-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const enc = (s: string) => new TextEncoder().encode(s);
const PLAIN = enc(
  `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
);

function pFor(perms: PdfPermissions): number {
  let p = -4;
  for (const key of PDF_PERMISSION_KEYS)
    if (!perms[key])
      for (const bit of PDF_PERMISSION_BITS[key]) p &= ~(1 << (bit - 1));
  return p;
}

function encryptedWithP(p: number): Uint8Array {
  return enc(
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n9 0 obj\n<< /Filter /Standard /V 5 /R 6 /P ${p} >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 9 0 R >>\n${"0".repeat(64)}\n%%EOF\n`,
  );
}

/**
 * A worker over `fetch`. `writeP` decides the /P the "qpdf" output carries
 * from what it was asked; `asked` collects each protect call.
 */
function answerWithLocalWorker(
  writeP: (asked: QpdfProtectInput) => number,
): QpdfProtectInput[] {
  const asked: QpdfProtectInput[] = [];
  const outputs = new Set<Uint8Array>();
  const qpdf: QpdfRunner = {
    isEncrypted: async (b) => outputs.has(b),
    requiresPassword: async (b) =>
      outputs.has(b) ? "needs-password" : "not-encrypted",
    protect: async (_bytes, opts) => {
      asked.push(opts);
      const out = encryptedWithP(writeP(opts));
      outputs.add(out);
      return out;
    },
    unlock: async () => ({ ok: true, output: PLAIN }),
  };
  const store = new DevWorkerStore();
  const adapter = createLocalDevAdapter({
    store,
    pdfSecurityDeps: { qpdf },
    // The soundness/manifest gates parse real PDFs; these fixtures are
    // structural stand-ins for qpdf output, so the gates are steered off.
    soundness: disabledSoundnessGate(),
    artifactManifest: disabledArtifactManifestGate(),
  });
  const status = buildWorkerStatus("local-dev", undefined, undefined, {}, true);
  const json = (value: unknown, code = 200) =>
    new Response(JSON.stringify(value), { status: code });
  const reply = <T,>(
    out:
      | { ok: true; status: number; value: T }
      | { ok: false; error: { status: number; body: unknown } },
  ) =>
    out.ok
      ? json(out.value, out.status)
      : json(out.error.body, out.error.status);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        const body = init?.body ? new Uint8Array(init.body) : new Uint8Array();
        const parsed = () => JSON.parse(new TextDecoder().decode(body));
        if (url === "/api/worker/status") return json(status);
        if (url === "/api/uploads" && init?.method === "POST")
          return reply(await adapter.createUploadSession(parsed()));
        const upload = /^\/api\/uploads\/local\/([^/]+)$/.exec(url);
        if (upload && init?.method === "PUT") {
          const put = store.putBytes(upload[1]!, body);
          return put.ok ? json({}) : json({ error: put.reason }, 400);
        }
        if (url === "/api/jobs" && init?.method === "POST")
          return reply(await adapter.createJob(parsed()));
        const job = /^\/api\/jobs\/([^/?]+)$/.exec(url);
        if (job) return reply(await adapter.getJob(job[1]!));
        const artifact = /^\/api\/artifacts\/local\/([^/]+)$/.exec(url);
        if (artifact) {
          const got = store.retrieveArtifact(artifact[1]!);
          return got.lifecycle === "live"
            ? new Response(got.artifact.bytes.slice().buffer as ArrayBuffer)
            : json({}, 404);
        }
        throw new Error(`unexpected request in test: ${url}`);
      },
    ),
  );
  return asked;
}

const protectTool = tools.find((t) => t.slug === "protect-pdf")!;

async function fillForm() {
  const { container } = render(<PdfSecurityWorkerPanel tool={protectTool} />);
  await runButton();
  await dropSheetsLive();
  const input = container.querySelector('input[type="file"]');
  expect(input, "the panel offers a file picker").not.toBeNull();
  fireEvent.drop(input!.closest("label")!, {
    dataTransfer: {
      files: [
        new File([PLAIN.slice().buffer as ArrayBuffer], "contract.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  expect(await screen.findByText("contract.pdf")).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText("New password"), {
    target: { value: "open-sesame" },
  });
  return container;
}

const runButton = () =>
  screen.findByRole("button", { name: /encrypt on the worker/i });

describe("Protect PDF: permissions", { timeout: 30_000 }, () => {
  it("every box starts ticked, and with none unticked no owner password is asked for or sent", async () => {
    const asked = answerWithLocalWorker(() => -4);
    await fillForm();
    for (const info of PDF_PERMISSIONS)
      expect(
        screen.getByRole("checkbox", { name: new RegExp(info.label) }),
      ).toBeChecked();
    expect(screen.queryByLabelText("Owner password")).toBeNull();
    const run = await runButton();
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText("Your PDF is protected and ready.", undefined, {
      timeout: 10_000,
    });
    expect(asked).toHaveLength(1);
    // Single-password protection, exactly as before.
    expect(asked[0]!.ownerPassword).toBe("open-sesame");
    expect(asked[0]!.permissions).toEqual(ALL_PERMISSIONS_ALLOWED);
  });

  it("unticking Printing and Copying asks for a DIFFERENT owner password, then sends both restrictions", async () => {
    const asked = answerWithLocalWorker((opts) => pFor(opts.permissions!));
    await fillForm();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Printing/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Copying/ }));
    const owner = await screen.findByLabelText("Owner password");
    const run = await runButton();
    expect(run).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(owner, { target: { value: "open-sesame" } });
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(
      document.getElementById("pdf-security-owner-password-hint"),
    ).toHaveTextContent(/different password/i);
    fireEvent.change(owner, { target: { value: "owner-sesame" } });
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await screen.findByText("Your PDF is protected and ready.", undefined, {
      timeout: 10_000,
    });
    expect(asked[0]!.ownerPassword).toBe("owner-sesame");
    expect(asked[0]!.permissions).toEqual({
      ...ALL_PERMISSIONS_ALLOWED,
      print: false,
      copy: false,
    });
  });

  it("a qpdf whose output still allows printing is refused — no 'protected and ready'", async () => {
    answerWithLocalWorker(() => -4);
    await fillForm();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Printing/ }));
    fireEvent.change(await screen.findByLabelText("Owner password"), {
      target: { value: "owner-sesame" },
    });
    const run = await runButton();
    await waitFor(() => expect(run).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(run);
    await waitFor(
      () =>
        expect(screen.queryByText(/could not|couldn.t|failed/i)).not.toBeNull(),
      { timeout: 10_000 },
    );
    expect(screen.queryByText("Your PDF is protected and ready.")).toBeNull();
  });

  it("accessibility is ticked and cannot be unticked, and says why", async () => {
    answerWithLocalWorker(() => -4);
    await fillForm();
    const box = screen.getByRole("checkbox", { name: /accessibility/i });
    expect(box).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(box.closest("label")).toHaveTextContent(/AES encryption/);
  });

  it("form filling follows comments: inert while comments are allowed, free once they are not", async () => {
    answerWithLocalWorker(() => -4);
    await fillForm();
    const forms = screen.getByRole("checkbox", { name: /^Filling in forms/ });
    expect(forms).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(forms);
    expect(forms).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Adding comments/ }));
    expect(forms).not.toHaveAttribute("aria-disabled");
    fireEvent.click(forms);
    expect(forms).not.toBeChecked();
  });
});
