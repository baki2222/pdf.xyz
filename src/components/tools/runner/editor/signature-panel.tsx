"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { ImageSignature } from "@/lib/pdf/signature";
import { isOpaque, type RgbaImage } from "@/lib/pdf/signature-image";
import {
  HANDWRITING_STYLES,
  SIGNATURE_SOURCES,
  SIGNATURE_SOURCE_LABEL,
  SIGNATURE_STYLES,
  SIGNATURE_STYLE_LABEL,
  type HandwritingStyle,
  type SignatureStyle,
} from "@/lib/pdf/offered-kinds";
import {
  DEFAULT_SIGNATURE_STYLE,
  isHandwritingStyle,
  typedSignatureText,
} from "@/lib/pdf/signature-style";
import {
  handwritingMissing,
  handwritingMissingLabels,
} from "@/lib/pdf/handwriting";
import {
  PREVIEW_LINE_EMS,
  handwritingFamily,
  loadHandwritingFamily,
  loadHandwritingMeasure,
} from "./handwriting-faces";
import {
  SIGNATURE_INKS,
  type SignatureInk,
} from "@/lib/pdf/editor/signature-ink";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dropzone } from "../runner-kit";
import { SignaturePad } from "../signature-pad";
import { decodeImageFile, signatureFromPixels } from "../signature-bitmap";
import type { Pending } from "./editor-state";
import {
  readSavedSignatures,
  saveSignature,
  bytesOfDataUrl,
  forgetSignature,
  type NotSavedReason,
  type SaveResult,
  type SavedSignature,
} from "@/lib/pdf/editor/saved-signatures";

/**
 * Make a signature to place: draw it, type it, or pick a picture of one —
 * the same three sources Sign PDF has always offered (`SIGNATURE_SOURCES`),
 * through the same pad and the same bitmap preparation
 * (`signature-bitmap.ts`, `signature-image.ts`):
 *
 *  - drawn: the pad's ink, cropped to it;
 *  - typed: placed as TEXT, not a picture — in a handwriting face
 *    (`HANDWRITING_STYLES`, previewed in the very face the PDF embeds), or
 *    the Script (Times Italic) or Print (Helvetica) face. A name with a
 *    letter a handwriting face does not have is set as Script sets it, and
 *    the panel says which letters, under the styles;
 *  - uploaded: cropped to the ink, its paper keyed out unless "Remove paper
 *    background" is unticked (shown only for a file with no transparency).
 *
 * Draw and Type take an ink from `SIGNATURE_INKS` (audit sign-pdf#2): the
 * pad strokes in it and a typed name is written in it. An uploaded picture
 * keeps the colours it has, so the swatches are not shown for it.
 *
 * "Save for next time" is opt-in and keeps the signature in this browser's
 * storage only (`./saved-signatures`); nothing is ever sent anywhere.
 */

/** What the reader is told when "Save for next time" could not keep it. */
const SIGNATURE_NOT_SAVED_MESSAGE: Record<NotSavedReason, string> = {
  too_large:
    "This signature couldn’t be saved for next time: the picture is too large to keep in this browser.",
  storage:
    "This signature couldn’t be saved for next time: this browser’s storage is full or blocked for this site.",
};

/** Script and Print preview in the browser's lookalikes of Times and Helvetica. */
const SCRIPT_PREVIEW = '"Times New Roman", Times, serif';
const PRINT_PREVIEW = "Helvetica, Arial, sans-serif";

/**
 * One previewed line: its height IS its line height, both tall enough for
 * the tallest handwriting face's ink (`PREVIEW_LINE_EMS`), so a fixed box
 * neither clips a descender nor moves when a face arrives.
 */
const PREVIEW_LINE = {
  lineHeight: `${PREVIEW_LINE_EMS}em`,
  height: `${PREVIEW_LINE_EMS}em`,
} as const;

/**
 * How a style previews `name`: a handwriting face that has every letter in
 * itself (the face the PDF embeds), and otherwise as Script — which is how
 * the export sets that name (`handwritingFor`). Asked of the name as the
 * export will hold it (`typedSignatureText`), never of the raw keystrokes.
 */
