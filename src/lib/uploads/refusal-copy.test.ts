// @vitest-environment node
/**
 * An upload refusal speaks in the unit the page states and in the user's
 * words, never in bytes or in protocol terms.
 *
 * THE DEFECT. Every size refusal printed its raw constant: "A file exceeds the
 * 104857600-byte per-file upload limit.", "files[0].bytes exceeds the
 * 20971520-byte per-file limit.", "Combined size exceeds the 524288000-byte
 * session limit.", "Request body exceeds the 65536-byte limit." And a file of
 * the wrong kind was told "A file's declared type does not match its filename
 * extension." The user never declared anything. The browser client did, on
 * their behalf.
 *
 * TWO INSTRUMENTS, because either alone has a hole:
 *  - the RENDERED refusals, run through the real gates, so the message a
 *    client receives is what is checked;
 *  - a scan of every string literal in `src`, read with the TypeScript parser
 *    (so a comment or a trailing `// 100 MB` is not text), for the SHAPES of
 *    the defect, so a refusal on a path this file does not run is still seen.
 *    The ban list has a corpus in both directions: every shipped sentence
 *    above must be caught, and every pattern must catch one of them.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { JOB_LIMITS } from "@/lib/jobs/types";
import {
  parseCreateJobRequest,
  parseCreateUploadSessionRequest,
} from "@/lib/jobs/validation";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingBytes } from "@/lib/tools/file-ceilings";
import { formatByteLimit } from "./byte-limit";
import { evaluateUploadDescriptors, resolveIntakePolicy } from "./intake";

/** The shapes of the defect. */
const BANNED: readonly { name: string; pattern: RegExp }[] = [
  // An interpolated constant followed by "-byte": `${limit}-byte`.
  { name: "interpolated byte count", pattern: /\$\{[^}]*\}-byte\b/ },
  // A rendered one: "104857600-byte".
  { name: "rendered byte count", pattern: /\d-byte\b/ },
  { name: "protocol word 'declared'", pattern: /\bdeclared type\b/i },
];

/** Every refusal the product shipped before this fix, as the user received it or as it was written. */
const SHIPPED = [
  "A file exceeds the 104857600-byte per-file upload limit.",
  "The upload's combined size exceeds the ${policy.maxRequestBytes}-byte request limit.",
  "A file's declared type does not match its filename extension.",
  "files[0].bytes exceeds the 20971520-byte per-file limit.",
  "Combined size exceeds the ${JOB_LIMITS.maxTotalBytes}-byte session limit.",
  "`options` exceeds the ${JOB_LIMITS.maxOptionsBytes}-byte limit.",
  "File exceeds the ${JOB_LIMITS.maxFileBytes}-byte per-file limit.",
  "Request body exceeds the 65536-byte limit.",
];

const bannedIn = (text: string) =>
  BANNED.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);

describe("the ban list and its corpus, in both directions", () => {
  it("every shipped sentence is caught by some pattern", () => {
    for (const sentence of SHIPPED) {
      expect(bannedIn(sentence), sentence).not.toEqual([]);
    }
  });

  it("every pattern catches some shipped sentence", () => {
    for (const { name, pattern } of BANNED) {
      expect(
        SHIPPED.some((s) => pattern.test(s)),
        `${name} catches nothing`,
      ).toBe(true);
    }
  });
});

// ── the scan ────────────────────────────────────────────────────────────────

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

/**
 * The text of every string, template and JSX text node in `source`, with each
 * template substitution written back as `${expr}` so an interpolated constant
 * keeps its shape.
 */
function literalTexts(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      out.push(
        node.head.text +
          node.templateSpans
            .map(
              (span) =>
                `\${${span.expression.getText(sf)}}${span.literal.text}`,
            )
            .join(""),
      );
    } else if (ts.isJsxText(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("no string in src carries the defect's shape", () => {
  const files = sourceFiles();

  it("health: the scan reads a plausible corpus, including the gates", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const gate of [
      "lib/uploads/intake/evaluate.ts",
      "lib/jobs/validation.ts",
      "app/api/_lib/http.ts",
    ]) {
      expect(
        files.some((f) => f.split(path.sep).join("/").endsWith(gate)),
      ).toBe(true);
    }
  });

  it("positive control: the scanner finds the shipped template in source form", () => {
    const shipped =
      "const m = `A file exceeds the ${policy.maxFileBytes}-byte per-file upload limit.`;\n" +
      '// A trailing comment about a 104857600-byte limit is not text.\nconst n = "ok";';
    const texts = literalTexts("x.ts", shipped);
    expect(texts.flatMap(bannedIn)).toEqual(["interpolated byte count"]);
  });

  it("finds none", () => {
    const offences: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/-byte|declared type/i.test(source)) continue;
      for (const text of literalTexts(file, source)) {
        const hit = bannedIn(text);
        if (hit.length > 0)
          offences.push(
            `${path.relative(SRC, file)}: ${hit.join(", ")}: ${text.slice(0, 90)}`,
          );
      }
    }
    expect(offences).toEqual([]);
  });
});

