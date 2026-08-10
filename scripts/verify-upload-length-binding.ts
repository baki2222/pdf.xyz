/**
 * Prove that a presigned upload slot admits ONLY the size it was reserved for,
 * by trying to overshoot it and being refused.
 *
 * WHY THIS DOES NOT READ THE CODE
 * `POST /api/uploads` rejects a declaration larger than `JOB_LIMITS.maxFileBytes`,
 * which is a check on a number the caller typed. The bucket never learns that
 * number: unless the reservation signs `content-length`, a slot opened for one
 * kilobyte will happily store a gigabyte, and every unit test of the declaration
 * check stays green while it happens. Measured on production R2 on 2026-08-06,
 * before the fix: declared 2048, PUT 6144 → 200. So this sends the oversized PUT
 * for real and reports what the store did with it.
 *
 * THE CONTROL IS THE POINT
 * A 403 on its own proves nothing — an expired slot, a stale signature, a wrong
 * host or a missing header all produce one, and each would read as a fix. So a
 * correctly-sized PUT runs first against a slot minted the same way, and the run
 * refuses to draw any conclusion unless that one is accepted. Same shape as the
 * control string in the #50 deploy probe.
 *
 * WHAT IT COSTS
 * Two upload slots and two small objects (2 KB, and 6 KB if the store accepts
 * it — i.e. only when the bug is present). No job is created, no worker is woken,
 * no AI provider is called; the objects are reaped by the bucket's input
 * lifecycle rule.
 *
 * USAGE
 *   pnpm verify:upload-length                        # against production
 *   BASE=http://127.0.0.1:3000 pnpm verify:upload-length
 *
 * EXIT CODES
 *   0  the oversized PUT was refused — the ceiling is bound to the signature
 *   1  the oversized PUT was stored — the ceiling is advisory only
 *   2  the run could not complete, or the control PUT failed (nothing measured)
 */

// A module, not a global script: `scripts/verify-rate-limit.ts` declares its own
// top-level `BASE`, and two script-scoped files share one global scope in tsc.
export {};

const BASE = process.env.BASE ?? "https://pdf.xyz";

/** Declared size of every probe slot. Small: this is a signature test, not a load test. */
const DECLARED = 2048;
/** What the "attacker" actually sends. Any overshoot is the whole point. */
const OVERSIZE = DECLARED + 4096;

interface Slot {
  fileId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Reserve one slot for a `DECLARED`-byte PDF. */
async function reserve(): Promise<Slot> {
  const res = await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: "compress-pdf",
      files: [
        {
          filename: "length-binding-probe.pdf",
          contentType: "application/pdf",
          bytes: DECLARED,
        },
      ],
    }),
  });
  const text = await res.text();
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `POST /api/uploads returned ${res.status}. Storage is probably not ` +
        `configured for this BASE, so there is nothing to measure.`,
    );
  }
  const slot = (JSON.parse(text) as { slots?: Slot[] }).slots?.[0];
  if (!slot) throw new Error("The upload session came back with no slot.");
  return slot;
}

/** A body of exactly `n` bytes that still looks like a PDF at the front. */
function body(n: number): ArrayBuffer {
  const bytes = new Uint8Array(n).fill(0x20);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"), 0);
  return bytes.buffer as ArrayBuffer;
}

/**
 * PUT `sendBytes` at a freshly reserved slot. `content-length` is never set here
 * on purpose: it is a forbidden fetch header, so the transport derives it from
 * the body exactly as a browser does — which is the value the store checks.
 */
async function put(
  sendBytes: number,
): Promise<{ status: number; code: string }> {
  const slot = await reserve();
  const res = await fetch(slot.url, {
    method: slot.method,
    headers: slot.headers,
    body: body(sendBytes),
  });
  const text = await res.text().catch(() => "");
  return {
    status: res.status,
    code: /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "",
  };
}

async function main(): Promise<number> {
  console.log(
    `Probing ${BASE} — a slot declared at ${DECLARED} bytes, then ${OVERSIZE} sent at it.\n`,
  );

  let control: { status: number; code: string };
  let attack: { status: number; code: string };
  try {
    control = await put(DECLARED);
    console.log(
      `  control  ${DECLARED} bytes -> ${control.status} ${control.code}`,
    );
    attack = await put(OVERSIZE);
    console.log(
      `  oversize ${OVERSIZE} bytes -> ${attack.status} ${attack.code}\n`,
    );
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    return 2;
  }

  if (control.status < 200 || control.status >= 300) {
    console.error(
      `The correctly-sized upload was refused (${control.status}). Something other\n` +
        `than the size binding is wrong — a refusal of the oversized one would prove\n` +
        `nothing here, so this run measured nothing. Fix the control first.`,
    );
    return 2;
  }

  if (attack.status >= 200 && attack.status < 300) {
    console.log(
      `NOT BOUND — the store accepted ${OVERSIZE} bytes into a slot reserved for\n` +
        `${DECLARED}. The declared size is being checked by this app and then\n` +
        `forgotten; anyone holding a signed URL can write whatever they like to the\n` +
        `bucket. Sign 'content-length' in the upload reservation.`,
    );
    return 1;
  }

  console.log(
    `BOUND — the correctly-sized upload was stored (${control.status}) and the\n` +
      `oversized one was refused (${attack.status}${attack.code ? ` ${attack.code}` : ""}).\n` +
      `That refusal came from the object store checking the signature, not from a\n` +
      `flag in this repository.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
