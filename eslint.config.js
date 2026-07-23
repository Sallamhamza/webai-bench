import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // tsc already checks this, more accurately (it understands ambient/global types like
      // Cloudflare's D1Database); no-undef produces false positives on TS-only globals.
      "no-undef": "off",
    },
  },
  prettier,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.wrangler/**"],
  },
];
