// @vitest-environment node
/**
 * A tool's name, written by hand in a component, must be the catalogue's name.
 *
 * Found by the content writers on 2026-09-27: the Delete Pages runner told its
 * hand-off notice the tool was called "Remove Pages", while the catalogue, the
 * H1, the breadcrumb and every link say "Delete Pages". Components pass
 * `toolName` as a literal in two dozen places; each literal is a second
 * spelling of a name the catalogue owns, and a second spelling drifts.
 *
 * The literals are DISCOVERED — every `toolName` assignment or prop in every
 * component — not listed, so a new runner is in scope on arrival.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tools } from "@/lib/tools";

const ROOT = path.join(process.cwd(), "src", "components");

function componentFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...componentFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
      out.push(full);
  }
  return out;
}

/** Every string literal given to a `toolName`, in one source. */
export function toolNameLiterals(source: string): string[] {
  const found: string[] = [];
  // `toolName="X"`, `toolName={"X"}`, `toolName = "X"` / `? "X" : "Y"`,
  // `toolName: "X"` — up to the end of the statement or the prop.
  for (const match of source.matchAll(
    /\btoolName\s*(?:=|:)\s*(\{?[^;\n>]*)/g,
  )) {
    const expr = match[1]!;
    // A plain literal (a JSX prop, a default) is that one literal; the rest of
    // the line is other props.
    const plain = /^\{?\s*(?:"([^"]+)"|'([^']+)')/.exec(expr);
    if (plain) {
      found.push(plain[1] ?? plain[2]!);
      continue;
    }
    // An expression: every literal it can EVALUATE to. A literal being
    // COMPARED (`mode === "extract" ? …`) is not a name.
    const values = expr.replace(/[!=]==?\s*(?:"[^"]*"|'[^']*')/g, "");
    for (const literal of values.matchAll(/"([^"]+)"|'([^']+)'/g))
      found.push(literal[1] ?? literal[2]!);
  }
  return found;
}

/**
 * Literals that are not a tool's name and say so: `SinglePdfRunner`'s default
 * for a caller that passes none, which reads "…couldn't open in this tool".
 */
const NOT_A_NAME = new Set(["this tool"]);

describe("hand-written tool names are the catalogue's names", () => {
  const names = new Set(tools.map((tool) => tool.name));
  const literals = componentFiles().flatMap((file) =>
    toolNameLiterals(readFileSync(file, "utf8")).map((name) => ({
      file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
      name,
    })),
  );

  it("finds the literals (health check)", () => {
    // Twenty-odd runners pass one; a scan that found none is blind.
    expect(literals.length).toBeGreaterThan(15);
  });

  it("every one names a catalogued tool", () => {
    const stray = literals.filter(
      (l) => !names.has(l.name) && !NOT_A_NAME.has(l.name),
    );
    expect(
      stray.map((l) => `${l.file}: "${l.name}"`),
      "these name a tool the catalogue does not have — derive it with getToolBySlug(slug).name",
    ).toEqual([]);
  });

  it("positive control: the line that shipped is caught", () => {
    const shipped =
      'const toolName = mode === "extract" ? "Extract Pages" : "Remove Pages";';
    const found = toolNameLiterals(shipped);
    expect(found).toEqual(["Extract Pages", "Remove Pages"]);
    expect(found.filter((name) => !names.has(name))).toEqual(["Remove Pages"]);
    expect(toolNameLiterals('<Runner toolName="Crop PDF" />')).toEqual([
      "Crop PDF",
    ]);
    expect(toolNameLiterals("toolName: string;")).toEqual([]);
    // A prop list: the name, not the slug beside it.
    expect(
      toolNameLiterals(
        '<NotifyMe toolName="PDF to PDF/A" toolSlug="pdf-to-pdfa" />',
      ),
    ).toEqual(["PDF to PDF/A"]);
  });
});
