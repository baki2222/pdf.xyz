"use client";

import { useId, useRef, useState } from "react";
import { ScanSearch, Search, X } from "lucide-react";
import {
  MAX_FOUND,
  PII_CATEGORIES,
  PII_OPTIONS,
  type PiiCategory,
} from "@/lib/pdf/redact-categories";
import type {
  FoundKind,
  FoundText,
  RedactTextIndex,
} from "@/lib/pdf/redact-find";
import { formatPageNumbers } from "@/lib/pdf/ranges";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorNote, RunnerSection, Spinner, errorMessage } from "./runner-kit";
import { NoSelectableTextNote } from "./no-text-note";

/**
 * Redact PDF's "Find text to redact" and "Detect personal data": both read
 * the PDF's selectable text once (`readRedactText`), add what they find to
 * one review list, and every ticked line in that list becomes redaction
 * boxes when the PDF is redacted. Nothing is redacted from here.
 */

const KIND_LABEL: Record<FoundKind, string> = {
  search: "Search",
  email: "Email",
  phone: "Phone",
  card: "Card",
  iban: "IBAN",
  dob: "Date of birth",
};

export function RedactFindPanel({
  bytes,
  found,
  chosen,
  onFound,
  onToggle,
  onToggleAll,
  onClear,
}: {
  bytes: Uint8Array;
  found: readonly FoundText[];
  chosen: ReadonlySet<string>;
  onFound: (matches: FoundText[]) => void;
  onToggle: (key: string) => void;
  onToggleAll: (on: boolean) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [categories, setCategories] = useState<Set<PiiCategory>>(
    () => new Set(PII_CATEGORIES),
  );
  const [busy, setBusy] = useState<"search" | "detect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [index, setIndex] = useState<RedactTextIndex | null>(null);
  const indexRef = useRef<Promise<RedactTextIndex> | null>(null);
  const ids = { query: useId(), matchCase: useId(), wholeWord: useId() };

  const readIndex = async (): Promise<RedactTextIndex> => {
    if (!indexRef.current) {
      indexRef.current = import("@/lib/pdf/redact-find")
        .then((m) => m.readRedactText(bytes))
        .then((read) => {
          setIndex(read);
          return read;
        })
        .catch((err: unknown) => {
          indexRef.current = null;
          throw err;
        });
    }
    return indexRef.current;
  };

  const runFind = async (kind: "search" | "detect") => {
    setError(null);
    setStatus(null);
    setBusy(kind);
    try {
      const read = await readIndex();
      const m = await import("@/lib/pdf/redact-find");
      if (kind === "search") {
        const { matches, capped } = m.findTextMatches(read, query, {
          matchCase,
          wholeWord,
        });
        onFound(matches);
        setStatus(
          matches.length === 0
            ? `No matches for “${query.trim()}”.`
            : `${matches.length}${capped ? "+" : ""} match${matches.length === 1 ? "" : "es"} for “${query.trim()}” added to the list below${capped ? ` (the first ${MAX_FOUND})` : ""}.`,
        );
      } else {
        const matches = m.detectPersonalData(read, [...categories]);
        onFound(matches);
        setStatus(
          matches.length === 0
            ? "Nothing in the ticked categories was found."
            : `${matches.length} item${matches.length === 1 ? "" : "s"} found and added to the list below.`,
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const noTextAtAll =
    index !== null && index.pagesWithoutText.length === index.pageCount;
  const someNoText =
    index !== null && !noTextAtAll && index.pagesWithoutText.length > 0;

  const toggleCategory = (c: PiiCategory) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const chosenCount = found.filter((f) => chosen.has(f.key)).length;

  return (
    <RunnerSection title="Find text to redact">
      <div className="flex flex-col gap-4">
        <form
          className="border-line bg-wash rounded-panel flex flex-col gap-3 border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim() && !busy) void runFind("search");
          }}
        >
          <label htmlFor={ids.query} className="text-fg text-sm font-medium">
            Search the text
          </label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              id={ids.query}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="A name, a number, a word…"
              spellCheck={false}
              className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl min-w-0 flex-1 border px-3.5 py-2 text-sm transition outline-none focus:ring-2"
            />
            <button
              type="submit"
              aria-disabled={!query.trim() || busy !== null || undefined}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {busy === "search" ? (
                <Spinner />
              ) : (
                <Search className="size-4" aria-hidden />
              )}
              Find
            </button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label
              htmlFor={ids.matchCase}
              className="text-fg inline-flex items-center gap-2"
            >
              <input
                id={ids.matchCase}
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
              />
              Match case
            </label>
            <label
              htmlFor={ids.wholeWord}
              className="text-fg inline-flex items-center gap-2"
            >
              <input
                id={ids.wholeWord}
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
              />
              Whole word
            </label>
          </div>
        </form>

        <fieldset className="border-line bg-wash rounded-panel flex flex-col gap-3 border p-4">
          <legend className="text-fg px-1 text-sm font-medium">
            Detect personal data
          </legend>
          <ul className="grid gap-2 sm:grid-cols-2">
            {PII_OPTIONS.map((option) => (
              <li key={option.id}>
                <label className="text-fg flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={categories.has(option.id)}
                    onChange={() => toggleCategory(option.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    {option.label}
                    <span className="text-muted block text-xs">
                      {option.hint}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted text-xs">
              Pattern and checksum matching on the page text. Check the list: it
              can miss a format it does not know.
            </p>
            <button
              type="button"
              onClick={() => {
                if (categories.size > 0 && !busy) void runFind("detect");
              }}
              aria-disabled={
                categories.size === 0 || busy !== null || undefined
              }
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {busy === "detect" ? (
                <Spinner />
              ) : (
                <ScanSearch className="size-4" aria-hidden />
              )}
              Detect
            </button>
          </div>
        </fieldset>

        {busy && !index && (
          <p
            className="text-muted inline-flex items-center gap-2 text-sm"
            role="status"
          >
            <Spinner />
            Reading the PDF&apos;s text…
          </p>
        )}
        {status && (
          <p className="text-muted text-sm" role="status">
            {status}
          </p>
        )}
        {error && <ErrorNote message={error} />}
        {noTextAtAll && (
          <NoSelectableTextNote extra="Then search the recognized copy here, or draw areas by position below." />
        )}
        {someNoText && (
          <p className="text-muted text-xs">
            {index.pagesWithoutText.length === 1 ? "Page" : "Pages"}{" "}
            {formatPageNumbers(index.pagesWithoutText)}{" "}
            {index.pagesWithoutText.length === 1 ? "has" : "have"} no selectable
            text, so nothing on{" "}
            {index.pagesWithoutText.length === 1 ? "it" : "them"} can be found.
            Cover {index.pagesWithoutText.length === 1 ? "it" : "them"} with
            areas by position.
          </p>
        )}

        {found.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-fg text-sm font-medium">
                Review · {chosenCount} of {found.length} will be redacted
              </p>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => onToggleAll(chosenCount < found.length)}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  {chosenCount < found.length ? "Tick all" : "Untick all"}
                </button>
                <button
                  type="button"
                  onClick={onClear}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  <X className="size-4" aria-hidden />
                  Clear list
                </button>
              </div>
            </div>
            <ul
              className="flex max-h-72 flex-col gap-1.5 overflow-auto pr-1"
              aria-label="Text to redact"
            >
              {found.map((f) => (
                <li key={f.key}>
                  <label
                    className={cn(
                      "border-line bg-wash rounded-ctl flex items-start gap-3 border px-3 py-2 text-sm",
                      !chosen.has(f.key) && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(f.key)}
                      onChange={() => onToggle(f.key)}
                      className="mt-1"
                      aria-label={`Redact “${f.text}” on page ${f.page}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-muted flex flex-wrap gap-x-2 text-xs">
                        <span className="rounded-tag bg-accent/10 text-accent px-1.5 font-medium">
                          {KIND_LABEL[f.kind]}
                        </span>
                        Page {f.page}
                      </span>
                      <span className="text-muted block wrap-anywhere">
                        {f.before && <>…{f.before}</>}
                        <mark className="bg-warn/10 text-fg rounded-tag px-0.5">
                          {f.text}
                        </mark>
                        {f.after && <>{f.after}…</>}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </RunnerSection>
  );
}
