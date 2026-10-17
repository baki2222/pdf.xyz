"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Download,
  FilePlus2,
  Info,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  createdFormOutputName,
  createFormFields,
  parseOptions,
  readFormContext,
  validateFormFields,
  type CreateFormResult,
  type NewDropdownField,
  type NewFieldType,
  type NewFormContext,
  type NewFormField,
  type NewOptionListField,
  type NewRadioField,
  type NewTextField,
} from "@/lib/pdf/create-forms";
import { FIELD_TYPE_BUTTON, NEW_FIELD_TYPES } from "@/lib/pdf/offered-kinds";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  NumberField,
  PrivacyLine,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

export function CreateFormsRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · form fields are added locally in your browser"
      handoffSlug="create-forms"
      toolName="Create Fillable Forms"
    >
      {(pdf, reset) => <FormBuilderStage pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

/* ------------------------------------------------------------------ *
 *  Load the target PDF's pages + existing fields before building.
 * ------------------------------------------------------------------ */

type ContextState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; context: NewFormContext };

function FormBuilderStage({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // Keyed by file upstream, so this remounts (fresh "loading") for each PDF.
  const [state, setState] = useState<ContextState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    readFormContext(pdf.bytes)
      .then((context) => {
        if (alive) setState({ status: "ready", context });
      })
      .catch((err) => {
        if (alive) setState({ status: "error", message: errorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <FileHeader pdf={pdf} />
        <div className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm">
          <Spinner />
          Reading the PDF…
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

  return <FormBuilder pdf={pdf} context={state.context} onReset={onReset} />;
}

/* ------------------------------------------------------------------ *
 *  Draft model — loose, UI-friendly rows converted to strict specs.
 * ------------------------------------------------------------------ */

interface FieldDraft {
  id: string;
  type: NewFieldType;
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text default value, or the chosen default option for choice fields. */
  defaultValue: string;
  multiline: boolean;
  /** Text max length as raw input; blank means no limit. */
  maxLength: string;
  checked: boolean;
  /** Choice options, one per line. */
  optionsText: string;
  editable: boolean;
  multiselect: boolean;
}

function makeDraft(id: string, n: number): FieldDraft {
  return {
    id,
    type: "text",
    name: `field_${n}`,
    page: 1,
    x: 72,
    // Step new rows down the page so they don't all stack on one spot.
    y: Math.max(96, 700 - ((n - 1) % 14) * 44),
    width: 200,
    height: 24,
    defaultValue: "",
    multiline: false,
    maxLength: "",
    checked: false,
    optionsText: "",
    editable: false,
    multiselect: false,
  };
}

/** Convert a UI draft into the strict, validated spec the engine consumes. */
function draftToSpec(d: FieldDraft): NewFormField {
  const { name, page, x, y, width, height } = d;
  switch (d.type) {
    case "text": {
      const spec: NewTextField = {
        type: "text",
        name,
        page,
        x,
        y,
        width,
        height,
      };
      if (d.defaultValue) spec.defaultValue = d.defaultValue;
      if (d.multiline) spec.multiline = true;
      if (d.maxLength.trim() !== "") spec.maxLength = Number(d.maxLength);
      return spec;
    }
    case "checkbox":
      return {
        type: "checkbox",
        name,
        page,
        x,
        y,
        width,
        height,
        checked: d.checked,
      };
    case "dropdown": {
      const spec: NewDropdownField = {
        type: "dropdown",
        name,
        page,
        x,
        y,
        width,
        height,
        options: parseOptions(d.optionsText),
      };
      if (d.editable) spec.editable = true;
      if (d.multiselect) spec.multiselect = true;
      if (d.defaultValue) spec.defaultValue = d.defaultValue;
      return spec;
    }
    case "optionlist": {
      const spec: NewOptionListField = {
        type: "optionlist",
        name,
        page,
        x,
        y,
        width,
        height,
        options: parseOptions(d.optionsText),
      };
      if (d.multiselect) spec.multiselect = true;
      if (d.defaultValue) spec.defaultValue = d.defaultValue;
      return spec;
    }
    case "radio": {
      const spec: NewRadioField = {
        type: "radio",
        name,
        page,
        x,
        y,
        width,
        height,
        options: parseOptions(d.optionsText),
      };
      if (d.defaultValue) spec.defaultValue = d.defaultValue;
      return spec;
    }
  }
}

/** The kinds offered — the same list the tool page counts (`offered-kinds`). */
const TYPE_OPTIONS: { value: NewFieldType; label: string }[] =
  NEW_FIELD_TYPES.map((value) => ({ value, label: FIELD_TYPE_BUTTON[value] }));

const MAX_COORD = 20000;

/* ------------------------------------------------------------------ *
 *  Builder
 * ------------------------------------------------------------------ */

function FormBuilder({
  pdf,
  context,
  onReset,
}: {
  pdf: LoadedPdf;
  context: NewFormContext;
  onReset: () => void;
}) {
  const { busy, error, result, run, reset } = useAsyncRun<CreateFormResult>();
  const counter = useRef(1);
  const [drafts, setDrafts] = useState<FieldDraft[]>(() => [
    makeDraft("f1", 1),
  ]);
  // Anything changed from the one blank field the builder starts with.
  const [pristine] = useState(() => JSON.stringify(drafts));
  useUnsavedGuard(
    JSON.stringify(drafts) !== pristine && !result,
    "your form fields",
  );

  const specs = useMemo(() => drafts.map(draftToSpec), [drafts]);
  const errors = useMemo(
    () => validateFormFields(specs, context.pageSizes, context.existingNames),
    [specs, context.pageSizes, context.existingNames],
  );
  const errorsByIndex = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const err of errors) {
      const list = map.get(err.index) ?? [];
      list.push(err.message);
      map.set(err.index, list);
    }
    return map;
  }, [errors]);
  const formErrors = errorsByIndex.get(-1) ?? [];

  const addField = () => {
    counter.current += 1;
    const n = counter.current;
    setDrafts((prev) => [...prev, makeDraft(`f${n}`, n)]);
  };
  const removeField = (id: string) =>
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  const updateField = (id: string, patch: Partial<FieldDraft>) =>
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );

  const onRun = () => {
    void run(async () => createFormFields(pdf.bytes, drafts.map(draftToSpec)));
  };

  if (result) {
    return (
      <ResultPanel
        title="Fillable form ready"
        summary={
          <>
            {result.fieldCount} field{result.fieldCount === 1 ? "" : "s"} added
            to your PDF
          </>
        }
        onReset={onReset}
        output={outputFile(result.bytes, createdFormOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.bytes, createdFormOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download form PDF
        </button>
        <p className="text-muted text-xs">
          Open it in any PDF viewer, or use{" "}
          <span className="text-fg">Fill Forms</span> to complete the new
          fields.
        </p>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <CoordinateHelp context={context} />

      <RunnerSection
        title="Form fields"
        aside={
          <span className="text-muted text-xs">
            {drafts.length} field{drafts.length === 1 ? "" : "s"}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          {drafts.map((draft, index) => (
            <FieldCard
              key={draft.id}
              draft={draft}
              context={context}
              errors={errorsByIndex.get(index) ?? []}
              onChange={(patch) => updateField(draft.id, patch)}
              onRemove={() => removeField(draft.id)}
            />
          ))}
          {drafts.length === 0 && (
            <p className="border-line-strong bg-wash text-muted rounded-[4px] border border-dashed px-4 py-8 text-center text-sm">
              No fields yet — add one to start building your form.
            </p>
          )}
          <button
            type="button"
            onClick={addField}
            className="border-line bg-wash text-fg hover:border-accent/40 hover:bg-accent/10 hover:text-fg inline-flex items-center justify-center gap-1.5 self-start rounded-full border px-3.5 py-2 text-xs font-medium transition"
          >
            <Plus className="size-4" aria-hidden />
            Add field
          </button>
        </div>
      </RunnerSection>

      {formErrors.map((message) => (
        <ErrorNote key={message} message={message} />
      ))}
      {error && <ErrorNote message={error} />}

      <PrivacyLine>
        Fields are added on your device — your PDF never leaves the browser.
      </PrivacyLine>

      <RunBar>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {errors.length > 0 && drafts.length > 0 && (
            <span className="text-warn text-xs">
              Fix {errors.length} issue{errors.length === 1 ? "" : "s"} above to
              continue.
            </span>
          )}
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={errors.length > 0 || drafts.length === 0}
            busyLabel="Creating…"
          >
            <FilePlus2 className="size-4" aria-hidden />
            Create form
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Coordinate help
 * ------------------------------------------------------------------ */

function CoordinateHelp({ context }: { context: NewFormContext }) {
  const first = context.pageSizes[0];
  return (
    <div className="border-line bg-wash flex items-start gap-3 rounded-[4px] border px-4 py-3.5">
      <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="text-muted flex flex-col gap-1 text-xs leading-relaxed">
        <span>
          Positions are <span className="text-fg">PDF points</span> (1 pt =
          1/72&quot;), measured from the{" "}
          <span className="text-fg">bottom-left</span> corner of the page as
          it&apos;s displayed — X goes right, Y goes up.
          {first
            ? ` Page 1 is ${Math.round(first.width)} × ${Math.round(first.height)} pt.`
            : ""}
        </span>
        <span className="text-muted">
          This adds classic fillable AcroForm fields by coordinates — it
          isn&apos;t a visual drag-and-drop editor, and it doesn&apos;t create
          signature fields.
          {context.existingNames.length > 0
            ? ` This PDF already has ${context.existingNames.length} field${
                context.existingNames.length === 1 ? "" : "s"
              } — new names must differ.`
            : ""}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Field card
 * ------------------------------------------------------------------ */

const INPUT_CLASS =
  "w-full rounded-[3px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent/40 focus:ring-2 focus:ring-accent/50";

function FieldCard({
  draft,
  context,
  errors,
  onChange,
  onRemove,
}: {
  draft: FieldDraft;
  context: NewFormContext;
  errors: string[];
  onChange: (patch: Partial<FieldDraft>) => void;
  onRemove: () => void;
}) {
  const size =
    Number.isInteger(draft.page) &&
    draft.page >= 1 &&
    draft.page <= context.pageCount
      ? context.pageSizes[draft.page - 1]
      : undefined;
  const pageHint = size
    ? `Page ${draft.page} · ${Math.round(size.width)} × ${Math.round(size.height)} pt`
    : `Page ${draft.page} · out of range`;

  return (
    <div className="border-line bg-wash flex flex-col gap-4 rounded-[4px] border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Field type"
          value={draft.type}
          onChange={(type) => onChange({ type })}
          options={TYPE_OPTIONS}
        />
        <button
          type="button"
          onClick={onRemove}
          className="border-line text-muted hover:border-err/40 hover:bg-err/10 hover:text-err inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition"
          aria-label="Remove field"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Remove
        </button>
      </div>

      <TextField
        label="Field name"
        value={draft.name}
        onChange={(name) => onChange({ name })}
        placeholder="e.g. full_name"
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted text-xs font-medium">Placement</span>
          <span
            className={cn("text-[11px]", size ? "text-muted" : "text-warn")}
          >
            {pageHint}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <NumberField
            label="Page"
            value={draft.page}
            min={1}
            max={Math.max(1, context.pageCount)}
            onChange={(page) => onChange({ page })}
          />
          <NumberField
            label="X"
            value={draft.x}
            min={0}
            max={MAX_COORD}
            onChange={(x) => onChange({ x })}
          />
          <NumberField
            label="Y"
            value={draft.y}
            min={0}
            max={MAX_COORD}
            onChange={(y) => onChange({ y })}
          />
          <NumberField
            label={draft.type === "radio" ? "Button W" : "Width"}
            value={draft.width}
            min={1}
            max={MAX_COORD}
            onChange={(width) => onChange({ width })}
          />
          <NumberField
            label={draft.type === "radio" ? "Button H" : "Height"}
            value={draft.height}
            min={1}
            max={MAX_COORD}
            onChange={(height) => onChange({ height })}
          />
        </div>
      </div>

      <TypeOptions draft={draft} onChange={onChange} />

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1">
          {errors.map((message) => (
            <li
              key={message}
              className="text-err flex items-start gap-1.5 text-xs"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Per-type option editors
 * ------------------------------------------------------------------ */

function TypeOptions({
  draft,
  onChange,
}: {
  draft: FieldDraft;
  onChange: (patch: Partial<FieldDraft>) => void;
}) {
  const options = parseOptions(draft.optionsText);

  // Changing the option list clears a default that's no longer valid.
  const setOptions = (optionsText: string) => {
    const next = parseOptions(optionsText);
    const patch: Partial<FieldDraft> = { optionsText };
    if (
      draft.defaultValue &&
      !draft.editable &&
      !next.includes(draft.defaultValue)
    ) {
      patch.defaultValue = "";
    }
    onChange(patch);
  };

  switch (draft.type) {
    case "text":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Default text (optional)"
            value={draft.defaultValue}
            onChange={(defaultValue) => onChange({ defaultValue })}
            placeholder="Pre-filled value"
          />
          <TextField
            label="Max length (optional)"
            value={draft.maxLength}
            onChange={(maxLength) =>
              onChange({ maxLength: maxLength.replace(/[^0-9]/g, "") })
            }
            placeholder="No limit"
          />
          <div className="sm:col-span-2">
            <Toggle
              label="Multiple lines"
              description="Let the field hold several lines of text."
              checked={draft.multiline}
              onChange={(multiline) => onChange({ multiline })}
            />
          </div>
        </div>
      );
    case "checkbox":
      return (
        <Toggle
          label="Checked by default"
          description="Start the checkbox ticked in the exported form."
          checked={draft.checked}
          onChange={(checked) => onChange({ checked })}
        />
      );
    case "dropdown":
      return (
        <div className="flex flex-col gap-3">
          <OptionsEditor value={draft.optionsText} onChange={setOptions} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle
              label="Allow custom typing"
              description="Combo box: accept values outside the list."
              checked={draft.editable}
              onChange={(editable) => onChange({ editable })}
            />
            <Toggle
              label="Allow multiple selections"
              checked={draft.multiselect}
              onChange={(multiselect) => onChange({ multiselect })}
            />
          </div>
          {draft.editable ? (
            <TextField
              label="Default value (optional)"
              value={draft.defaultValue}
              onChange={(defaultValue) => onChange({ defaultValue })}
              placeholder="Any value"
            />
          ) : (
            <DefaultSelect
              options={options}
              value={draft.defaultValue}
              onChange={(defaultValue) => onChange({ defaultValue })}
            />
          )}
        </div>
      );
    case "optionlist":
      return (
        <div className="flex flex-col gap-3">
          <OptionsEditor value={draft.optionsText} onChange={setOptions} />
          <Toggle
            label="Allow multiple selections"
            checked={draft.multiselect}
            onChange={(multiselect) => onChange({ multiselect })}
          />
          <DefaultSelect
            options={options}
            value={draft.defaultValue}
            onChange={(defaultValue) => onChange({ defaultValue })}
          />
        </div>
      );
    case "radio":
      return (
        <div className="flex flex-col gap-3">
          <OptionsEditor
            value={draft.optionsText}
            onChange={setOptions}
            hint="Buttons stack downward from (X, Y); each uses the width & height above."
          />
          <DefaultSelect
            options={options}
            value={draft.defaultValue}
            onChange={(defaultValue) => onChange({ defaultValue })}
          />
        </div>
      );
  }
}

function OptionsEditor({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        Options — one per line
      </label>
      <textarea
        id={id}
        value={value}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INPUT_CLASS, "resize-y font-mono text-xs")}
        placeholder={"Option A\nOption B\nOption C"}
      />
      {hint && (
        <span className="text-muted text-[11px] leading-relaxed">{hint}</span>
      )}
    </div>
  );
}

function DefaultSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        Default selection (optional)
      </label>
      <select
        id={id}
        value={options.includes(value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
        aria-disabled={options.length === 0 || undefined}
      >
        <option value="">— None —</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="border-line bg-wash flex cursor-pointer items-start gap-3 rounded-[4px] border p-3.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent mt-0.5 size-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-fg text-sm font-medium">{label}</span>
        {description && (
          <span className="text-muted text-xs leading-relaxed">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
