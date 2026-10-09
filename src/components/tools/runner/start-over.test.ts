import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Start over" must actually leave the result.
 *
 * Every runner ends in the same shape: `const { result, … } = useAsyncRun()`
 * and `if (result) return <ResultPanel onReset={…}>`. The result lives in
 * THAT component's hook, so the panel goes away only if `onReset` either
 * clears that hook (`reset()`) or is the parent's callback that unmounts the
 * component (SinglePdfRunner's `reset`, which drops the loaded file). Text,
 * Markdown, PNG and JPG to PDF did neither — they emptied their input and left
 * the success panel on screen over an empty document, with the old PDF still
 * behind its Download button, until a page reload.
 *
 * `runner-flows.test.tsx` proves the four fixed runners by driving them. This
 * guard is the set: it DISCOVERS every component that owns a run result and
 * renders a ResultPanel, in every runner file, and checks the relationship —
 * so the next runner written in the old shape is caught without anyone
 * listing it.
 */

const RUNNER_DIR = __dirname;

interface Finding {
  component: string;
  onReset: string;
  ok: boolean;
}

/** Text of a JSX attribute value `{…}` starting at `open` (the "{"). */
function braced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open + 1, i).trim();
    }
  }
  throw new Error("unbalanced braces");
}

export function checkStartOver(source: string): Finding[] {
  const starts = [...source.matchAll(/^(?:export )?function (\w+)\s*\(/gm)];
  const findings: Finding[] = [];
  starts.forEach((match, i) => {
    const block = source.slice(match.index, starts[i + 1]?.index ?? undefined);
    const hook = block.match(/const \{([^}]*)\} = useAsyncRun\b/);
    if (!hook || !/\bresult\b/.test(hook[1]!)) return;
    const hookNames = hook[1]!.split(",").map((n) => n.trim());
    const params = block.match(/^[^(]*\(\s*\{([^}]*)\}/)?.[1] ?? "";
    const props = params.split(",").map((n) => n.trim().split(/[\s:=]/)[0]);
    for (const panel of block.matchAll(/<ResultPanel\b/g)) {
      const attr = block.indexOf("onReset={", panel.index);
      if (attr < 0) continue;
      const expr = braced(block, attr + "onReset=".length);
      const localFn = expr.match(/^\w+$/)
        ? block.match(new RegExp(`const ${expr} = [^;]*?=>[\\s\\S]*?\\n  \\};`))
        : null;
      const body = localFn ? localFn[0] : expr;
      // A reload used to count as a way out: it does leave the result, by
      // throwing the page away (the document and its chunks fetched again,
      // focus back at the top, any hand-off claimed a second time). Compare
      // PDF shipped exactly that until 2026-10-09. Inverted, not deleted: a
      // reload is now a failure, and the control below holds it.
      const ok =
        !/location\.reload\(\)/.test(body) &&
        (props.includes(expr) || // the parent's callback: it unmounts us
          (hookNames.includes("reset") && /\breset\(\)/.test(body)) ||
          (expr === "reset" && hookNames.includes("reset")));
      findings.push({ component: match[1]!, onReset: expr, ok });
    }
  });
  return findings;
}

describe('every run result can be left with "Start over"', () => {
  it("POSITIVE CONTROL: the checker flags the shape that shipped", () => {
    const shipped = `
function Editor({ source, onSource }) {
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  if (result) {
    return (
      <ResultPanel
        title="PDF created"
        onReset={() => onSource({ ...source, text: "" })}
      />
    );
  }
}
function Runner() {
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const clearItems = () => {
    setItems([]);
  };
  if (result) return <ResultPanel onReset={clearItems} />;
}
function Fixed({ onReset }) {
  const { result, run } = useAsyncRun<Uint8Array>();
  if (result) return <ResultPanel onReset={onReset} />;
}
function Reloads() {
  const { result, run, reset } = useAsyncRun<Uint8Array>();
  if (result) return <ResultPanel onReset={() => window.location.reload()} />;
}`;
    expect(checkStartOver(shipped).map((f) => [f.component, f.ok])).toEqual([
      ["Editor", false],
      ["Runner", false],
      ["Fixed", true],
      ["Reloads", false],
    ]);
  });

  const files = readdirSync(RUNNER_DIR).filter(
    (f) => f.endsWith(".tsx") && !f.includes(".test."),
  );
  const all = files.flatMap((file) =>
    checkStartOver(readFileSync(join(RUNNER_DIR, file), "utf8")).map((f) => ({
      file,
      ...f,
    })),
  );

  it("health check: the walk found the runners' result panels", () => {
    // ~24 runners own a run result; a collapse to a handful means the
    // component split or the hook regex stopped matching, not that all is well.
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((f) => f.file)).size).toBeGreaterThan(18);
  });

  it("no ResultPanel's onReset leaves its own result standing", () => {
    expect(
      all
        .filter((f) => !f.ok)
        .map((f) => `${f.file} ${f.component}: onReset={${f.onReset}}`),
    ).toEqual([]);
  });
});
