"use client";

import { useRef, useState } from "react";
import { Download, Save, Upload } from "lucide-react";
import type { ExtractionField } from "@/lib/jobs/ai-extract";
import {
  MAX_SAVED_SCHEMAS,
  MAX_SCHEMA_NAME_CHARS,
  SAVE_REFUSED,
  deleteSchema,
  parseSchemaFile,
  readSavedSchemas,
  saveSchema,
  schemaFileName,
  schemaFileText,
  schemaFileTooLarge,
  schemaFromFields,
  schemaStorage,
  storageWorks,
  writeSavedSchemas,
  type SavedSchema,
} from "@/lib/jobs/ai-extract-schemas";
import { AI_EXTRACT_SCHEMAS_CHUNK } from "./ai-extract-schemas-chunk";

/**
 * AI Data Extraction's saved schemas (competitor audit #16): name the field
 * list and save it in this browser, load or delete a saved one (a delete or
 * a replace can be undone), and export or import it as a JSON file.
 *
 * A chunk of its own, fetched when "Saved schemas" is opened and never with
 * the page (`AI_EXTRACT_SCHEMAS_CHUNK`). It renders only in the browser, after
 * a press, so storage is read in the state's initialiser. Everything it does
 * stays on this device: storage, a download, a file the person picks.
 */

const BUTTON =
  "border-line text-muted hover:text-fg rounded-ctl inline-flex min-h-11 items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition sm:min-h-0";

const quoted = (name: string) => `“${name}”`;
const fieldCount = (n: number) => `${n} field${n === 1 ? "" : "s"}`;

/**
 * Save `text` as a file. Not `downloadBlob`: that also marks the page's
 * result as kept (`resultsKept`), and a schema is not the result.
 */
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Note = { readonly tone: "ok" | "err"; readonly text: string };

