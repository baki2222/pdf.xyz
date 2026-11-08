// PS-04 verification child: run in a plain Node process (default ~1 MB main
// thread stack) with `node --import tsx`, because a vitest thread worker has a
// 4 MB stack and masks the overflow at depth 2,000.
import { extractPages, mergePdfs, rotatePages } from "../../lib/pdf/engine";

function nestedForms(depth: number): Uint8Array {
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objs.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /F 5 0 R >> >> >>",
  );
  const c = "/F Do";
  objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
  for (let i = 0; i < depth; i++) {
    const n = 5 + i;
    const last = i === depth - 1;
    const body = last ? "0 0 10 10 re f" : "/F Do";
    const res = last ? "" : ` /Resources << /XObject << /F ${n + 1} 0 R >> >>`;
    objs.push(
      `<< /Type /XObject /Subtype /Form /BBox [0 0 200 200]${res} /Length ${body.length} >>\nstream\n${body}\nendstream`,
    );
  }
  let out = "%PDF-1.7\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function outcome(fn: () => Promise<Uint8Array>) {
  const t = performance.now();
  try {
    const r = await fn();
    return { ok: true, bytes: r.length, ms: Math.round(performance.now() - t) };
  } catch (e) {
    return {
      ok: false,
      err: `${(e as Error).constructor.name}: ${(e as Error).message}`,
      ms: Math.round(performance.now() - t),
      at: ((e as Error).stack ?? "").split("\n")[1]?.trim(),
    };
  }
}

async function main() {
  const depths = process.argv.slice(2).map(Number);
  for (const depth of depths) {
    const b = nestedForms(depth);
    const ex = await outcome(() => extractPages(b, [0]));
    const mg = await outcome(() => mergePdfs([b, b]));
    const ro = await outcome(() => rotatePages(b, [0], 90));
    process.stdout.write(`${depth} ${JSON.stringify({ ex, mg, ro })}\n`);
  }
}
void main();
