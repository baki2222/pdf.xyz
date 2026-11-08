// Controls for bounded.ts: each mode produces one of the four outcomes, so the
// runner is shown able to tell a settle from a hang from a crash.
import { reportResult } from "./bounded";

const mode = process.argv[2];
if (mode === "settle") reportResult({ ok: 1 });
else if (mode === "hang") {
  for (;;) {
    // A synchronous loop: the kind of hang a vitest timeout cannot interrupt.
  }
} else if (mode === "memory") {
  // Ordinary heap objects (not typed arrays, which live outside the old space
  // and would eat machine RAM instead of tripping --max-old-space-size).
  const hold: { n: number; s: string }[] = [];
  for (let i = 0; ; i += 1) hold.push({ n: i, s: `cell-${i}` });
} else {
  throw new Error("control: crash before reporting");
}
