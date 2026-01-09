import globals from "globals";
import js from "@eslint/js";
import ts from "typescript-eslint";
import tsParser from "@typescript-eslint/parser";
import json from "@eslint/json";
import markdown from "@eslint/markdown";

export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { vars: "all", args: "after-used", ignoreRestSiblings: false }],
      "no-warning-comments": ["warn", {}],
      "no-irregular-whitespace": ["warn", {}],
      "no-console": ["warn", {}]
    }
  },
  //...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.browser,
      parser: tsParser
    },
    plugins: {
      ts: ts
    },

    rules: {
      ...ts.configs.recommended.rules,
      "@/no-unused-vars": ["warn", { vars: "all", args: "after-used", ignoreRestSiblings: false }],
      "no-unused-vars": ["warn", { vars: "all", args: "after-used", ignoreRestSiblings: false }],
      "no-warning-comments": ["warn", {}],
      "no-irregular-whitespace": ["warn", {}],
      "no-console": ["warn", {}]
    }
  },
  {
    files: ["**/*.json", "**/*.geojson"],
    plugins: {
      json
    },
    language: "json/json",
    rules: {
      "json/no-duplicate-keys": "error"
    }
  },
  {
    files: ["**/*.md"],
    plugins: {
      markdown
    },
    language: "markdown/commonmark",
    rules: {
      "markdown/no-html": "error"
    }
  },
  {
    ignores: ["dist/", "vite.config.js", "package-lock.json"]
  }
];