export function AiExtractSchemas({
  fields,
  onLoad,
}: {
  fields: readonly ExtractionField[];
  onLoad: (fields: ExtractionField[]) => void;
}) {
  const [storage] = useState(() => {
    const store = schemaStorage();
    return storageWorks(store) ? store : undefined;
  });
  const [schemas, setSchemas] = useState(() => readSavedSchemas(storage));
  const [name, setName] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [undo, setUndo] = useState<{
    text: string;
    schemas: SavedSchema[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const say = (tone: Note["tone"], text: string) => setNote({ tone, text });

  const load = (schema: SavedSchema) => {
    onLoad(schema.fields.map((field) => ({ ...field })));
    setName(schema.name);
  };

  const save = () => {
    const checked = schemaFromFields(name, fields);
    if (!checked.ok) return say("err", checked.message);
    const before = readSavedSchemas(storage);
    const result = saveSchema(checked.value, storage);
    setSchemas(result.schemas);
    if (!result.ok) return say("err", result.message);
    const what = `${quoted(result.saved.name)}, ${fieldCount(result.saved.fields.length)}`;
    if (result.replaced) {
      setUndo({
        text: `Replaced ${quoted(result.replaced.name)}.`,
        schemas: before,
      });
      say("ok", `Saved ${what}, in place of the one with that name.`);
    } else {
      setUndo(null);
      say("ok", `Saved ${what}, in this browser.`);
    }
  };

  const remove = (schema: SavedSchema) => {
    const before = readSavedSchemas(storage);
    const result = deleteSchema(schema.name, storage);
    setSchemas(result.schemas);
    if (!result.ok) return say("err", SAVE_REFUSED);
    setNote(null);
    setUndo({ text: `Deleted ${quoted(schema.name)}.`, schemas: before });
  };

  const restore = () => {
    if (!undo) return;
    const ok = writeSavedSchemas(undo.schemas, storage);
    setSchemas(readSavedSchemas(storage));
    setUndo(null);
    if (ok) say("ok", "Undone.");
    else say("err", SAVE_REFUSED);
  };

  const exportFile = () => {
    const checked = schemaFromFields(name, fields);
    if (!checked.ok) return say("err", checked.message);
    const filename = schemaFileName(checked.value.name);
    downloadText(schemaFileText(checked.value), filename);
    say("ok", `Exported ${quoted(checked.value.name)} as ${filename}.`);
  };

  const importFile = async (file: File) => {
    const tooLarge = schemaFileTooLarge(file.size);
    if (tooLarge) return say("err", `${tooLarge} Nothing was changed.`);
    let text: string;
    try {
      // JSON is UTF-8 (RFC 8259), and the export writes UTF-8: decoded
      // strictly, so a file in another encoding is refused, never read
      // with replacement characters standing in for its letters.
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
    } catch {
      return say(
        "err",
        "This file could not be read as a schema file. Nothing was changed.",
      );
    }
    const parsed = parseSchemaFile(text);
    if (!parsed.ok) return say("err", `${parsed.message} Nothing was changed.`);
    load(parsed.value);
    say(
      "ok",
      `Opened ${quoted(parsed.value.name)} from the file: ${fieldCount(parsed.value.fields.length)}.${storage ? " Press Save schema to keep it in this browser." : ""}`,
    );
  };

  return (
    <div
      data-chunk={AI_EXTRACT_SCHEMAS_CHUNK}
      className="border-line rounded-ctl flex flex-col gap-3 border p-3"
    >
      <p className="text-muted text-xs leading-relaxed">
        Saved schemas are kept in this browser only, on this device, and are
        never uploaded. Running a job sends the fields on screen, never this
        list.
      </p>
      {!storage && (
        <p className="text-fg text-xs leading-relaxed">
          Saving is off: this browser is not letting pdf.xyz keep anything,
          which a private window or blocked site data can do. Your fields still
          work, and Export JSON and Import JSON still move a schema as a file.
        </p>
      )}
      <label className="text-muted flex flex-col gap-1 text-xs">
        Schema name
        <input
          type="text"
          value={name}
          maxLength={MAX_SCHEMA_NAME_CHARS}
          onChange={(e) =>
            setName(e.target.value.slice(0, MAX_SCHEMA_NAME_CHARS))
          }
          placeholder="e.g. Supplier invoice"
          className="border-line bg-wash text-fg placeholder:text-muted focus:border-accent/40 rounded-ctl border px-3 py-1.5 text-sm outline-none"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          aria-disabled={!storage || undefined}
          className={`${BUTTON} aria-disabled:opacity-40`}
        >
          <Save className="size-3.5" aria-hidden />
          Save schema
        </button>
        <button type="button" onClick={exportFile} className={BUTTON}>
          <Download className="size-3.5" aria-hidden />
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className={BUTTON}
        >
          <Upload className="size-3.5" aria-hidden />
          Import JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Schema file to import"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      <div role="status">
        {note && (
          <p
            className={
              note.tone === "err" ? "text-err text-xs" : "text-ok text-xs"
            }
          >
            {note.text}
          </p>
        )}
        {undo && (
          <p className="text-muted flex flex-wrap items-center gap-2 text-xs">
            {undo.text}
            <button
              type="button"
              onClick={restore}
              className="text-fg tap-y font-medium underline-offset-4 hover:underline"
            >
              Undo
            </button>
          </p>
        )}
      </div>
      {storage &&
        (schemas.length === 0 ? (
          <p className="text-muted text-xs">
            No saved schemas yet. This browser keeps up to {MAX_SAVED_SCHEMAS}.
          </p>
        ) : (
          <ul aria-label="Saved schemas" className="flex flex-col">
            {schemas.map((schema) => (
              <li
                key={schema.name}
                className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-fg truncate text-sm">
                    {schema.name}
                  </span>
                  <span className="text-muted text-xs">
                    {fieldCount(schema.fields.length)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    load(schema);
                    say(
                      "ok",
                      `Loaded ${quoted(schema.name)}: ${fieldCount(schema.fields.length)}.`,
                    );
                  }}
                  aria-label={`Load ${schema.name}`}
                  className={BUTTON}
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => remove(schema)}
                  aria-label={`Delete ${schema.name}`}
                  className={BUTTON}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
