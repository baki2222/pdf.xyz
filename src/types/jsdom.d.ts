/**
 * `jsdom` ships no types and `@types/jsdom` is not installed, so the one member
 * the OOXML package checks use is declared here rather than cast away at the
 * call. Deliberately narrow: what is written here is what was exercised — a
 * window whose `DOMParser` is jsdom's own, a namespace-aware XML parser that
 * reports a malformed part as a `<parsererror>` document.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    readonly window: { readonly DOMParser: typeof DOMParser };
  }
}
