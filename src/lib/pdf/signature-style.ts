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
 * The four faces were chosen for look AND weight: the panel previews every
 * style in its real face when the Type tab opens, so the set is one download
 * (352 KB, once, immutably cached). Great Vibes (445 KB) and Caveat (257 KB)
 * were the first picks and would have made it 892 KB.
 */
export const DEFAULT_SIGNATURE_STYLE: SignatureStyle = "dancing-script";

export function isHandwritingStyle(style: string): style is HandwritingStyle {
  return (HANDWRITING_STYLES as readonly string[]).includes(style);
}

export function isSignatureStyle(style: unknown): style is SignatureStyle {
  return (
    typeof style === "string" &&
    (SIGNATURE_STYLES as readonly string[]).includes(style)
  );
}
