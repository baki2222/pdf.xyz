// @vitest-environment node
/**
 * A policy identity that says it is "for docs/receipts/audit" must reach one.
 *
 * THE DEFECT. `cleanup-evidence/types.ts` exported CLEANUP_EVIDENCE_POLICY_ID
 * ("Stable identity ... for docs/receipts/audit") and
 * CLEANUP_EVIDENCE_POLICY_VERSION ("Bump when the posture/reason taxonomy or
 * its resolution semantics change"). Nothing in src, scripts or docs read
 * either one. The audit trail cited no version, and the "bump when semantics
 * change" rule governed a number no reader could observe. Both were removed,
 * since nothing consumed them. The seven sibling policies do stamp theirs
 * into a receipt, report or manifest.
 *
 * THE RULE. Every exported `*_POLICY_ID` / `*_POLICY_VERSION` in src/lib is
 * used, as an identifier and not in a comment, by at least one OTHER non-test
 * module in src or scripts. The constants are discovered by their
 * declarations, not listed.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\./.test(entry.name)
      )
        out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

const POLICY_CONST = /^[A-Z][A-Z0-9_]*_POLICY_(?:ID|VERSION)$/;

/** Declared policy constants, and every identifier used, per file (comments are not identifiers). */
function scan(file: string, source: string) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declared: string[] = [];
  const used = new Set<string>();
  const visit = (node: ts.Node) => {
    // Naming a constant in an import or a re-export is not using it: a barrel
    // that re-exports an orphan must not make it look consumed.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      POLICY_CONST.test(node.name.text)
    ) {
      declared.push(node.name.text);
    } else if (ts.isIdentifier(node)) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { declared, used };
}

/** The declared constants no other module uses. */
export function orphans(
  files: readonly { file: string; declared: string[]; used: Set<string> }[],
): string[] {
  return files.flatMap(({ file, declared }) =>
    declared
      .filter((name) => !files.some((o) => o.file !== file && o.used.has(name)))
      .map((name) => `${path.relative(ROOT, file)}: ${name}`),
  );
}

describe("every policy identity is consumed somewhere", () => {
  const scanned = [...sources("src"), ...sources("scripts")].flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes("_POLICY_") ? [{ file, ...scan(file, source) }] : [];
  });
  const declared = scanned.flatMap((s) => s.declared);

  it("health: the declarations are found", () => {
    console.info(`policy constants: ${declared.join(", ")}`);
    expect(declared.length).toBeGreaterThanOrEqual(14);
    expect(declared).toContain("ARTIFACT_POLICY_ID");
  });

  it("positive control: a constant only its own file mentions is an orphan", () => {
    const synthetic = [
      {
        file: "a.ts",
        declared: ["X_POLICY_ID"],
        used: new Set(["X_POLICY_ID"]),
      },
      {
        file: "b.ts",
        declared: ["Y_POLICY_ID"],
        used: new Set(["Y_POLICY_ID"]),
      },
      { file: "c.ts", declared: [], used: new Set(["Y_POLICY_ID"]) },
    ];
    expect(orphans(synthetic)).toEqual([
      `${path.relative(ROOT, "a.ts")}: X_POLICY_ID`,
    ]);
  });

  it("none is an orphan", () => {
    expect(orphans(scanned)).toEqual([]);
  });
});
