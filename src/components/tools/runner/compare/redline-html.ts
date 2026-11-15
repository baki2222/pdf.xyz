import type { PdfCompareResult } from "@/lib/pdf/compare-pdf";
import { hunkHeader } from "@/lib/pdf/compare/hunks";
import type { WordToken } from "@/lib/pdf/compare/words";
import {
  SCOPE_SENTENCE,
  changesSentence,
  fallbackSentence,
  hunkMarks,
  lineTexts,
  reportFields,
} from "./report";

/**
 * Compare PDF's HTML redline (S4, 2026-11-15): the .txt report's changes as
 * one self-contained web page, built in the browser from the result on
 * screen. Its own lazy chunk (`loadCompareRedline` in `compare-result.tsx`),
 * fetched when Download redline (HTML) is pointed at or pressed.
 *
 * WHAT IT IS, and what keeps it so:
 *
 * - The SAME words as the .txt: the header fields, the scope sentence, the
 *   "no differences" and no-text sentences and the fallback count all come
 *   from `report.ts`, and the rows from the same line maps and word marks
 *   (`lineTexts`, `hunkMarks`). `redline-html.test.ts` holds every row, mark
 *   and header value to the .txt built from the same result.
 * - Nothing runs and nothing loads. The page carries no script, link, image
 *   or `url(`, and a Content-Security-Policy meta allows one stylesheet, by
 *   its SHA-256 ({@link REDLINE_CSS_SHA256}), and nothing else — so even an
 *   escaping bug that let markup through could neither run nor restyle the
 *   page. No `style=""` attribute anywhere: a hash-only policy blocks them.
 * - Every interpolation goes through {@link escapeHtml}, the module's one
 *   escape: file names (in the title too), counts, sentences and tokens.
 * - Polyglot markup (closed elements, `<meta … />`), so a test can parse it
 *   as XML and assert it is well-formed.
 * - `del` and `ins` keep the browser's own strike and underline; the
 *   stylesheet only thickens `ins` and colours both, and the − and + markers
 *   are text, so the meaning never rests on colour (WCAG 1.4.1). The
 *   stylesheet's class names are short and unlike the site's: Tailwind reads
 *   this file and would add any utility-shaped word to the site's
 *   stylesheet, which sits at its 15.0 KB ceiling.
 *
 * HUNKS ARE NOT CAPPED, as the .txt is not. MEASURED 2026-11-15, 80-char
 * lines, this module against the .txt from the same result: the page is
 * 1.7 times the .txt for small edits and 2.85 times for whole-line ones.
 * The runner test's "too large" boundary (4,999 lines each, all different,
 * just under `MAX_DIFF_CELLS`): 0.64 MB of .txt, 1.84 MB of HTML. The view
 * test's 10,000 edits on every other line: 3.76 MB -> 6.35 MB, built in
 * 36 ms. But `MAX_DIFF_CELLS` bounds the work between two unchanged lines,
 * not the output: 50,000 such edits (two 100,000-line PDFs) read 18.9 MB of
 * .txt and 31.8 MB of HTML, built in 167 ms. So the plan's 20 MB line IS
 * crossable, and only by a comparison whose .txt is already about 12 MB. A
 * hunk cap would not bound it either (those edits are ONE hunk); the page
 * stays uncapped so it can never disagree with the .txt, and the figure is
 * flagged to the owner in the PR.
 */

/**
 * The lazy-chunk marker: the generator meta's content, so it is in the
 * output and survives minification. Only tests import it — an import from
 * the runner would carry the marker into the runner's chunk.
 */
export const COMPARE_REDLINE_CHUNK = "pdf.xyz Compare PDF redline";

/**
 * The stylesheet, inside the downloaded file. Tokens on :root, redefined for
 * a dark scheme and again (all of them, light) for print, which wins over a
 * dark screen because it comes last. No `<` and no `&`, so it never needs an
 * escape; the test asserts both.
 */
export const REDLINE_CSS =
  ":root{color-scheme:light dark;--bg:#ffffff;--fg:#1b1b1b;--muted:#555555;--rule:#cfcfcf;--del-bg:#fdecec;--del-fg:#8f1d1d;--ins-bg:#e6f4e9;--ins-fg:#14532d}" +
  "@media (prefers-color-scheme: dark){:root{--bg:#151515;--fg:#ececec;--muted:#b5b5b5;--rule:#3d3d3d;--del-bg:#3b1a1a;--del-fg:#ffb8b8;--ins-bg:#14331e;--ins-fg:#a9efbc}}" +
  "@media print{:root{--bg:#ffffff;--fg:#000000;--muted:#333333;--rule:#999999;--del-bg:#fdecec;--del-fg:#7a1414;--ins-bg:#e6f4e9;--ins-fg:#0f4224}" +
  "body{max-width:none;padding:0}.r,.a{print-color-adjust:exact;-webkit-print-color-adjust:exact}section{break-inside:auto}h3{break-after:avoid}}" +
  "body{margin:0 auto;max-width:72rem;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
  "h1{font-size:1.35rem;margin:0 0 8px;overflow-wrap:anywhere}" +
  "dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:12px 0}" +
  "dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}" +
  "section{margin:20px 0;border:1px solid var(--rule)}" +
  "h3{margin:0;padding:6px 10px;font-size:0.95rem;border-bottom:1px solid var(--rule)}" +
  ".l{margin:0;padding:1px 10px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,Liberation Mono,monospace}" +
  ".s{color:var(--muted)}.r{background:var(--del-bg)}.a{background:var(--ins-bg)}" +
  ".m{font-weight:700;margin-right:8px}.r .m,del{color:var(--del-fg)}.a .m,ins{color:var(--ins-fg)}" +
  "ins{text-decoration-thickness:2px}" +
  ".sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
  "footer{margin-top:24px;color:var(--muted);font-size:0.85rem}";

