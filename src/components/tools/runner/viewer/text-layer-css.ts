/**
 * The selectable text layer's styles: pdf.js's own `.textLayer` rules
 * (pdfjs-dist/web/pdf_viewer.css, 6.2), cut to what `TextLayer` relies on
 * and scoped to the viewer, plus the search highlight. Inline in this lazy
 * chunk rather than in the site's stylesheet, so no page pays for them
 * until a PDF is open.
 *
 * `TextLayer` sizes its container from `--total-scale-factor` (CSS px per
 * point, set on the page by the viewer) and turns it with
 * `data-main-rotation`, so the rules for those two are what keeps each
 * span over its glyphs at every zoom and turn.
 */
export const TEXT_LAYER_CSS = `
[data-pdf-viewer] .textLayer{position:absolute;text-align:initial;inset:0;overflow:clip;opacity:1;line-height:1;letter-spacing:normal;word-spacing:normal;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:CanvasText;z-index:0;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
[data-pdf-viewer] .textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;-webkit-user-select:text;user-select:text}
[data-pdf-viewer] .textLayer > :not(.markedContent),[data-pdf-viewer] .textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
[data-pdf-viewer] .textLayer .markedContent{display:contents}
[data-pdf-viewer] .textLayer ::selection{background:rgba(0 0 255 / 0.25);background:color-mix(in srgb, AccentColor, transparent 50%);color:transparent}
[data-pdf-viewer] .textLayer br::selection{background:transparent}
[data-pdf-viewer] .textLayer .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;-webkit-user-select:none;user-select:none}
[data-pdf-viewer] .textLayer.selecting .endOfContent{top:0}
[data-pdf-viewer] .textLayer[data-main-rotation="90"]{transform:rotate(90deg) translateY(-100%)}
[data-pdf-viewer] .textLayer[data-main-rotation="180"]{transform:rotate(180deg) translate(-100%,-100%)}
[data-pdf-viewer] .textLayer[data-main-rotation="270"]{transform:rotate(270deg) translateX(-100%)}
[data-pdf-viewer] .textLayer mark[data-viewer-hit]{position:static;color:transparent;background:rgb(255 200 0 / 0.45);border-radius:2px;margin:-1px;padding:1px}
[data-pdf-viewer] .textLayer mark[data-viewer-hit="active"]{background:rgb(255 120 0 / 0.6);outline:2px solid rgb(200 80 0)}
@media (forced-colors: active){[data-pdf-viewer] .textLayer mark[data-viewer-hit]{background:Highlight;forced-color-adjust:none}}
`;