function previewFont(
  style: SignatureStyle,
  name: string,
): { fontFamily: string; fontStyle: "italic" | "normal" } {
  if (
    isHandwritingStyle(style) &&
    handwritingMissing(style, typedSignatureText(name)).length === 0
  )
    return {
      fontFamily: `"${handwritingFamily(style)}", cursive`,
      fontStyle: "normal",
    };
  if (style === "print")
    return { fontFamily: PRINT_PREVIEW, fontStyle: "normal" };
  return { fontFamily: SCRIPT_PREVIEW, fontStyle: "italic" };
}

const MISSING_LIST = new Intl.ListFormat("en", { type: "disjunction" });

/**
 * The sentence under the styles when the chosen handwriting face cannot draw
 * the name, or null. Exported for the test that types such a name.
 */
export function handwritingFallbackNote(
  style: SignatureStyle,
  name: string,
): string | null {
  if (!isHandwritingStyle(style)) return null;
  // Readable labels: a script the face has none of by name, an invisible or
  // combining character as its code point — never a blank or an orphaned
  // vowel sign (`handwritingMissingLabels`).
  const missing = handwritingMissingLabels(
    style,
    typedSignatureText(name.trim()),
  );
  if (missing.length === 0) return null;
  const shown = MISSING_LIST.format(missing.slice(0, 8));
  return `${SIGNATURE_STYLE_LABEL[style]} has no ${shown}, so this name will be set as ${SIGNATURE_STYLE_LABEL.signature} sets it.`;
}

function sizeOf(
  sig: ImageSignature,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(sig.bytes).buffer], {
        type: sig.format === "png" ? "image/png" : "image/jpeg",
      }),
    );
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 3, height: img.naturalHeight || 1 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 3, height: 1 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

async function pendingOf(sig: ImageSignature): Promise<Pending> {
  const size = await sizeOf(sig);
  return { kind: "signature", format: sig.format, bytes: sig.bytes, ...size };
}

function SavedThumb({ saved }: { saved: SavedSignature }) {
  if (saved.kind === "typed") {
    return (
      <span
        className="text-fg truncate text-lg"
        style={{
          color: saved.color,
          ...PREVIEW_LINE,
          ...previewFont(saved.style, saved.text),
        }}
      >
        {saved.text}
      </span>
    );
  }
  return (
    // A data URL held in this browser: a thumbnail, not a page image.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={saved.dataUrl} alt="" className="h-8 max-w-full object-contain" />
  );
}

/**
 * The typed signature's styles as one radio group: every option shows the
 * name (or, before one is typed, the style's own name) in the face the PDF
 * will get, in a box of fixed size — 64 px tall, two to a row on a phone,
 * with a preview line tall enough for Homemade Apple's ink — so a face
 * arriving late moves nothing and no descender is cut. One tab stop, the checked option;
 * the arrows move the choice and the focus with it, wrapping.
 */
function StylePicker({
  style,
  name,
  ink,
  onPick,
  onReach,
}: {
  style: SignatureStyle;
  name: string;
  ink: string;
  onPick: (style: SignatureStyle) => void;
  /** The reader is reaching for the options: fetch every face. */
  onReach: () => void;
}) {
  const note = handwritingFallbackNote(style, name);
  const sample = typedSignatureText(name.trim());
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Style"
        className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
        onPointerEnter={onReach}
        onFocus={onReach}
      >
        {SIGNATURE_STYLES.map((s, at) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={style === s}
            aria-label={SIGNATURE_STYLE_LABEL[s]}
            data-style={s}
            tabIndex={style === s ? 0 : -1}
            onKeyDown={(e) => {
              const step =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              e.preventDefault();
              const n = SIGNATURE_STYLES.length;
              const to = (at + step + n) % n;
              onPick(SIGNATURE_STYLES[to]!);
              const radios =
                e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                  '[role="radio"]',
                );
              radios?.[to]?.focus();
            }}
            onClick={() => onPick(s)}
            className={cn(
              "rounded-ctl flex h-16 min-w-0 flex-col items-start justify-center overflow-hidden border px-2 text-left",
              style === s
                ? "border-accent ring-accent/40 bg-accent/10 ring-2"
                : "border-line hover:border-accent/40",
            )}
          >
            <span
              aria-hidden
              className="block w-full truncate text-xl"
              style={{ color: ink, ...PREVIEW_LINE, ...previewFont(s, sample) }}
            >
              {sample || SIGNATURE_STYLE_LABEL[s]}
            </span>
            <span aria-hidden className="text-muted text-[11px] leading-4">
              {SIGNATURE_STYLE_LABEL[s]}
            </span>
          </button>
        ))}
      </div>
      <p
        aria-live="polite"
        data-style-fallback=""
        className={cn("text-muted text-xs", !note && "sr-only")}
      >
        {note ?? ""}
      </p>
    </>
  );
}