/**
 * `sha256-` of {@link REDLINE_CSS}, base64. A typed constant: the test
 * recomputes it with `node:crypto` over the bytes the page emits between
 * `<style>` and `</style>`, and the e2e sees a wrong one as a CSP violation.
 */
export const REDLINE_CSS_SHA256 =
  "oAlKYC+bjsVuwgfm53M9XN08f1vTWq/TOYSEwvwS4uA=";

/** The page's whole policy. `frame-ancestors` is ignored in a meta, so it is not here. */
export const REDLINE_CSP = `default-src 'none'; style-src 'sha256-${REDLINE_CSS_SHA256}'; base-uri 'none'; form-action 'none'`;

const REPLACEMENT = String.fromCharCode(0xfffd);

/**
 * The module's one escape. `& < > " '` become entities; a code point XML
 * 1.0 forbids — a C0 control other than tab and line feed, DEL, U+FFFE,
 * U+FFFF, a lone surrogate — becomes U+FFFD (HTML turns NUL into it anyway).
 * Code points by number, never typed escapes: a typed escape has been turned
 * into the raw character by the tool layer before.
 */
export function escapeHtml(s: string): string {
  let out = "";
  let last = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    let rep: string | undefined;
    if (c === 38) rep = "&amp;";
    else if (c === 60) rep = "&lt;";
    else if (c === 62) rep = "&gt;";
    else if (c === 34) rep = "&quot;";
    else if (c === 39) rep = "&#39;";
    else if (c < 32) {
      if (c !== 9 && c !== 10) rep = REPLACEMENT;
    } else if (c === 127 || c === 0xfffe || c === 0xffff) rep = REPLACEMENT;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      rep = REPLACEMENT;
    } else if (c >= 0xdc00 && c <= 0xdfff) rep = REPLACEMENT;
    if (rep !== undefined) {
      out += s.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? s : out + s.slice(last);
}

const esc = escapeHtml;

/** A screen-reader cue: clipped, read aloud, not seen. */
const cue = (text: string) => `<span class="sr">${esc(text)}</span>`;

/**
 * One side of a changed line, as the view draws it (`sideText` in
 * `compare-result.tsx`): word-marked, only the differing runs are marked;
 * unpaired (no partner), the whole line is one mark; skipped by a bound
 * (tokens null), no mark at all. On the + side an unchanged word is the
 * second file's (`t.right`), which "ignore case" lets differ.
 */
function sideHtml(
  tokens: readonly WordToken[] | null | undefined,
  side: "removed" | "added",
  text: string,
): string {
  const tag = side === "removed" ? "del" : "ins";
  if (tokens === null) return esc(text);
  if (tokens === undefined) return `<${tag}>${esc(text)}</${tag}>`;
  let out = "";
  for (const t of tokens) {
    if (t.k === "same")
      out += esc(side === "added" ? (t.right ?? t.text) : t.text);
    else if (t.k === side)
      out += `${cue(`[${side}: `)}<${tag}>${esc(t.text)}</${tag}>${cue("]")}`;
  }
  return out;
}

/** The page. Pure: no DOM, no clock, so the same result is the same bytes. */
export function buildRedlineHtml(result: PdfCompareResult): string {
  const left = esc(result.leftName);
  const right = esc(result.rightName);
  const out: string[] = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${REDLINE_CSP}" />`,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    '<meta name="referrer" content="no-referrer" />',
    `<meta name="generator" content="${COMPARE_REDLINE_CHUNK}" />`,
    `<title>${left} vs ${right}: PDF comparison</title>`,
    `<style>${REDLINE_CSS}</style>`,
    "</head>",
    "<body>",
    "<header>",
    `<h1>PDF comparison: <bdi class="f">${left}</bdi> vs <bdi class="f">${right}</bdi></h1>`,
    `<p>${esc(SCOPE_SENTENCE)}</p>`,
    "<dl>",
    ...reportFields(result).map(
      (f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`,
    ),
    "</dl>",
  ];
  if (result.wordFallbacks > 0)
    out.push(`<p>${esc(fallbackSentence(result.wordFallbacks))}</p>`);
  out.push("</header>", "<main>", '<h2 class="sr">Changes</h2>');

  const said = changesSentence(result);
  if (said !== null) {
    out.push(`<p>${esc(said)}</p>`);
  } else {
    const text = lineTexts(result);
    result.hunks.forEach((hunk, n) => {
      const id = `h${n + 1}`;
      out.push(
        `<section aria-labelledby="${id}"><h3 id="${id}">${esc(hunkHeader(hunk, "→"))}</h3>`,
      );
      const { byLeft, byRight } = hunkMarks(hunk);
      for (const op of hunk.ops) {
        if (op.k === "same") {
          out.push(
            `<div class="l s" dir="auto"><span class="m" aria-hidden="true"> </span>${esc(text.left.get(op.a) ?? "")}</div>`,
          );
        } else if (op.k === "removed") {
          out.push(
            `<div class="l r" dir="auto"><span class="m" aria-hidden="true">−</span>${cue("Removed: ")}${sideHtml(byLeft.get(op.a), "removed", text.left.get(op.a) ?? "")}</div>`,
          );
        } else {
          out.push(
            `<div class="l a" dir="auto"><span class="m" aria-hidden="true">+</span>${cue("Added: ")}${sideHtml(byRight.get(op.b), "added", text.right.get(op.b) ?? "")}</div>`,
          );
        }
      }
      out.push("</section>");
    });
  }
  out.push(
    "</main>",
    "<footer><p>Made in your browser by pdf.xyz Compare PDF. Contains text from both files.</p></footer>",
    "</body>",
    "</html>",
    "",
  );
  return out.join("\n");
}
