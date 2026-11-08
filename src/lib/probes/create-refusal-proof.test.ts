// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createRefusalVerdict,
  expectedCreateRefusal,
} from "./create-refusal-proof";

const INPUT = "f_1234567890";
const excel = {
  tool: "excel-to-pdf",
  inputs: [INPUT],
  inputNames: ["wide.xlsx"],
  options: { orientation: "auto" },
};
const pdfa = {
  tool: "pdf-to-pdfa",
  inputs: [INPUT],
  inputNames: ["archive.pdf"],
  options: { level: "2u" },
};
const webpage = {
  tool: "webpage-to-pdf",
  inputs: [],
  options: { hideOverlays: "yes", url: "https://pdf.xyz/guides/x" },
};

describe("expectedCreateRefusal — derived from the route's own parser", () => {
  it("the three bags the proofs send are refused, each naming its field", () => {
    expect(expectedCreateRefusal(excel)).toEqual({
      status: 422,
      code: "unprocessable_entity",
      field: "options",
    });
    expect(expectedCreateRefusal(pdfa)).toEqual({
      status: 422,
      code: "unprocessable_entity",
      field: "options.level",
    });
    // Webpage's capture parser answers invalid_request, which is a 400.
    expect(expectedCreateRefusal(webpage)).toEqual({
      status: 400,
      code: "invalid_request",
      field: "options.hideOverlays",
    });
  });

  it("CONTROL: the valid bags are accepted, so the expectation is null", () => {
    expect(
      expectedCreateRefusal({
        ...excel,
        options: { orientation: "landscape", fitColumnsToWidth: true },
      }),
    ).toBeNull();
    expect(expectedCreateRefusal({ ...pdfa, options: { level: "1b" } })).toBe(
      null,
    );
    expect(
      expectedCreateRefusal({
        ...webpage,
        options: { hideOverlays: true, url: webpage.options.url },
      }),
    ).toBeNull();
  });
});

describe("createRefusalVerdict", () => {
  const want = expectedCreateRefusal(pdfa);

  it("POSITIVE CONTROL: the served refusal is the parser's", () => {
    const v = createRefusalVerdict(want, {
      status: 422,
      body: {
        error: {
          code: "unprocessable_entity",
          message: '`options.level` must be one of "2b", "1b", "3b".',
          details: [{ field: "options.level" }],
        },
      },
    });
    expect(v.ok).toBe(true);
    expect(v.detail).toMatch(/refused at creation as 422/);
  });

  it("NEGATIVE CONTROL (the defect): an older web tier accepts the job", () => {
    const v = createRefusalVerdict(want, {
      status: 202,
      body: { jobId: "j_abc" },
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/accepted with HTTP 202 and a job id/);
  });

  it("NEGATIVE: a 422 for another reason is not evidence about this option", () => {
    const v = createRefusalVerdict(want, {
      status: 422,
      body: {
        error: {
          code: "unprocessable_entity",
          details: [{ field: "inputs" }],
        },
      },
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/on inputs, wanted 422 unprocessable_entity/);
  });

  it("NEGATIVE: the right field with another status (a rate limit, a 400)", () => {
    expect(
      createRefusalVerdict(want, {
        status: 400,
        body: {
          error: {
            code: "invalid_request",
            details: [{ field: "options.level" }],
          },
        },
      }).ok,
    ).toBe(false);
  });

  it("HEALTH: a bag the parser accepts cannot pass, whatever the deployment says", () => {
    const v = createRefusalVerdict(null, {
      status: 422,
      body: {
        error: {
          code: "unprocessable_entity",
          details: [{ field: "options.level" }],
        },
      },
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/fix the spec/);
  });
});
