/**
 * What the typed signature's styles DO, as opposed to what they are called.
 *
 * Kept out of `offered-kinds.ts` on purpose: that leaf is in the first load
 * of every tool page (its labels feed the page copy), and nothing here is
 * needed before the signature panel or the editor's export runs — both
 * lazy. The list and the labels stay in the leaf; the default and the two
 * predicates live here, beside nothing heavier than the leaf itself.
 */
import {
  HANDWRITING_STYLES,
  SIGNATURE_STYLES,
  type HandwritingStyle,
  type SignatureStyle,
} from "./offered-kinds";

/**
 * The style the Type tab starts on. Dancing Script, deliberately: of the four
 * handwriting faces it is the most legible at signature size (Mr Dafoe and
 * Alex Brush are flourished, Homemade Apple is loose), it covers Latin
 * Extended and Vietnamese, so é, ł and ő are drawn rather than falling back
 * (Homemade Apple and Mr Dafoe have no ő), and it is an 81 KB fetch. Script
 * stays one click away, and every saved signature keeps the style it was
 * saved with.
 *
 * The four faces were chosen for look AND weight: once a name is typed (or
 * the options are reached) the panel previews every style in its real face,
 * so the set is one download (352 KB, ~197 KB gzipped, once, immutably
 * cached); before that only the picked style's face is fetched. Great Vibes
 * (445 KB) and Caveat (257 KB) were the first picks and would have made it
 * 892 KB.
 */
export const DEFAULT_SIGNATURE_STYLE: SignatureStyle = "dancing-script";

export function isHandwritingStyle(style: string): style is HandwritingStyle {
  return (HANDWRITING_STYLES as readonly string[]).includes(style);
}

/**
 * A typed name as every signature path stores, checks and draws it: in NFC,
 * so a name pasted in decomposed form ("e" + U+0301, as a macOS file name or
 * some PDFs give it) is the one letter é, and with every space separator
 * (`\p{Zs}`: the no-break space a web page or Word pastes, thin, ideographic)
 * a plain space. The coverage check, the embed and the draw must all see
 * the SAME letters: a face asked about "e + U+0301" said yes and pdf-lib then
 * drew the accent beside the e, since it applies no mark positioning
 * (review of sign-pdf#1). Applied at the source — the panel, the editor's
 * `typedSignatureObject`, `signPdf` — never only at the check.
 */
export function typedSignatureText(text: string): string {
  return text.normalize("NFC").replace(/\p{Zs}/gu, " ");
}

export function isSignatureStyle(style: unknown): style is SignatureStyle {
  return (
    typeof style === "string" &&
    (SIGNATURE_STYLES as readonly string[]).includes(style)
  );
}
