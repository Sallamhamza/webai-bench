import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL doesn't auto-register its cleanup hook without test.globals — without this, each
// test's rendered tree leaks into the next test's DOM, breaking any getByRole/getByText
// query that expects a single match.
afterEach(cleanup);
