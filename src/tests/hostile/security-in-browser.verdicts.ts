/**
 * What counts as an ACCEPTABLE outcome for each security-in-browser cell,
 * judged against the fixture's truth (`security-in-browser.cells.ts`). One
 * predicate per entry point, so every fixture is held to the same rule and a
 * finding is a cell whose outcome this rejects — never a cell picked by hand.
 */
import type { Entry, FixtureSpec } from "./security-in-browser.cells";
import type { CellResult } from "./security-in-browser.harness";

export interface Verdict {
  ok: boolean;
  /** Why, in one line — the assertion message of a failing cell. */
  why: string;
}

/**
 * Classes whose owner-only fixtures break the /Encrypt dictionary itself (H15)
 * or cut it off (H04): there, "needs a password" is what every reader says.
 */
export const PASSWORD_PLAUSIBLE: ReadonlySet<string> = new Set(["H04", "H15"]);

/** Growth in RSS during one cell above which it is a memory finding. */
export const GROWTH_LIMIT_MB = 512;

const yes = (why = "acceptable"): Verdict => ({ ok: true, why });
const no = (why: string): Verdict => ({ ok: false, why });

type V = Record<string, unknown>;

/** A page count a reader could act on: a positive integer. */
const saneCount = (n: unknown) =>
  typeof n === "number" && Number.isInteger(n) && n >= 1;

function pagesMatch(f: FixtureSpec, n: unknown): Verdict {
  if (!saneCount(n))
    return no(`page count ${JSON.stringify(n)} is not a positive integer`);
  const want = "pages" in f.truth ? f.truth.pages : undefined;
  if (want !== undefined && n !== want)
    return no(`page count ${String(n)}, a reader finds ${want}`);
  return yes();
}

function hostile(f: FixtureSpec): boolean {
  return (
    (f.truth.kind === "owner" && !!f.truth.hostile) ||
    (f.truth.kind === "plain" && !!f.truth.damaged)
  );
}

