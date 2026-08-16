"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Download, Info, Lock, PenLine, TriangleAlert } from "lucide-react";
import { filledFormsOutputName, isFillableType } from "@/lib/pdf/forms-meta";
import type {
  FieldValue,
  FormFieldInfo,
  FormInspection,
  FillFormsResult,
} from "@/lib/pdf/forms";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ErrorNote,
  errorMessage,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

export function FillFormsRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · existing form fields are filled locally in your browser"
      handoffSlug="fill-forms"
      toolName="Fill Forms"
    >
      {(pdf, reset) => <FormInspector pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

/* ------------------------------------------------------------------ *
 *  Inspection stage — read the AcroForm before showing any controls.
 * ------------------------------------------------------------------ */

type InspectState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; inspection: FormInspection };

function FormInspector({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // FormInspector is keyed by file upstream, so it remounts (fresh "loading"
  // state) for every new PDF — the effect only needs to resolve the inspection.
  const [state, setState] = useState<InspectState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // The class-heavy inspector (and pdf-lib under it) loads at file time,
    // not page time — this effect only runs once a file exists.
    import("@/lib/pdf/forms")
      .then(({ inspectFormFields }) => inspectFormFields(pdf.bytes))
      .then((inspection) => {
        if (!cancelled) setState({ status: "ready", inspection });
      })
      .catch((err) => {
        if (!cancelled)
          setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [pdf.bytes]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <FileHeader pdf={pdf} />
        <div className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm">
          <Spinner />
          Reading form fields…
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <FileHeader pdf={pdf} />
        <ErrorNote message={state.message} />
      </div>
    );
  }

  if (!state.inspection.hasFields || state.inspection.fillableCount === 0) {
    return (
      <NoFieldsNotice
        pdf={pdf}
        inspection={state.inspection}
        onReset={onReset}
      />
    );
  }

  return (
    <FieldsEditor pdf={pdf} inspection={state.inspection} onReset={onReset} />
  );
}

/** Honest empty-state: this PDF has nothing we can fill. We never fake it. */
function NoFieldsNotice({
  pdf,
  inspection,
  onReset,
}: {
  pdf: LoadedPdf;
  inspection: FormInspection;
  onReset: () => void;
}) {
  const unsupportedOnly =
    inspection.hasFields && inspection.fillableCount === 0;
  return (
    <div className="flex flex-col gap-4">
      <FileHeader pdf={pdf} />
      <div className="border-warn/40 bg-warn/10 flex flex-col gap-3 rounded-[4px] border p-6">
        <div className="flex items-start gap-3">
          <span className="bg-warn/10 text-warn grid size-10 shrink-0 place-items-center rounded-[4px]">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="text-fg text-base font-semibold">
              {unsupportedOnly
                ? "No fillable form fields here"
                : "No form fields detected"}
            </h3>
            <p className="text-muted text-sm leading-relaxed">
              {unsupportedOnly
                ? "This PDF only contains field types we can't fill safely (such as push buttons or signature fields)."
                : "This PDF has no interactive AcroForm, so there are no fields to fill."}
            </p>
          </div>
        </div>
        <p className="text-muted text-xs leading-relaxed">
          This tool fills a PDF&apos;s existing form fields — it never adds new
          fields or draws text onto flat pages. To place a signature or text on
          a document without form fields, use{" "}
          <span className="text-fg">Sign PDF</span>. Everything stays in your
          browser.
        </p>
        <div>
          <button
            type="button"
            onClick={onReset}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Choose another PDF
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Fill stage — controls for each field, then produce the filled PDF.
 * ------------------------------------------------------------------ */

/** Build the initial working value for each fillable, editable field. */
function initialValues(fields: FormFieldInfo[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of fields) {
    if (!isFillableType(field.type) || field.readOnly) continue;
    switch (field.type) {
      case "text":
      case "radio":
        out[field.name] = field.selected?.[0] ?? field.text ?? "";
        break;
      case "checkbox":
        out[field.name] = field.checked ?? false;
        break;
      case "dropdown":
        out[field.name] = field.multiselect
          ? [...(field.selected ?? [])]
          : (field.selected?.[0] ?? "");
        break;
      case "optionlist":
        out[field.name] = field.multiselect
          ? [...(field.selected ?? [])]
          : (field.selected?.[0] ?? "");
        break;
    }
  }
  return out;
}

function FieldsEditor({
  pdf,
  inspection,
  onReset,
}: {
  pdf: LoadedPdf;
  inspection: FormInspection;
  onReset: () => void;
}) {
  const { busy, error, result, run } = useAsyncRun<FillFormsResult>();
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    initialValues(inspection.fields),
  );
  const [flatten, setFlatten] = useState(false);

  const editable = useMemo(
    () =>
      inspection.fields.filter((f) => isFillableType(f.type) && !f.readOnly),
    [inspection.fields],
  );
  const readOnly = useMemo(
    () => inspection.fields.filter((f) => isFillableType(f.type) && f.readOnly),
    [inspection.fields],
  );
  const unsupported = useMemo(
    () => inspection.fields.filter((f) => !isFillableType(f.type)),
    [inspection.fields],
  );

  const setValue = (name: string, value: FieldValue) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const onRun = () => {
    void run(async () => {
      const { applyFormValues } = await import("@/lib/pdf/forms");
      return applyFormValues(pdf.bytes, values, { flatten });
    });
  };

  if (result) {
    const notApplied = result.outcomes.filter((o) => o.status !== "applied");
    return (
      <ResultPanel
        title="Form filled"
        summary={
          <>
            {result.appliedCount} field{result.appliedCount === 1 ? "" : "s"}{" "}
            filled
            {result.flattened ? " · flattened to static content" : ""}
          </>
        }
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, filledFormsOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download filled PDF
        </button>
        {notApplied.length > 0 && (
          <p className="text-muted text-xs">
            {notApplied.length} value{notApplied.length === 1 ? "" : "s"}{" "}
            couldn&apos;t be applied and were left unchanged.
          </p>
        )}
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Form fields"
        aside={
          <span className="text-muted text-xs">
            {editable.length} fillable
            {unsupported.length > 0
              ? ` · ${unsupported.length} unsupported`
              : ""}
          </span>
        }
      >
        <div className="border-line bg-wash flex flex-col divide-y divide-white/5 overflow-hidden rounded-[4px] border">
          {editable.map((field) => (
            <FieldRow key={field.name} field={field}>
              <FieldControl
                field={field}
                value={values[field.name] ?? ""}
                onChange={(value) => setValue(field.name, value)}
              />
            </FieldRow>
          ))}
          {readOnly.map((field) => (
            <FieldRow key={field.name} field={field}>
              <ReadOnlyControl field={field} />
            </FieldRow>
          ))}
        </div>
      </RunnerSection>

      {unsupported.length > 0 && <UnsupportedNote fields={unsupported} />}

      <label className="border-line bg-wash flex cursor-pointer items-start gap-3 rounded-[4px] border p-4">
        <input
          type="checkbox"
          checked={flatten}
          onChange={(event) => setFlatten(event.target.checked)}
          className="accent-accent mt-0.5 size-4"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-fg text-sm font-medium">
            Flatten after filling
          </span>
          <span className="text-muted text-xs leading-relaxed">
            Bake the values into the page so they can&apos;t be edited or
            cleared in a viewer. Leave off to keep the form interactive.
          </span>
        </span>
      </label>

      {error && <ErrorNote message={error} />}

      <PrivacyLine>
        Fields are read and filled on your device — your PDF never leaves the
        browser.
      </PrivacyLine>

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Filling…">
          <PenLine className="size-4" aria-hidden />
          Fill form
        </RunButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Field row + per-type controls
 * ------------------------------------------------------------------ */

function FieldRow({
  field,
  children,
}: {
  field: FormFieldInfo;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 p-3.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="text-fg truncate text-sm font-medium"
          title={field.name}
        >
          {field.name}
          {field.required && (
            <span className="text-err" aria-label="required">
              {" "}
              *
            </span>
          )}
        </span>
        <span className="text-muted text-[11px] tracking-wide uppercase">
          {field.widgetLabel}
        </span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-[3px] border border-line bg-black/20 px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/50";

function asString(value: FieldValue): string {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? (value[0] ?? "")
      : "";
}
function asBool(value: FieldValue): boolean {
  return value === true;
}
function asArray(value: FieldValue): string[] {
  return Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? [value]
      : [];
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FormFieldInfo;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  switch (field.type) {
    case "text":
      return (
        <TextControl
          field={field}
          value={asString(value)}
          onChange={onChange}
        />
      );
    case "checkbox":
      return <CheckboxControl checked={asBool(value)} onChange={onChange} />;
    case "radio":
      return (
        <ChoiceControl
          options={field.options ?? []}
          selected={asString(value) ? [asString(value)] : []}
          multiple={false}
          variant="radio"
          onChange={(next) => onChange(next[0] ?? "")}
        />
      );
    case "dropdown":
      if (field.editable) {
        return (
          <ComboControl
            field={field}
            value={asString(value)}
            onChange={onChange}
          />
        );
      }
      if (field.multiselect) {
        return (
          <ChoiceControl
            options={field.options ?? []}
            selected={asArray(value)}
            multiple
            variant="checkbox"
            onChange={(next) => onChange(next)}
          />
        );
      }
      return (
        <SelectControl
          field={field}
          value={asString(value)}
          onChange={onChange}
        />
      );
    case "optionlist":
      return (
        <ChoiceControl
          options={field.options ?? []}
          selected={asArray(value)}
          multiple={field.multiselect ?? false}
          variant={field.multiselect ? "checkbox" : "radio"}
          onChange={(next) =>
            field.multiselect ? onChange(next) : onChange(next[0] ?? "")
          }
        />
      );
    default:
      return null;
  }
}

function TextControl({
  field,
  value,
  onChange,
}: {
  field: FormFieldInfo;
  value: string;
  onChange: (value: FieldValue) => void;
}) {
  const showCount = typeof field.maxLength === "number";
  return (
    <div className="flex flex-col gap-1">
      {field.multiline ? (
        <textarea
          value={value}
          maxLength={field.maxLength}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className={cn(INPUT_CLASS, "resize-y")}
          placeholder="Type here…"
        />
      ) : (
        <input
          type="text"
          value={value}
          maxLength={field.maxLength}
          onChange={(event) => onChange(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Type here…"
        />
      )}
      {showCount && (
        <span className="text-muted self-end text-[11px] tabular-nums">
          {value.length}/{field.maxLength}
        </span>
      )}
    </div>
  );
}

function CheckboxControl({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: FieldValue) => void;
}) {
  return (
    <label className="text-muted inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent size-4"
      />
      {checked ? "Checked" : "Unchecked"}
    </label>
  );
}

function SelectControl({
  field,
  value,
  onChange,
}: {
  field: FormFieldInfo;
  value: string;
  onChange: (value: FieldValue) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={INPUT_CLASS}
    >
      <option value="">— None —</option>
      {(field.options ?? []).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function ComboControl({
  field,
  value,
  onChange,
}: {
  field: FormFieldInfo;
  value: string;
  onChange: (value: FieldValue) => void;
}) {
  const listId = useId();
  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        value={value}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
        placeholder="Choose or type a value…"
      />
      <datalist id={listId}>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}

/** A radio (single) or checkbox (multi) group over a fixed option set. */
function ChoiceControl({
  options,
  selected,
  multiple,
  variant,
  onChange,
}: {
  options: string[];
  selected: string[];
  multiple: boolean;
  variant: "radio" | "checkbox";
  onChange: (selected: string[]) => void;
}) {
  const groupName = useId();
  const set = new Set(selected);

  const toggle = (option: string) => {
    if (multiple) {
      const next = new Set(set);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      onChange(options.filter((o) => next.has(o)));
    } else {
      onChange(set.has(option) ? [] : [option]);
    }
  };

  if (options.length === 0) {
    return <span className="text-muted text-xs">No options defined.</span>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option) => {
        const active = set.has(option);
        return (
          <label
            key={option}
            className="text-muted inline-flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type={variant}
              name={groupName}
              checked={active}
              onChange={() => toggle(option)}
              className={cn(
                "accent-accent size-4",
                variant === "radio" && "rounded-full",
              )}
            />
            {option}
          </label>
        );
      })}
      {!multiple && selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-muted hover:text-muted self-start text-[11px] underline-offset-2 hover:underline"
        >
          Clear selection
        </button>
      )}
    </div>
  );
}

function ReadOnlyControl({ field }: { field: FormFieldInfo }) {
  const current =
    field.type === "checkbox"
      ? field.checked
        ? "Checked"
        : "Unchecked"
      : field.selected && field.selected.length > 0
        ? field.selected.join(", ")
        : (field.text ?? "");
  return (
    <div className="flex items-center gap-2">
      <span className="border-line text-muted min-w-0 flex-1 truncate rounded-[3px] border bg-black/10 px-3.5 py-2.5 text-sm">
        {current || <span className="text-muted">(empty)</span>}
      </span>
      <span className="border-line text-muted inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px]">
        <Lock className="size-3" aria-hidden />
        Read-only
      </span>
    </div>
  );
}

function UnsupportedNote({ fields }: { fields: FormFieldInfo[] }) {
  return (
    <div className="border-line bg-wash text-muted flex items-start gap-2 rounded-[4px] border px-4 py-3 text-xs leading-relaxed">
      <Info className="text-muted mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {fields.length} field{fields.length === 1 ? "" : "s"} of an unsupported
        type ({[...new Set(fields.map((f) => f.widgetLabel))].join(", ")}) are
        shown for reference but left unchanged:{" "}
        <span className="text-muted">
          {fields.map((f) => f.name).join(", ")}
        </span>
        .
      </span>
    </div>
  );
}
