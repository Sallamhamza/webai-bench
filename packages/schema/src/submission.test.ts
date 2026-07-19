import { describe, expect, it } from "vitest";
import {
  MAX_CELLS,
  MAX_PAYLOAD_BYTES,
  SubmissionPayloadSchema,
  parseSubmissionPayload,
  type SubmissionPayload,
} from "./submission";
import validFixtureJson from "./fixtures/valid-payload.json";

// The fixture is authored by hand to match SubmissionPayload; JSON import types are widened
// (e.g. "chrome" as `string`, not the literal union), so we assert the shape here rather than
// let every field infer as its widest type.
const validFixture = validFixtureJson as unknown as SubmissionPayload;

function clonePayload(value: SubmissionPayload): SubmissionPayload {
  return JSON.parse(JSON.stringify(value)) as SubmissionPayload;
}

// Fixture is authored with exactly one cell; asserted once here so every test can rely on it.
const [fixtureCell] = validFixture.cells;
if (!fixtureCell) {
  throw new Error("valid-payload.json fixture must contain at least one cell");
}

describe("SubmissionPayloadSchema — golden fixture", () => {
  it("accepts the documented valid payload (05 §2) unmodified", () => {
    const result = SubmissionPayloadSchema.safeParse(validFixtureJson);
    expect(result.success).toBe(true);
  });

  it("round-trips via parseSubmissionPayload", () => {
    const result = parseSubmissionPayload(JSON.stringify(validFixtureJson));
    expect(result.ok).toBe(true);
  });
});

describe("SubmissionPayloadSchema — boundary and rejection cases", () => {
  it("rejects an unknown top-level field (strict mode, data-minimization rule)", () => {
    const payload = { ...clonePayload(validFixture), unexpected_field: "nope" };
    expect(SubmissionPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects more than MAX_CELLS cells", () => {
    const payload = clonePayload(validFixture);
    payload.cells = Array.from(
      { length: MAX_CELLS + 1 },
      () => clonePayload(validFixture).cells[0] ?? fixtureCell,
    );
    expect(SubmissionPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts exactly MAX_CELLS cells", () => {
    const payload = clonePayload(validFixture);
    payload.cells = Array.from(
      { length: MAX_CELLS },
      () => clonePayload(validFixture).cells[0] ?? fixtureCell,
    );
    expect(SubmissionPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an out-of-whitelist browser family", () => {
    const payload = clonePayload(validFixture);
    // @ts-expect-error deliberately invalid enum value for the test
    payload.env.browser.family = "opera";
    expect(SubmissionPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects consent.submit: false (must be the literal true)", () => {
    const payload = clonePayload(validFixture);
    // @ts-expect-error deliberately invalid literal for the test
    payload.consent.submit = false;
    expect(SubmissionPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a payload over MAX_PAYLOAD_BYTES", () => {
    const payload = clonePayload(validFixture);
    const [cell] = payload.cells;
    if (!cell) throw new Error("unreachable — fixture has one cell");
    cell.fixture_sha256 = "a".repeat(MAX_PAYLOAD_BYTES);
    const result = parseSubmissionPayload(JSON.stringify(payload));
    expect(result).toEqual({
      ok: false,
      error: "payload_too_large",
      detail: `exceeds ${MAX_PAYLOAD_BYTES} bytes`,
    });
  });

  it("rejects a wrong-typed field (schema_invalid, not a thrown error)", () => {
    const payload = clonePayload(validFixture);
    // @ts-expect-error deliberately wrong type for the test
    payload.env.hardware_concurrency = "eight";
    const result = SubmissionPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