// ── the rendered refusals ───────────────────────────────────────────────────

const noRawBytes = (message: string) => {
  expect(message).not.toMatch(/\d{5,}/);
  expect(bannedIn(message)).toEqual([]);
};

describe("what a client receives from the upload gates", () => {
  const policy = resolveIntakePolicy({});

  it("intake: an over-size file is refused in MB", () => {
    const decision = evaluateUploadDescriptors(
      {
        files: [
          {
            filename: "scan.pdf",
            contentType: "application/pdf",
            bytes: policy.maxFileBytes + 1,
          },
        ],
      },
      policy,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rejection.code).toBe("file_too_large");
    expect(decision.rejection.message).toContain(
      formatByteLimit(policy.maxFileBytes),
    );
    noRawBytes(decision.rejection.message);
  });

  it("intake: a combined upload over the request limit is refused in MB", () => {
    const each = policy.maxFileBytes;
    const count = Math.ceil(policy.maxRequestBytes / each) + 1;
    expect(count).toBeLessThanOrEqual(policy.maxFiles);
    const decision = evaluateUploadDescriptors(
      {
        files: Array.from({ length: count }, (_, i) => ({
          filename: `part-${i}.pdf`,
          contentType: "application/pdf",
          bytes: each,
        })),
      },
      policy,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rejection.code).toBe("request_too_large");
    expect(decision.rejection.message).toContain(
      formatByteLimit(policy.maxRequestBytes),
    );
    noRawBytes(decision.rejection.message);
  });

  it("intake: a name and type that disagree are refused in plain words, with the code unchanged", () => {
    const decision = evaluateUploadDescriptors(
      {
        files: [
          {
            filename: "letter.docx",
            contentType: "application/pdf",
            bytes: 10,
          },
        ],
      },
      policy,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rejection.code).toBe("unsupported_file_type");
    noRawBytes(decision.rejection.message);
  });

  it("validator: a file over an ENGINE's ceiling is refused at that ceiling, in MB", () => {
    const tool = getToolBySlug("html-to-pdf")!;
    const ceiling = toolFileCeilingBytes(tool)!;
    expect(ceiling).toBeLessThan(JOB_LIMITS.maxFileBytes); // the case that matters
    const parsed = parseCreateUploadSessionRequest({
      tool: tool.slug,
      files: [
        { filename: "page.html", contentType: "text/html", bytes: ceiling + 1 },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const message = parsed.error.body.error.message;
    expect(message).toContain(formatByteLimit(ceiling));
    noRawBytes(message);
  });

  it("validator: a session over the combined limit is refused in MB", () => {
    const each = JOB_LIMITS.maxFileBytes;
    const files = Array.from(
      { length: Math.ceil(JOB_LIMITS.maxTotalBytes / each) + 1 },
      (_, i) => ({
        filename: `p${i}.pdf`,
        contentType: "application/pdf",
        bytes: each,
      }),
    );
    expect(files.length).toBeLessThanOrEqual(JOB_LIMITS.maxInputFiles);
    const parsed = parseCreateUploadSessionRequest({ tool: "ocr-pdf", files });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const message = parsed.error.body.error.message;
    expect(message).toContain(formatByteLimit(JOB_LIMITS.maxTotalBytes));
    noRawBytes(message);
  });

  it("validator: over-size job options are refused in KB", () => {
    const parsed = parseCreateJobRequest({
      tool: "ocr-pdf",
      options: { pad: "x".repeat(JOB_LIMITS.maxOptionsBytes + 1) },
      inputFileIds: ["f_abcdefghijkl"],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const message = parsed.error.body.error.message;
    expect(message).toContain(formatByteLimit(JOB_LIMITS.maxOptionsBytes));
    noRawBytes(message);
  });
});

describe("formatByteLimit", () => {
  it("prints the enforced constants in whole units", () => {
    expect(formatByteLimit(100 * 1024 * 1024)).toBe("100 MB");
    expect(formatByteLimit(64 * 1024)).toBe("64 KB");
    expect(formatByteLimit(2 * 1024 ** 3)).toBe("2 GB");
  });

  it("keeps a decimal rather than round a ceiling to a figure it is not", () => {
    expect(formatByteLimit(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatByteLimit(512)).toBe("512 bytes");
  });
});
