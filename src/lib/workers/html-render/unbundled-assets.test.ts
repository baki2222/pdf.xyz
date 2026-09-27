// @vitest-environment jsdom
/**
 * The scan's edge cases, which the real-renderer test does not enumerate:
 * references that must NOT raise the note (inline, fragment, non-fetch,
 * absolute, resolved by a <base>) beside ones that must. Each "quiet" case
 * sits next to a "reported" twin in the same document, so a scan that reports
 * nothing cannot pass the quiet half.
 */
import { describe, expect, it } from "vitest";
import {
  findUnbundledAssetsInHtml,
  unbundledAssetsNote,
} from "./unbundled-assets";

const scan = (body: string, head = "") =>
  findUnbundledAssetsInHtml(
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
  ).references;

describe("findUnbundledAssets", () => {
  it("reports relative and root-relative references, once each, in document order", () => {
    expect(
      scan(`<img src="logo.png"><img src="/img/a.png"><img src="logo.png">
        <link rel="stylesheet" href="../style.css">`),
    ).toEqual(["logo.png", "/img/a.png", "../style.css"]);
  });

  it("stays quiet about inline, fragment, non-fetch and absolute references", () => {
    expect(
      scan(`<img src="data:image/png;base64,AAAA"><img src="blob:x">
        <img src="#a"><img src=""><img src="https://cdn.example/a.png">
        <img src="//cdn.example/b.png"><a href="page2.html">link</a>
        <iframe src="about:blank"></iframe><svg><rect style="fill:url(#g)"/></svg>
        <img src="MISSING.png">`),
    ).toEqual(["MISSING.png"]);
  });

  it("reports file: references — the renderer loads no local file", () => {
    expect(scan(`<img src="file:///C:/Users/me/logo.png">`)).toEqual([
      "file:///C:/Users/me/logo.png",
    ]);
  });

  it("parses srcset per the spec, keeping a data: URL's commas", () => {
    expect(
      scan(
        `<img srcset="data:image/png;base64,AA,BB 1x, small.png 480w, https://cdn.example/big.png 2x">`,
      ),
    ).toEqual(["small.png"]);
  });

  it("reads url() and @import in <style> and style attributes", () => {
    expect(
      scan(
        `<div style="background:url( 'bg.png' )"></div>`,
        `<style>@import "base.css"; @import url(print.css);
          h1{background:url(data:image/png;base64,AA)} p{background:url(https://cdn.example/x.png)}</style>`,
      ).sort(),
    ).toEqual(["base.css", "bg.png", "print.css"]);
  });

  it("reads image-set() candidates written as bare strings, but not a type() string", () => {
    expect(
      scan(
        `<div style="background-image:image-set('a.png' type('image/png'), url(b.png) 2x, &quot;data:image/png;base64,AA&quot; 3x)"></div>
        <div style="background-image:-webkit-image-set('c.png' 1x, 'https://cdn.example/d.png' 2x)"></div>`,
      ).sort(),
    ).toEqual(["a.png", "b.png", "c.png"]);
  });

  it("ignores url() inside a CSS comment, and decodes CSS escapes", () => {
    expect(
      scan(
        `<style>/* .old{background:url(gone.png)} */ .new{background:url(here.png)}
          .esc{background:u\\72l(escaped.png)}</style>`,
      ),
    ).toEqual(["here.png", "escaped.png"]);
  });

  it("scans an <iframe srcdoc> document, through its own <base>", () => {
    expect(
      scan(
        `<iframe srcdoc="<img src='inner.png'><img src='https://cdn.example/x.png'>"></iframe>
        <iframe srcdoc="<base href='https://site.example/'><img src='based.png'>"></iframe>`,
      ),
    ).toEqual(["inner.png"]);
  });

  it("names a PUBLIC reference for the kinds Chromium loads from the document's own origin only", () => {
    expect(
      scan(`<svg><use href="https://cdn.example/icons.svg#a"/>
        <image href="https://cdn.example/photo.png"/>
        <rect filter="url(https://cdn.example/f.svg#f)" mask="url(https://cdn.example/m.svg#m)"/>
        <rect filter="url(#local)"/></svg>
        <div style="filter:url('https://cdn.example/css.svg#f');mask-image:url(https://cdn.example/mask.png)"></div>
        <video src="https://cdn.example/v.mp4"><track src="https://cdn.example/t.vtt"></video>`),
    ).toEqual([
      "https://cdn.example/icons.svg#a",
      "https://cdn.example/f.svg#f",
      "https://cdn.example/css.svg#f",
      "https://cdn.example/t.vtt",
    ]);
  });

  it("follows an absolute <base> — relative references then load — but not a relative one", () => {
    expect(
      scan(`<img src="logo.png">`, `<base href="https://site.example/">`),
    ).toEqual([]);
    expect(scan(`<img src="logo.png">`, `<base href="assets/">`)).toEqual([
      "logo.png",
    ]);
    expect(
      scan(`<img src="logo.png">`, `<base href="file:///C:/site/">`),
    ).toEqual(["logo.png"]);
  });
});

describe("unbundledAssetsNote", () => {
  it("says nothing when nothing is missing", () => {
    expect(unbundledAssetsNote({ references: [] })).toBeNull();
  });

  it("names the first missing file and the count", () => {
    expect(unbundledAssetsNote({ references: ["logo.png"] })).toBe(
      "1 linked file (logo.png) is not part of this upload and will be missing from the PDF. Embed it in the HTML, or link it with a full https:// address.",
    );
    expect(
      unbundledAssetsNote({ references: ["logo.png", "a.css", "b.png"] }),
    ).toBe(
      "3 linked files (e.g. logo.png) are not part of this upload and will be missing from the PDF. Embed them in the HTML, or link them with full https:// addresses.",
    );
  });
});
