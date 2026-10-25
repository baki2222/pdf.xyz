"use client";

/**
 * The OCR language picker — OCR PDF's, and since 2026-10-24 also PDF to
 * Word's "Recognise text in scans (OCR)". Moved here from
 * `ocr-worker-panel.tsx` unchanged, so both panels offer the same languages,
 * narrowed by the same worker report, with the same warning about choosing
 * the wrong one.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Languages } from "lucide-react";
import {
  DEFAULT_OCR_LANGUAGE,
  MAX_OCR_LANGUAGES,
  OCR_LANGUAGES,
  OCR_LANGUAGE_CODES,
  type OcrLanguage,
} from "@/lib/jobs/ocr";
import { ocrLanguagesFromBrowser } from "@/lib/jobs/ocr-browser-languages";
import type { WorkerStatus } from "@/lib/workers/status";
import { cn } from "@/lib/utils";

/** The browser's pick, read once per page — the server has no `navigator`. */
let browserPick: OcrLanguage[] | null | undefined;
function readBrowserPick(): OcrLanguage[] | null {
  if (browserPick !== undefined) return browserPick;
  let tags: readonly string[] = [];
  try {
    tags = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
  } catch {
    tags = [];
  }
  const langs = ocrLanguagesFromBrowser(tags);
  // English alone is the default already; there is nothing to explain.
  browserPick =
    langs.length > 1 || langs[0] !== DEFAULT_OCR_LANGUAGE ? langs : null;
  return browserPick;
}
const noSubscription = () => () => {};

/**
 * `navigator.languages ∩ OCR_LANGUAGES` (spec D.7) — `null` on the server and
 * through hydration (its snapshot), then the browser's answer, so the HTML
 * and the first client render agree.
 */
function useBrowserLanguages(): OcrLanguage[] | null {
  return useSyncExternalStore(noSubscription, readBrowserPick, () => null);
}

export interface OcrLanguageChoice {
  /** What would be sent: the picks minus any pack the worker lacks. */
  selected: OcrLanguage[];
  /** The packs the worker reports (the whole catalogue until it reports). */
  installed: ReadonlySet<string>;
  /** True while the picks are the browser's, not the reader's. */
  browserChose: boolean;
  toggle: (code: OcrLanguage) => void;
  /** The languages this tool offers — the chips drawn; OCR PDF's all. */
  offered: readonly OcrLanguage[];
}

/**
 * `offered` narrows the catalogue for a tool that cannot use all of it —
 * PDF to Word's OCR option leaves out right-to-left scripts
 * (`PDF_TO_WORD_OCR_LANGUAGE_CODES`). A browser pick outside it is dropped
 * exactly as an uninstalled pack is.
 */
export function useOcrLanguageChoice(
  status: WorkerStatus | null | undefined,
  offered: readonly OcrLanguage[] = OCR_LANGUAGE_CODES,
): OcrLanguageChoice {
  // The reader's own picks, once they make one; until then the browser's.
  const [chosen, setChosen] = useState<OcrLanguage[] | null>(null);
  const fromBrowser = useBrowserLanguages();
  const languages = useMemo(
    () => chosen ?? fromBrowser ?? [DEFAULT_OCR_LANGUAGE],
    [chosen, fromBrowser],
  );

  // The packs the worker reports it actually has. Until 2026-09-27 the menu
  // rendered the static catalogue whatever the status said — the heartbeat's
  // report reached the status payload and stopped there, while the FAQ told
  // search results the page reflects it. With no report to read (status still
  // loading, unreachable, or OCR not available) there is nothing to narrow
  // by, so the catalogue stands.
  const installed = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        (status?.ocr.available
          ? status.ocr.languages
          : OCR_LANGUAGE_CODES
        ).filter((code) => (offered as readonly string[]).includes(code)),
      ),
    [status, offered],
  );

  // What is really selected: the user's picks minus any pack the worker lacks.
  // Derived rather than stored, so the report arriving AFTER a pick still
  // removes it. If that empties the selection (the default English on a worker
  // without it), fall back to the first installed language — the request must
  // never carry a code the worker will refuse.
  const selected = useMemo<OcrLanguage[]>(() => {
    const kept = languages.filter((code) => installed.has(code));
    if (kept.length > 0) return kept;
    const first = OCR_LANGUAGE_CODES.find((code) => installed.has(code));
    return first ? [first] : languages;
  }, [languages, installed]);

  const toggle = useCallback(
    (code: OcrLanguage) => {
      // No check for an uninstalled code here: `selected` drops it on the next
      // render, so a click on a chip the worker cannot run changes nothing.
      const prev = selected;
      if (prev.includes(code)) {
        if (prev.length === 1) return; // keep at least one language
        setChosen(prev.filter((entry) => entry !== code));
        return;
      }
      if (prev.length >= MAX_OCR_LANGUAGES) return; // respect the cap
      setChosen([...prev, code]);
    },
    [selected],
  );

  return {
    selected,
    installed,
    browserChose: chosen === null && fromBrowser !== null,
    toggle,
    offered,
  };
}

/** The "Languages" block: heading, the wrong-language warning, the chips. */
export function OcrLanguagePicker({ choice }: { choice: OcrLanguageChoice }) {
  const { selected, installed, browserChose, toggle, offered } = choice;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted inline-flex items-center gap-1.5 text-xs font-medium">
        <Languages className="size-3.5" aria-hidden />
        Languages{" "}
        <span className="text-muted">(up to {MAX_OCR_LANGUAGES})</span>
      </span>
      {/*
          The single most useful sentence on this page. OCR against the wrong
          language does not fail — it returns confident-looking nonsense — so a
          user who leaves the default alone gets a successful job and unusable
          output, with nothing anywhere to tell them why.
        */}
      <p className="text-muted text-xs leading-relaxed">
        Select every language printed on the page — a page that mixes Bengali
        with English technical terms needs both. The wrong language does not
        produce an error, it produces plausible-looking gibberish.
      </p>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="OCR languages"
      >
        {OCR_LANGUAGES.filter((language) =>
          offered.includes(language.code),
        ).map((language) => {
          const active = selected.includes(language.code);
          const notInstalled = !installed.has(language.code);
          const atCap = !active && selected.length >= MAX_OCR_LANGUAGES;
          return (
            <button
              key={language.code}
              type="button"
              // aria-disabled, never native: the cap flips exactly while the
              // user is picking languages, and a natively disabled chip would
              // eject their focus and leave the tab order (the #46 rule).
              // toggle respects the cap; `selected` the report.
              onClick={() => toggle(language.code)}
              aria-disabled={notInstalled || atCap || undefined}
              aria-pressed={active}
              title={
                notInstalled
                  ? "Not installed on the current worker — it has no recognition pack for this language."
                  : atCap
                    ? `Deselect a language first — at most ${MAX_OCR_LANGUAGES} at once.`
                    : undefined
              }
              className={cn(
                "rounded-tag inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
                active
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-wash text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
              )}
            >
              {active && <Check className="size-3" aria-hidden />}
              {language.label}
            </button>
          );
        })}
      </div>
      {browserChose && (
        <p className="text-muted text-xs leading-relaxed" data-ocr-reason="">
          Chosen from your browser&apos;s languages. Change them if the page is
          printed in others.
        </p>
      )}
    </div>
  );
}
