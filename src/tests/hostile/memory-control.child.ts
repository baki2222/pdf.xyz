// Controls for ./memory.ts. Modes:
//   plain       start the meter, then touch 100 MiB: growth must show it.
//   high-start  first a worker thread touches 400 MiB and exits, so the
//               process's lifetime peak sits far above its current RSS; then
//               the same 100 MiB. A meter reading the lifetime mark is blind
//               here (it reads ~0); the Linux meter must still show ~100.
import { Worker } from "node:worker_threads";
import { startMemoryMeter } from "./memory";
import { reportResult } from "./report";

const MiB = 1024 * 1024;

function touch(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < buf.length; i += 4096) buf[i] = 1;
  return buf;
}

async function highStart(): Promise<void> {
  const worker = new Worker(
    `const b = new Uint8Array(${400 * MiB});
     for (let i = 0; i < b.length; i += 4096) b[i] = 1;
     require("node:worker_threads").parentPort.postMessage(b[0]);`,
    { eval: true },
  );
  await new Promise<void>((resolve, reject) => {
    worker.once("message", () => void worker.terminate().then(() => resolve()));
    worker.once("error", reject);
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode === "high-start") await highStart();
  const meter = startMemoryMeter();
  const held = touch(100 * MiB);
  reportResult({
    mode,
    method: meter.method,
    growthMb: Math.round(meter.growthMb()),
    held: held[0],
  });
}
void main();