export function SignaturePanel({
  onReady,
  onClose,
}: {
  /**
   * `notice`: said with the signature when "Save for next time" was ticked
   * and the browser did not keep it (audit #50). The panel closes on use, so
   * the editor is where the reader can be told.
   */
  onReady: (pending: Pending, notice?: string) => void;
  onClose: () => void;
}) {
  // Opens on Type, as Sign PDF always has, so signing works without a
  // pointer.
  const [source, setSource] =
    useState<(typeof SIGNATURE_SOURCES)[number]>("type");
  const [drawn, setDrawn] = useState<ImageSignature | null>(null);
  const [name, setName] = useState("");
  const [style, setStyle] = useState<SignatureStyle>(DEFAULT_SIGNATURE_STYLE);
  // Set once the reader types a name or reaches for the Style options: from
  // then on every handwriting face is fetched, so every option previews in
  // its own face.
  const [reachedStyles, setReachedStyles] = useState(false);
  // Bumped as each handwriting face arrives, so the previews redraw in it.
  const [, setFacesLoaded] = useState(0);
  const [ink, setInk] = useState<SignatureInk["hex"]>(SIGNATURE_INKS[0].hex);
  const [uploadPixels, setUploadPixels] = useState<RgbaImage | null>(null);
  const [uploadIsPhoto, setUploadIsPhoto] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [uploaded, setUploaded] = useState<ImageSignature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<SavedSignature[]>(() =>
    readSavedSignatures(),
  );
  const prepareSeq = useRef(0);
  const uploadedUrl = useMemo(
    () =>
      uploaded
        ? URL.createObjectURL(
            new Blob([new Uint8Array(uploaded.bytes).buffer], {
              type: uploaded.format === "png" ? "image/png" : "image/jpeg",
            }),
          )
        : null,
    [uploaded],
  );
  useEffect(
    () => () => {
      if (uploadedUrl) URL.revokeObjectURL(uploadedUrl);
    },
    [uploadedUrl],
  );

  // Which handwriting faces to fetch, and when — never with the page. The
  // panel opens on Type, so showing it fetches only the face of the style
  // that is picked (the default, Dancing Script, ~46 KB gzipped); the other faces
  // wait until the reader types a name or reaches for the Style options
  // (`reachedStyles`), so a reader who goes straight to Draw or Upload pays
  // for one face, not four (review of sign-pdf#1). A saved typed signature's
  // face loads with it, for its thumbnail. Each preview box has a fixed
  // size, so a face swapping in moves nothing.
  const wantedFaces = useMemo(() => {
    const wanted = new Set<HandwritingStyle>();
    if (source === "type") {
      if (isHandwritingStyle(style)) wanted.add(style);
      if (reachedStyles) for (const s of HANDWRITING_STYLES) wanted.add(s);
    }
    for (const s of saved)
      if (s.kind === "typed" && isHandwritingStyle(s.style))
        wanted.add(s.style);
    return [...wanted].sort().join(" ");
  }, [source, style, reachedStyles, saved]);
  useEffect(() => {
    if (!wantedFaces) return;
    let alive = true;
    for (const s of wantedFaces.split(" ") as HandwritingStyle[]) {
      void loadHandwritingFamily(s)
        .then(() => {
          if (alive) setFacesLoaded((n) => n + 1);
        })
        .catch(() => {
          // The preview stays in the fallback; placing asks again and says
          // why if the face still cannot be fetched.
        });
    }
    return () => {
      alive = false;
    };
  }, [wantedFaces]);

  // Re-prepare the upload when the paper toggle moves; only the latest lands.
  useEffect(() => {
    if (!uploadPixels) return;
    const seq = ++prepareSeq.current;
    void signatureFromPixels(uploadPixels, { removeBackground })
      .catch(() => null)
      .then((sig) => {
        if (seq !== prepareSeq.current) return;
        setUploaded(sig);
        setError(
          sig
            ? null
            : "We couldn't find a signature in that image. Use a photo or scan of dark ink on light paper, or a PNG with a transparent background.",
        );
      });
  }, [uploadPixels, removeBackground]);

  const onUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    // The previous file stops being the signature the moment a new one is
    // dropped: it must not be used while this one decodes, and a paper toggle
    // in the meantime must not re-prepare it (sign-runner.test.tsx).
    prepareSeq.current += 1;
    setUploaded(null);
    setUploadPixels(null);
    try {
      const pixels = await decodeImageFile(file);
      setUploadIsPhoto(isOpaque(pixels));
      setUploadPixels(pixels);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That image can't be used.",
      );
    }
  };

  /** Show what storage holds; the notice to pass on when it did not keep it. */
  const keep = (result: SaveResult): string | undefined => {
    setSaved(result.list);
    return result.kept ? undefined : SIGNATURE_NOT_SAVED_MESSAGE[result.reason];
  };

  const use = async () => {
    setError(null);
    if (source === "type") {
      const text = typedSignatureText(name.trim());
      if (!text) return setError("Type your name first.");
      // A handwriting face that will draw this name must be HERE before the
      // editor sizes the box, or the box would be as wide as the fallback.
      if (
        isHandwritingStyle(style) &&
        !handwritingMissing(style, text).length
      ) {
        try {
          await loadHandwritingMeasure(style);
        } catch (err) {
          return setError(
            err instanceof Error
              ? err.message
              : `The ${SIGNATURE_STYLE_LABEL[style]} font could not be loaded.`,
          );
        }
      }
      const notice = remember
        ? keep(saveSignature({ kind: "typed", text, style, color: ink }))
        : undefined;
      onReady({ kind: "typed", text, style, color: ink }, notice);
      return;
    }
    const sig = source === "draw" ? drawn : uploaded;
    if (!sig) {
      return setError(
        source === "draw"
          ? "Draw your signature first."
          : "Choose a picture of your signature first.",
      );
    }
    const notice = remember
      ? keep(saveSignature({ kind: "image", sig }))
      : undefined;
    onReady(await pendingOf(sig), notice);
  };

  const reuse = async (s: SavedSignature) => {
    if (s.kind === "typed") {
      if (
        isHandwritingStyle(s.style) &&
        !handwritingMissing(s.style, typedSignatureText(s.text)).length
      ) {
        try {
          await loadHandwritingMeasure(s.style);
        } catch (err) {
          return setError(
            err instanceof Error
              ? err.message
              : `The ${SIGNATURE_STYLE_LABEL[s.style]} font could not be loaded.`,
          );
        }
      }
      onReady({
        kind: "typed",
        text: s.text,
        style: s.style,
        ...(s.color ? { color: s.color } : {}),
      });
      return;
    }
    const bytes = bytesOfDataUrl(s.dataUrl);
    if (!bytes) {
      setSaved(forgetSignature(s.id));
      return setError(
        "That saved signature could not be read; it was removed.",
      );
    }
    onReady(await pendingOf({ kind: "image", format: s.format, bytes }));
  };

  return (
    <div
      role="region"
      aria-label="Create a signature"
      className="border-line bg-panel rounded-panel flex flex-col gap-3 border p-4 shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Signature source"
          className="flex gap-1"
        >
          {SIGNATURE_SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              onClick={() => setSource(s)}
              className={cn(
                "rounded-ctl h-11 border px-3 py-1 text-xs font-medium",
                source === s
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line text-muted hover:text-fg",
              )}
            >
              {SIGNATURE_SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close signature panel"
          className="text-muted hover:text-fg rounded-ctl grid h-11 w-11 place-items-center"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {saved.length > 0 && (
        <section
          aria-label="Saved signatures"
          className="flex flex-col gap-1.5"
        >
          <h4 className="text-faint kicker">Saved on this device</h4>
          <ul className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <li
                key={s.id}
                className="border-line bg-canvas rounded-ctl flex items-center gap-1 border pl-2"
              >
                <button
                  type="button"
                  onClick={() => void reuse(s)}
                  aria-label={`Use saved signature${s.kind === "typed" ? ` “${s.text}”` : ""}`}
                  className="flex max-w-40 items-center overflow-hidden py-1"
                >
                  <SavedThumb saved={s} />
                </button>
                <button
                  type="button"
                  onClick={() => setSaved(forgetSignature(s.id))}
                  aria-label="Delete saved signature"
                  className="text-muted hover:text-err rounded-ctl p-1.5"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The pad stays mounted while another source is shown, so what is
          drawn on it (and its Clear) survives a switch — the defect Sign
          PDF's form had until its audit (sign-runner.test.tsx). The hidden
          wrapper carries no display class to compete with `hidden`. */}
      {source !== "upload" && (
        <div
          role="radiogroup"
          aria-label="Ink colour"
          className="flex flex-wrap items-center gap-1"
        >
          <span aria-hidden className="text-muted mr-1 text-xs font-medium">
            Ink
          </span>
          {SIGNATURE_INKS.map((i, at) => (
            <button
              key={i.id}
              type="button"
              role="radio"
              aria-checked={ink === i.hex}
              aria-label={i.label}
              title={i.label}
              // One tab stop, the checked swatch; the arrows move the choice
              // and the focus with it, wrapping (a radiogroup's keyboard).
              tabIndex={ink === i.hex ? 0 : -1}
              onKeyDown={(e) => {
                const step =
                  e.key === "ArrowRight" || e.key === "ArrowDown"
                    ? 1
                    : e.key === "ArrowLeft" || e.key === "ArrowUp"
                      ? -1
                      : 0;
                if (!step) return;
                e.preventDefault();
                const n = SIGNATURE_INKS.length;
                const to = (at + step + n) % n;
                setInk(SIGNATURE_INKS[to]!.hex);
                const radios =
                  e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    '[role="radio"]',
                  );
                radios?.[to]?.focus();
              }}
              onClick={() => setInk(i.hex)}
              className={cn(
                "rounded-ctl grid h-11 w-11 place-items-center border",
                ink === i.hex
                  ? "border-accent ring-accent/40 ring-2"
                  : "border-line",
              )}
            >
              <span
                aria-hidden
                className="size-5 rounded-full"
                style={{ backgroundColor: i.hex }}
              />
            </button>
          ))}
        </div>
      )}
      <div hidden={source !== "draw"}>
        <SignaturePad onChange={setDrawn} ink={ink} />
      </div>
      {source === "type" && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="editor-sign-name"
            className="text-muted text-xs font-medium"
          >
            Your name
          </label>
          <input
            id="editor-sign-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setReachedStyles(true);
            }}
            className="border-line bg-canvas text-fg rounded-ctl h-11 border px-3 py-2 text-sm"
          />
          <StylePicker
            style={style}
            name={name}
            ink={ink}
            onPick={setStyle}
            onReach={() => setReachedStyles(true)}
          />
          {name.trim() && (
            // A reserved line: the face swapping in changes no height.
            <p
              aria-hidden
              data-signature-preview=""
              className="text-fg truncate text-3xl"
              style={{
                color: ink,
                ...PREVIEW_LINE,
                ...previewFont(style, name),
              }}
            >
              {name}
            </p>
          )}
        </div>
      )}
      {source === "upload" && (
        <div className="flex flex-col gap-2">
          <Dropzone
            onFiles={(files) => void onUpload(files)}
            accept="image/png,image/jpeg"
            multiple={false}
            compact
            title="Drop a signature image, or"
            hint="PNG or JPEG · cropped to the ink and placed locally"
          />
          {uploadedUrl && (
            // A blob URL of the prepared picture, held in this tab.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadedUrl}
              alt="Signature preview"
              className="border-line rounded-ctl h-16 w-fit max-w-full border object-contain p-1"
            />
          )}
          {uploadIsPhoto && (
            <label className="text-muted tap-row flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={(e) => setRemoveBackground(e.target.checked)}
              />
              Remove paper background
            </label>
          )}
        </div>
      )}

      <label className="text-muted tap-row flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Save for next time
      </label>
      <p className="text-muted -mt-2 text-[11px] leading-snug">
        Saved signatures stay in this browser on this device. They are never
        uploaded, and you can delete them here.
      </p>

      {error && (
        <p role="alert" className="text-err text-xs">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void use()}
          className={buttonVariants({ variant: "primary", size: "md" })}
        >
          Use signature
        </button>
      </div>
    </div>
  );
}
