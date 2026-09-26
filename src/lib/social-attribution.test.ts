// @vitest-environment node
/**
 * No page may attribute pdf.xyz to a social account we do not control.
 *
 * THE DEFECT. Every page shipped `<meta name="twitter:creator"
 * content="@pdfxyz">`, from `seo.ts` and from the root layout, while
 * `site.ts` and `structured-data.ts` both explain that no social profile is
 * claimed "until the accounts exist and are actually controlled by us" and
 * keep `sameAs` out for exactly that reason. No such account is recorded
 * anywhere. The same false-ownership claim the `sameAs` comment was written to
 * prevent went out on every shared card.
 *
 * THE RULE, stated as the property rather than a mechanism: a handle appears
 * in `twitter:creator` if and only if `siteConfig.xHandle` names one. Nothing
 * else in the tree may write a handle into a `twitter` block.
 *
 * TWO INSTRUMENTS. The rendered metadata (`buildMetadata`) is what a crawler
 * reads for every page built from it. A scan of every `twitter: { ... }`
 * object literal in src, found with the TypeScript parser rather than named,
 * covers the root layout and any future page with its own block.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildMetadata, twitterAttribution } from "./seo";
import { siteConfig } from "./site";

const SRC = path.join(process.cwd(), "src");

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\./.test(entry.name)
      )
        out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/** Every `twitter: { ... }` block, and any attribution key in it written as a literal. */
function twitterBlocks(file: string, source: string) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const blocks: { at: string; literalAttribution: string[] }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sf) === "twitter" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const literalAttribution = node.initializer.properties
        .filter(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            ["creator", "creatorId", "site", "siteId"].includes(
              p.name.getText(sf),
            ) &&
            (ts.isStringLiteral(p.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(p.initializer)),
        )
        .map((p) => p.getText(sf));
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      blocks.push({
        at: `${path.relative(SRC, file)}:${line}`,
        literalAttribution,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return blocks;
}

describe("twitter attribution follows the one field that records a controlled handle", () => {
  it("the rendered metadata carries no creator while no handle is recorded", () => {
    expect(siteConfig.xHandle).toBeNull();
    const twitter = buildMetadata({
      title: "Merge PDF",
      path: "/tools/merge-pdf",
    }).twitter as Record<string, unknown>;
    expect(twitter).toBeDefined();
    expect(twitter.card).toBe("summary_large_image"); // the block itself is intact
    expect(twitter).not.toHaveProperty("creator");
    expect(twitter).not.toHaveProperty("site");
  });

  it("positive control: a recorded handle is what appears, and only then", () => {
    expect(twitterAttribution("@example_handle")).toEqual({
      creator: "@example_handle",
    });
    expect(twitterAttribution(null)).toEqual({});
  });
});

describe("no twitter block in src writes a handle of its own", () => {
  const files = sourceFiles();
  const blocks = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /\btwitter\s*:/.test(source) ? twitterBlocks(file, source) : [];
  });

  it("health: the scan finds the blocks that exist (the root layout and seo.ts)", () => {
    console.info(`twitter blocks: ${blocks.map((b) => b.at).join(", ")}`);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const at = blocks.map((b) => b.at.split(path.sep).join("/"));
    expect(at.some((a) => a.startsWith("app/layout.tsx:"))).toBe(true);
    expect(at.some((a) => a.startsWith("lib/seo.ts:"))).toBe(true);
  });

  it("positive control: the shipped block is caught", () => {
    const shipped = twitterBlocks(
      "x.ts",
      'export const m = { twitter: { card: "summary_large_image", creator: "@pdfxyz" } };',
    );
    expect(shipped.map((b) => b.literalAttribution)).toEqual([
      ['creator: "@pdfxyz"'],
    ]);
  });

  it("finds none", () => {
    expect(
      blocks
        .filter((b) => b.literalAttribution.length > 0)
        .map((b) => `${b.at}: ${b.literalAttribution.join(", ")}`),
    ).toEqual([]);
  });
});