export function judge(f: FixtureSpec, entry: Entry, r: CellResult): Verdict {
  if (r.status === "hang") return no(`hung past its ${r.ms} ms bound`);
  if (r.status === "memory")
    return no(
      `RSS passed the watchdog (${r.rssMb} MB) and the process was killed`,
    );
  if (r.status === "crash")
    return no(`child died: ${r.exit} ${r.stderr.slice(-200)}`);
  if (r.status === "ok" && r.growthMb > GROWTH_LIMIT_MB)
    return no(
      `RSS grew ${r.growthMb} MB during the cell (limit ${GROWTH_LIMIT_MB})`,
    );
  if (r.status === "threw") {
    // readXref's contract is to throw on what it cannot read; every caller
    // (ProtectedPdf.open) turns that into a typed refusal.
    if (entry === "readXref") return yes(`refused: ${r.name}: ${r.message}`);
    return no(`threw ${r.name}: ${r.message}`);
  }
  const v = r.value as V | null;
  const t = f.truth;
  switch (entry) {
    case "classify": {
      const kind = v?.kind;
      if (v && "pageCount" in v && !saneCount(v.pageCount))
        return no(
          `classified ${String(kind)} with pageCount ${JSON.stringify(v.pageCount)}`,
        );
      if (t.kind === "notpdf" || t.kind === "unsupported")
        return kind === "unreadable"
          ? yes()
          : no(`classified ${String(kind)}, expected unreadable`);
      if (t.kind === "user")
        return kind === "password-required"
          ? yes()
          : no(`classified ${String(kind)}, the file needs its open password`);
      if (t.kind === "plain") {
        if (kind === "unencrypted") return pagesMatch(f, v!.pageCount);
        if (kind === "unreadable" && t.damaged)
          return yes("refused as unreadable (damaged)");
        return no(`classified ${String(kind)}, the file is not encrypted`);
      }
      // owner
      if (kind === "restricted") return pagesMatch(f, v!.pageCount);
      if (t.hostile && kind === "unreadable")
        return yes("refused as unreadable (hostile structure)");
      // "Needs a password" is true only when the /Encrypt itself is what is
      // broken (H15: every reader then fails the empty password) or the file
      // lost it (H04). Anywhere else the empty password opens the file, and
      // the sentence sends the person to find a password that does not exist.
      if (
        t.hostile &&
        kind === "password-required" &&
        PASSWORD_PLAUSIBLE.has(f.cls)
      )
        return yes(
          "refused as password-required (the /Encrypt itself is hostile)",
        );
      return no(
        `classified ${String(kind)}; the file is encrypted and opens with the empty password`,
      );
    }
    case "probe": {
      const verdict = v?.verdict ?? null;
      if (typeof v?.message !== "string" || v.message.length < 20)
        return no("no sentence for the verdict");
      const want: (string | null)[] =
        t.kind === "notpdf" || t.kind === "unsupported"
          ? [null]
          : t.kind === "user"
            ? ["needs-password"]
            : t.kind === "plain"
              ? t.damaged
                ? ["opens-without-password", null]
                : ["opens-without-password"]
              : t.hostile
                ? PASSWORD_PLAUSIBLE.has(f.cls)
                  ? ["opens-without-password", null, "needs-password"]
                  : ["opens-without-password", null]
                : ["opens-without-password"];
      return want.includes(verdict as string | null)
        ? yes(`"${String(v.message).slice(0, 60)}…"`)
        : no(
            `verdict ${String(verdict)}, expected one of ${JSON.stringify(want)}`,
          );
    }
    case "openProtected": {
      const kind = v?.kind;
      if (t.kind === "notpdf" || t.kind === "plain" || t.kind === "unsupported")
        return kind === "unsupported"
          ? yes(`refused: ${String(v!.reason)}`)
          : no(`kind ${String(kind)}, expected unsupported`);
      if (t.kind === "user")
        return kind === "needs-password"
          ? yes()
          : no(`kind ${String(kind)}, expected needs-password`);
      if (kind === "opened") {
        if (v!.plainHasEncrypt)
          return no("decrypted copy still carries /Encrypt");
        if (!("pages" in t) || t.pages === undefined)
          return typeof v!.plainPages === "number" || t.hostile
            ? yes()
            : no(`plain copy unreadable: ${String(v!.plainPages)}`);
        if (typeof v!.plainPages === "string" && t.hostile)
          // The caller (openProtectedCopy) reads the page board and refuses.
          return yes(`opened, plain copy refused by pdf-lib: ${v!.plainPages}`);
        return pagesMatch(f, v!.plainPages);
      }
      if (t.hostile && (kind === "unsupported" || kind === "needs-password"))
        return yes(`refused: ${String(kind)} ${String(v?.reason ?? "")}`);
      return no(
        `kind ${String(kind)} ${String(v?.reason ?? "")}; the empty password opens this file`,
      );
    }
    case "openWrongPassword": {
      const kind = v?.kind;
      if (t.kind === "notpdf" || t.kind === "plain" || t.kind === "unsupported")
        return kind === "unsupported"
          ? yes()
          : no(`kind ${String(kind)}, expected unsupported`);
      if (kind === "wrong-password") return yes();
      if (t.kind === "owner" && t.hostile && kind === "unsupported")
        return yes("refused: unsupported");
      return no(`kind ${String(kind)} for a wrong password`);
    }
    case "openRightPassword": {
      if (v?.kind !== "opened")
        return no(
          `kind ${String(v?.kind)} ${String(v?.reason ?? "")} with the right password`,
        );
      if (t.kind === "owner" && v.as !== "owner")
        return no(`authenticated as ${String(v.as)} with the owner password`);
      return pagesMatch(f, v.plainPages);
    }
    case "openProtectedCopy": {
      if (t.kind !== "owner")
        return v === null
          ? yes("null: caller refuses in the probe's words")
          : no("opened a copy of a file that is not owner-only encrypted");
      if (v === null)
        return t.hostile
          ? yes("null: caller refuses in the probe's words")
          : no("null for a file the empty password opens");
      return pagesMatch(f, v.pageCount);
    }
    case "readXref":
      return yes();
    case "signatures": {
      const want = f.signatures ?? 0;
      return v?.count === want
        ? yes()
        : no(`counted ${String(v?.count)} signatures, a reader finds ${want}`);
    }
    case "countSignatures": {
      if (v?.loaded === false)
        return yes(`pdf-lib refused the file first: ${String(v.why)}`);
      const want = f.signatures ?? 0;
      return v?.count === want
        ? yes()
        : no(`counted ${String(v?.count)} signatures, a reader finds ${want}`);
    }
    case "linearization": {
      const want = f.linearized ?? false;
      if (v?.ok !== v?.isLinearized)
        return no("verdict and isLinearized disagree");
      return v?.isLinearized === want
        ? yes(String(v?.detail))
        : no(
            `isLinearized ${String(v?.isLinearized)}, expected ${want}: ${String(v?.detail)}`,
          );
    }
    case "saveChanges": {
      if (!v || v.opened)
        return no(`could not open to save: ${String(v?.opened)}`);
      if (!v.prefixKept)
        return no("the original bytes are not a prefix of the saved file");
      if (v.reopened !== "opened")
        return no(`saved file reopens as ${String(v.reopened)}`);
      if (v.signaturesAfter !== v.signaturesBefore)
        return no(
          `signatures ${String(v.signaturesBefore)} -> ${String(v.signaturesAfter)}`,
        );
      if (v.title !== "hostile-matrix edit")
        return no(`the edit was lost: title ${JSON.stringify(v.title)}`);
      return pagesMatch(f, v.reopenedPages);
    }
  }
  return hostile(f) ? yes() : no("no rule");
}
