// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "./error-boundary";
import {
  AFTER_UPLOAD_DISCLOSURE,
  NO_UPLOAD_DISCLOSURE,
} from "./upload-disclosure";
import RouteError from "@/app/error";
import {
  markUploadStarted,
  resetUploadedThisSessionForTests,
} from "@/lib/uploads/session-uploads";

/**
 * The crash fallback must not tell the user that nothing was uploaded when
 * something was.
 *
 * `ErrorBoundary`'s default fallback is what renders at all fourteen boundaries
 * on `/tools/[slug]`, and thirteen of those wrap a secure-worker panel that
 * uploads the file before it can crash rendering the result. The old copy
 * asserted "Nothing was uploaded and your files are untouched." unconditionally,
 * so on those thirteen it was the product stating a falsehood in its own voice
 * at the exact moment the user most needs to trust it — the same shape as the
 * malware claim deleted in #33.
 *
 * WOULD THIS BE GREEN IF THE FIX WERE ABSENT? Measured, not assumed: run against
 * `HEAD` (the tree before this change) it reports **4 of 5 failing**. Both "after
 * an upload" cases fail on the literal the old copy still contains, and the
 * first-paint case fails because that copy is static — it has no state to be
 * unknown in.
 *
 * The one case that passes either way is `ErrorBoundary`'s "before any upload",
 * and it is here on purpose rather than as coverage: the reassurance is TRUE for
 * the twenty-eight in-browser tools, so this pins that the fix is a condition and
 * not a deletion. (Its `app/error.tsx` twin does fail pre-fix, but only because
 * that file worded the same sentence differently — "your files stay on your
 * device" — which is the drift `upload-disclosure.ts` now makes impossible. Do
 * not read that failure as semantic.)
 */

/** Throws on render, the way a real panel crashes inside a boundary. */
function Boom(): never {
  throw new Error("panel crashed");
}

function renderBoundary() {
  // React logs the caught error; silence it so a passing run stays readable.
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(
      <ErrorBoundary boundary="test">
        <Boom />
      </ErrorBoundary>,
    );
  } finally {
    spy.mockRestore();
  }
  return screen.getByRole("alert").textContent ?? "";
}

describe("crash fallback upload disclosure", () => {
  beforeEach(() => {
    resetUploadedThisSessionForTests();
  });

  describe("ErrorBoundary default fallback", () => {
    it("keeps the reassurance when nothing has been uploaded", () => {
      const text = renderBoundary();
      expect(text).toContain(NO_UPLOAD_DISCLOSURE);
      expect(text).not.toContain(AFTER_UPLOAD_DISCLOSURE);
      expect(text).toContain("You can try again");
    });

    it("does not claim nothing was uploaded once a tool has uploaded", () => {
      markUploadStarted();
      const text = renderBoundary();
      expect(text).toContain(AFTER_UPLOAD_DISCLOSURE);
      expect(text).not.toContain("Nothing was uploaded");
      // Still recoverable — the disclosure replaced the claim, not the retry.
      expect(text).toContain("You can try again");
      expect(screen.getByRole("button", { name: /try again/i })).toBeEnabled();
    });
  });

  describe("app/error.tsx", () => {
    const error = Object.assign(new Error("boom"), { digest: "d1" });

    it("keeps the reassurance when nothing has been uploaded", () => {
      render(<RouteError error={error} reset={() => {}} />);
      expect(document.body.textContent).toContain(NO_UPLOAD_DISCLOSURE);
    });

    it("does not claim nothing was uploaded once a tool has uploaded", () => {
      markUploadStarted();
      render(<RouteError error={error} reset={() => {}} />);
      expect(document.body.textContent).toContain(AFTER_UPLOAD_DISCLOSURE);
      expect(document.body.textContent).not.toContain("Nothing was uploaded");
    });
  });

  /**
   * The flag lives in browser-only module state, so during SSR — and the
   * hydration pass that must match it — neither sentence is established. The
   * honest output in that instant is silence about uploads, not the friendlier
   * of two unverified claims.
   */
  describe("the first paint, before the flag can be read", () => {
    it("makes no claim about uploads either way", () => {
      markUploadStarted();
      const html = renderToStaticMarkup(
        <RouteError
          error={Object.assign(new Error("boom"), { digest: "d1" })}
          reset={() => {}}
        />,
      );
      expect(html).not.toContain("Nothing was uploaded");
      expect(html).not.toContain("already been uploaded");
      // The rest of the fallback is unaffected — it still tells the user what
      // happened and how to recover.
      expect(html).toContain("An unexpected error interrupted this page.");
      expect(html).toContain("Try again");
    });
  });
});
